import { z } from "zod";
import { ProblemSlug } from "./ids.ts";
import { Language, LANGUAGES } from "./languages.ts";

/* -------------------------------------------------------------------------
 * Problem ingestion schema.
 *
 * Problems are polymorphic, so the upload schema is a discriminated union on
 * `problem_type`. Typed problem kinds carry structured test arguments that
 * are validated with refinements and then serialised into raw stdin by one
 * canonical encoder, so authors never hand-write stdin for them. The
 * `generic` kind takes raw stdin directly.
 *
 * Every test case ends up with two separate representations:
 *   input         raw stdin piped into the program ("4\n2 7 11 15\n9\n")
 *   displayInput  what the problem page shows ("nums = [2,7,11,15], target = 9")
 * Raw inputs and expected outputs are newline-normalised (CRLF -> LF) here,
 * at the API boundary, so a problem authored on Windows can't leave a stray
 * '\r' for std::cin to read.
 * ---------------------------------------------------------------------- */

export const MAX_TESTS = 200;
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_TEST_BYTES = 48 * 1024 * 1024;

/** CRLF and lone CR become LF; a non-empty text always ends with one LF. */
export function normalizeNewlines(text: string): string {
  let s = text.replace(/\r\n?/g, "\n");
  if (s.length > 0 && !s.endsWith("\n")) s += "\n";
  return s;
}

const RawText = z.string().max(MAX_INPUT_BYTES).transform(normalizeNewlines);
const SafeInt = z.number().int().min(-1e9).max(1e9);

const Difficulty = z.enum(["easy", "medium", "hard"]);

const TimeLimits = z
  .strictObject({
    cpp: z.number().int().min(100).max(10_000),
    c: z.number().int().min(100).max(10_000),
    python: z.number().int().min(100).max(20_000),
  })
  .refine((t) => t.python >= t.cpp && t.python >= t.c, {
    message: "python's time limit must be at least the C/C++ limit (interpreter overhead)",
    path: ["python"],
  });

const Limits = z.strictObject({
  timeMs: TimeLimits,
  memoryMb: z.number().int().min(16).max(1024),
});

const StarterCode = z.partialRecord(Language, z.string().max(16_384));

const base = {
  slug: ProblemSlug,
  title: z.string().trim().min(1).max(120),
  difficulty: Difficulty,
  tags: z.array(z.string().trim().min(1).max(32)).max(10).default([]),
  /** Markdown. Raw HTML in it is not rendered. */
  statement: z.string().min(1).max(64_000),
  limits: Limits,
  starterCode: StarterCode.default({}),
};

const testMeta = {
  expectedOutput: RawText,
  /** Sample tests are shown on the problem page and used by "Run". */
  sample: z.boolean().default(false),
  explanation: z.string().max(2_000).optional(),
};

/* ---- generic: raw stdin given directly ---- */
const GenericTest = z.strictObject({
  input: RawText,
  displayInput: z.string().min(1).max(4_000),
  ...testMeta,
});

/* ---- array_manipulation: an int array and an integer k ---- */
const ArrayArgs = z.strictObject({
  target_array: z.array(SafeInt).min(1).max(99_999, "array length must be < 10^5"),
  k_value: z.number().int().min(0, "k must be >= 0").max(1e9),
});
const ArrayTest = z.strictObject({
  args: ArrayArgs,
  displayInput: z.string().min(1).max(4_000).optional(),
  ...testMeta,
});

/* ---- graph_traversal: adjacency list and a start node ---- */
const GraphArgs = z
  .strictObject({
    adjacency_list: z.array(z.array(z.number().int())).min(1).max(100_000),
    start_node: z.number().int().min(0),
  })
  .superRefine((g, ctx) => {
    const n = g.adjacency_list.length;
    if (g.start_node >= n)
      ctx.addIssue({ code: "custom", path: ["start_node"], message: `start_node must be < ${n} (node count)` });
    let edges = 0;
    g.adjacency_list.forEach((row, u) => {
      edges += row.length;
      row.forEach((v, i) => {
        if (v < 0 || v >= n)
          ctx.addIssue({
            code: "custom",
            path: ["adjacency_list", u, i],
            message: `neighbour ${v} of node ${u} is outside 0..${n - 1}`,
          });
      });
    });
    if (edges > 1_000_000)
      ctx.addIssue({ code: "custom", path: ["adjacency_list"], message: "at most 10^6 edges" });
  });
const GraphTest = z.strictObject({
  args: GraphArgs,
  displayInput: z.string().min(1).max(4_000).optional(),
  ...testMeta,
});

/* ---- string_parsing: one line of text, checked against input_pattern ---- */
const StringArgs = z.strictObject({
  input_string: z
    .string()
    .max(9_999, "string length must be < 10^4")
    .refine((s) => !/[\r\n]/.test(s), "input_string must be a single line"),
});
const StringTest = z.strictObject({
  args: StringArgs,
  displayInput: z.string().min(1).max(4_000).optional(),
  ...testMeta,
});

const RegexSource = z
  .string()
  .min(1)
  .max(500)
  .refine((src) => {
    try {
      new RegExp(src, "u");
      return true;
    } catch {
      return false;
    }
  }, "not a valid ECMAScript regular expression");

const testsOf = <T extends z.ZodType>(t: T) =>
  z
    .array(t)
    .min(1)
    .max(MAX_TESTS)
    .refine((ts) => ts.some((x) => (x as { sample?: boolean }).sample), "mark at least one test as sample");

const GenericProblem = z.strictObject({
  ...base,
  problem_type: z.literal("generic"),
  tests: testsOf(GenericTest),
});
const ArrayProblem = z.strictObject({
  ...base,
  problem_type: z.literal("array_manipulation"),
  tests: testsOf(ArrayTest),
});
const GraphProblem = z.strictObject({
  ...base,
  problem_type: z.literal("graph_traversal"),
  tests: testsOf(GraphTest),
});
const StringProblem = z
  .strictObject({
    ...base,
    problem_type: z.literal("string_parsing"),
    /** Every input_string must fully match this pattern. */
    input_pattern: RegexSource,
    tests: testsOf(StringTest),
  })
  .superRefine((p, ctx) => {
    let re: RegExp;
    try {
      re = new RegExp(`^(?:${p.input_pattern})$`, "u");
    } catch {
      return; // reported by RegexSource
    }
    p.tests.forEach((t, i) => {
      if (!re.test(t.args.input_string))
        ctx.addIssue({
          code: "custom",
          path: ["tests", i, "args", "input_string"],
          message: `does not match input_pattern /${p.input_pattern}/`,
        });
    });
  });

/** What an author uploads. */
export const ProblemUpload = z.discriminatedUnion("problem_type", [
  GenericProblem,
  ArrayProblem,
  GraphProblem,
  StringProblem,
]);
export type ProblemUpload = z.input<typeof ProblemUpload>;
export type ProblemType = z.infer<typeof ProblemUpload>["problem_type"];

/* ---- canonical stdin / display encoders ---- */
export function encodeArray(a: z.infer<typeof ArrayArgs>) {
  return {
    input: `${a.target_array.length}\n${a.target_array.join(" ")}\n${a.k_value}\n`,
    displayInput: `nums = [${a.target_array.join(",")}], k = ${a.k_value}`,
  };
}
export function encodeGraph(g: z.infer<typeof GraphArgs>) {
  const rows = g.adjacency_list.map((r) => [r.length, ...r].join(" ")).join("\n");
  return {
    input: `${g.adjacency_list.length}\n${rows}\n${g.start_node}\n`,
    displayInput: `adjacency_list = ${JSON.stringify(g.adjacency_list)}, start_node = ${g.start_node}`,
  };
}
export function encodeString(s: z.infer<typeof StringArgs>) {
  return {
    input: `${s.input_string}\n`,
    displayInput: `s = ${JSON.stringify(s.input_string)}`,
  };
}

/** Derived display strings for huge inputs are cut; they are only shown
 * for sample tests, which are small. */
function clipDisplay(s: string, max = 4_000): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** The normalised shape stored in the database and used by the judge. */
export interface TestCase {
  ordinal: number;
  input: string;
  displayInput: string;
  expectedOutput: string;
  sample: boolean;
  explanation?: string;
}
export interface NormalizedProblem {
  slug: ProblemSlug;
  title: string;
  difficulty: z.infer<typeof Difficulty>;
  tags: string[];
  statement: string;
  problemType: ProblemType;
  limits: z.infer<typeof Limits>;
  starterCode: Partial<Record<Language, string>>;
  tests: TestCase[];
}

/** Validates an upload and turns it into the normalised problem. */
export const ProblemIngest = ProblemUpload.transform((p, ctx): NormalizedProblem => {
  const tests: TestCase[] = p.tests.map((t, ordinal) => {
    let enc: { input: string; displayInput: string };
    switch (p.problem_type) {
      case "generic": {
        const g = t as z.infer<typeof GenericTest>;
        enc = { input: g.input, displayInput: g.displayInput };
        break;
      }
      case "array_manipulation":
        enc = encodeArray((t as z.infer<typeof ArrayTest>).args);
        break;
      case "graph_traversal":
        enc = encodeGraph((t as z.infer<typeof GraphTest>).args);
        break;
      case "string_parsing":
        enc = encodeString((t as z.infer<typeof StringTest>).args);
        break;
    }
    return {
      ordinal,
      input: enc.input,
      displayInput: t.displayInput ?? clipDisplay(enc.displayInput),
      expectedOutput: t.expectedOutput,
      sample: t.sample,
      ...(t.explanation ? { explanation: t.explanation } : {}),
    };
  });
  const total = tests.reduce((n, t) => n + t.input.length + t.expectedOutput.length, 0);
  if (total > MAX_TOTAL_TEST_BYTES)
    ctx.addIssue({ code: "custom", path: ["tests"], message: "test data exceeds 48 MB in total" });
  return {
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    tags: p.tags,
    statement: p.statement,
    problemType: p.problem_type,
    limits: p.limits,
    starterCode: p.starterCode,
    tests,
  };
});

export { LANGUAGES };
