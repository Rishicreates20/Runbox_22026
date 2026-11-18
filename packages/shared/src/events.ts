import { z } from "zod";
import { ProblemSlug, SubmissionId } from "./ids.ts";
import { Language, MAX_SOURCE_BYTES } from "./languages.ts";

/* -------------------------------------------------------------------------
 * Submission API, judge queue and execution-event contract.
 * The SSE stream is documented in docs/asyncapi.yaml; keep the two in sync.
 * ---------------------------------------------------------------------- */

export const Verdict = z.enum(["AC", "WA", "TLE", "MLE", "RE", "OLE", "CE", "IE"]);
export type Verdict = z.infer<typeof Verdict>;

export const VERDICT_LABEL: Record<Verdict, string> = {
  AC: "Accepted",
  WA: "Wrong Answer",
  TLE: "Time Limit Exceeded",
  MLE: "Memory Limit Exceeded",
  RE: "Runtime Error",
  OLE: "Output Limit Exceeded",
  CE: "Compile Error",
  IE: "Internal Error",
};

export const SubmissionMode = z.enum(["run", "submit"]);
export type SubmissionMode = z.infer<typeof SubmissionMode>;

/** Body of POST /api/submissions. */
export const SubmissionRequest = z.strictObject({
  problem: ProblemSlug,
  language: Language,
  code: z
    .string()
    .min(1, "code is empty")
    .refine((c) => new TextEncoder().encode(c).length <= MAX_SOURCE_BYTES, "code is larger than 64 KB"),
  mode: SubmissionMode,
  /** "run" only: raw stdin cases typed in the console (newline-normalised). */
  customInputs: z.array(z.string().max(64 * 1024)).max(6).optional(),
});
export type SubmissionRequest = z.infer<typeof SubmissionRequest>;

/** One test as it travels on the queue: everything base64 so bytes survive. */
export const JobTest = z.strictObject({
  ordinal: z.number().int(),
  inputB64: z.string(),
  /** Missing for custom "run" inputs that have no known answer. */
  expectedB64: z.string().optional(),
  /** Hidden tests never have their data echoed back to the browser. */
  hidden: z.boolean(),
  displayInput: z.string().optional(),
});
export type JobTest = z.infer<typeof JobTest>;

/** Payload LPUSHed onto the judge queue. */
export const JudgeJob = z.strictObject({
  submissionId: SubmissionId,
  problemId: z.number().int(),
  problemSlug: ProblemSlug,
  language: Language,
  codeB64: z.string(),
  mode: SubmissionMode,
  timeMs: z.number().int(),
  memoryMb: z.number().int(),
  /** "run" carries its tests inline; "submit" uses every test in the DB. */
  tests: z.union([z.literal("all"), z.array(JobTest)]),
  enqueuedAt: z.number(),
});
export type JudgeJob = z.infer<typeof JudgeJob>;

const at = z.number(); // ms since epoch

/** Events published by the judge on Redis and streamed to browsers over SSE. */
export const ExecEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("queued"), at, position: z.number().int().optional() }),
  z.object({ type: z.literal("compiling"), at }),
  z.object({ type: z.literal("running"), at, test: z.number().int(), total: z.number().int() }),
  z.object({
    type: z.literal("test_result"),
    at,
    test: z.number().int(),
    total: z.number().int(),
    verdict: Verdict,
    timeMs: z.number(),
    memoryKb: z.number(),
    hidden: z.boolean(),
    detail: z.string().optional(),
    displayInput: z.string().optional(),
    input: z.string().optional(),
    output: z.string().optional(),
    expected: z.string().optional(),
    stderr: z.string().optional(),
  }),
  z.object({
    type: z.literal("completed"),
    at,
    verdict: Verdict,
    passed: z.number().int(),
    total: z.number().int(),
    timeMs: z.number(),
    memoryKb: z.number(),
    detail: z.string().optional(),
    compileOutput: z.string().optional(),
    failedTest: z.number().int().optional(),
  }),
]);
export type ExecEvent = z.infer<typeof ExecEvent>;
export type ExecEventType = ExecEvent["type"];

export const TERMINAL_EVENTS: ReadonlySet<ExecEventType> = new Set(["completed"]);

/* ---- Redis key layout (shared by web and judge) ---- */
export const keys = {
  queue: "codeplus:queue",
  processing: (worker: string) => `codeplus:processing:${worker}`,
  /** Durable per-submission event log; entry ids are the SSE ids. */
  events: (id: string) => `codeplus:events:${id}`,
  /** Pub/Sub channel for live delivery. Web nodes PSUBSCRIBE the pattern. */
  channel: (id: string) => `codeplus:exec:${id}`,
  channelPattern: "codeplus:exec:*",
  rate: (client: string) => `codeplus:rate:${client}`,
};
export const EVENT_LOG_TTL_SECONDS = 60 * 60;
