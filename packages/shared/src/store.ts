import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import type { SubmissionId } from "./ids.ts";
import type { Language } from "./languages.ts";
import { normalizeNewlines, type NormalizedProblem } from "./problem.ts";
import type { PaperCreate } from "./paper.ts";
import {
  EVENT_LOG_TTL_SECONDS, JudgeJob, keys, type ExecEvent, type SubmissionRequest,
} from "./events.ts";

/** Inserts or replaces a problem and all of its test cases in one transaction. */
export async function upsertProblem(sql: Sql, p: NormalizedProblem): Promise<number> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO problems (slug, title, difficulty, problem_type, tags, statement, limits, starter_code)
      VALUES (${p.slug}, ${p.title}, ${p.difficulty}, ${p.problemType}, ${p.tags},
              ${p.statement}, ${tx.json(p.limits)}, ${tx.json(p.starterCode)})
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title, difficulty = EXCLUDED.difficulty,
        problem_type = EXCLUDED.problem_type, tags = EXCLUDED.tags,
        statement = EXCLUDED.statement, limits = EXCLUDED.limits,
        starter_code = EXCLUDED.starter_code,
        version = problems.version + 1, updated_at = now()
      RETURNING id`;
    await tx`DELETE FROM test_cases WHERE problem_id = ${row.id}`;
    // Insert in chunks so large problems stay under the bind-parameter limit.
    for (let i = 0; i < p.tests.length; i += 50) {
      const rows = p.tests.slice(i, i + 50).map((t) => ({
        problem_id: row.id,
        ordinal: t.ordinal,
        input: t.input,
        display_input: t.displayInput,
        expected_output: t.expectedOutput,
        is_sample: t.sample,
        explanation: t.explanation ?? null,
      }));
      await tx`INSERT INTO test_cases ${tx(rows)}`;
    }
    return row.id;
  });
}

/**
 * Appends an event to the submission's durable log (a Redis stream whose
 * entry ids are monotonic, so they double as SSE ids) and publishes it for
 * live delivery, atomically. The pub/sub payload is {"id":..,"event":..}.
 */
export const PUBLISH_EVENT_LUA = `
local id = redis.call('XADD', KEYS[1], 'MAXLEN', '~', 2000, '*', 'e', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('PUBLISH', KEYS[2], '{"id":"' .. id .. '","event":' .. ARGV[1] .. '}')
return id
`;

/** Minimal surface of ioredis used here, so this package needn't depend on it. */
export interface EvalRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

export async function publishEvent(redis: EvalRedis, submissionId: string, event: ExecEvent): Promise<string> {
  return (await redis.eval(
    PUBLISH_EVENT_LUA,
    2,
    keys.events(submissionId),
    keys.channel(submissionId),
    JSON.stringify(event),
    EVENT_LOG_TTL_SECONDS,
  )) as string;
}

/* ------------------------------------------------------------------------ */

export interface ProblemRow {
  id: number;
  slug: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  problem_type: string;
  tags: string[];
  statement: string;
  limits: { timeMs: Record<Language, number>; memoryMb: number };
  starter_code: Partial<Record<Language, string>>;
  /** Set when the problem is a question of an imported mock paper. */
  paper_id: string | null;
  paper_ordinal: number | null;
}

export interface SampleRow {
  ordinal: number;
  input: string;
  display_input: string;
  expected_output: string;
  explanation: string | null;
}

export async function getProblem(sql: Sql, slug: string): Promise<ProblemRow | undefined> {
  const [p] = await sql<ProblemRow[]>`
    SELECT id, slug, title, difficulty, problem_type, tags, statement, limits, starter_code, paper_id, paper_ordinal
    FROM problems WHERE slug = ${slug}`;
  return p;
}

export async function getSamples(sql: Sql, problemId: number): Promise<SampleRow[]> {
  return sql<SampleRow[]>`
    SELECT ordinal, input, display_input, expected_output, explanation
    FROM test_cases WHERE problem_id = ${problemId} AND is_sample ORDER BY ordinal`;
}

/** Minimal ioredis surface used to enqueue. */
export interface QueueRedis extends EvalRedis {
  lpush(key: string, value: string): Promise<number>;
  llen(key: string): Promise<number>;
}

/**
 * Records a submission and puts it on the judge queue. Code and every test
 * are base64-encoded on the queue so bytes survive unchanged; raw inputs were
 * already newline-normalised at ingestion (and custom ones are here).
 */
export async function enqueueSubmission(
  sql: Sql,
  redis: QueueRedis,
  req: SubmissionRequest,
  clientId: string,
): Promise<{ id: SubmissionId } | { error: string; status: number }> {
  const problem = await getProblem(sql, req.problem);
  if (!problem) return { error: "problem not found", status: 404 };

  let tests: JudgeJob["tests"] = "all";
  if (req.mode === "submit") {
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM test_cases WHERE problem_id = ${problem.id}`;
    if (n === 0) {
      return {
        error: "This question has no sample output to check against, so there's nothing to submit to. Use Run to see your output.",
        status: 400,
      };
    }
  }
  if (req.mode === "run") {
    const samples = await getSamples(sql, problem.id);
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const inputs = req.customInputs?.length
      ? req.customInputs.map(normalizeNewlines)
      : samples.map((s) => s.input);
    if (inputs.length === 0) {
      return { error: "This question has no sample input. Type an input in the Testcase tab and run again.", status: 400 };
    }
    tests = inputs.map((input, ordinal) => {
      const known = samples.find((s) => s.input === input);
      const typed = req.customInputs?.length ? req.customExpected?.[ordinal] : undefined;
      const expected = typed?.trim() ? normalizeNewlines(typed) : known?.expected_output;
      return {
        ordinal,
        inputB64: b64(input),
        ...(expected !== undefined ? { expectedB64: b64(expected) } : {}),
        hidden: false,
        displayInput: known?.display_input ?? "custom input",
      };
    });
  }

  const id = randomUUID() as SubmissionId;
  await sql`
    INSERT INTO submissions (id, problem_id, client_id, language, code, mode)
    VALUES (${id}, ${problem.id}, ${clientId}, ${req.language}, ${req.code}, ${req.mode})`;
  const job: JudgeJob = {
    submissionId: id,
    problemId: problem.id,
    problemSlug: req.problem,
    language: req.language,
    codeB64: Buffer.from(req.code).toString("base64"),
    mode: req.mode,
    timeMs: problem.limits.timeMs[req.language],
    memoryMb: problem.limits.memoryMb,
    tests,
    enqueuedAt: Date.now(),
  };
  const position = await redis.llen(keys.queue);
  await publishEvent(redis, id, { type: "queued", at: Date.now(), position });
  await redis.lpush(keys.queue, JSON.stringify(JudgeJob.parse(job)));
  return { id };
}

/* ---------------------------- navigation -------------------------------- */

export interface Neighbor {
  slug: string;
  title: string;
}

export interface ProblemNav {
  prev: Neighbor | null;
  next: Neighbor | null;
  /** 1-based position and count within the list (or the paper). */
  index: number;
  total: number;
}

/**
 * Previous/next problem: within the paper for a mock-paper question,
 * otherwise in the public problem list's order.
 */
export async function getProblemNav(sql: Sql, p: Pick<ProblemRow, "id" | "paper_id">): Promise<ProblemNav> {
  const rows = p.paper_id
    ? await sql<(Neighbor & { id: number })[]>`
        SELECT id, slug, title FROM problems WHERE paper_id = ${p.paper_id} ORDER BY paper_ordinal, id`
    : await sql<(Neighbor & { id: number })[]>`
        SELECT id, slug, title FROM problems WHERE paper_id IS NULL ORDER BY id`;
  const i = rows.findIndex((r) => r.id === p.id);
  const pick = (r: (Neighbor & { id: number }) | undefined) => (r ? { slug: r.slug, title: r.title } : null);
  return { prev: pick(rows[i - 1]), next: pick(rows[i + 1]), index: i + 1, total: rows.length };
}

/* ---------------------------- mock papers ------------------------------- */

export interface PaperRow {
  id: string;
  title: string;
  source: string;
  intro: string;
  duration_min: number;
  created_at: Date;
}

export interface PaperQuestionRow {
  slug: string;
  title: string;
  paper_ordinal: number;
  examples: number;
}

/** Default limits for imported questions, which don't state any. */
const PAPER_LIMITS = { timeMs: { cpp: 2000, c: 2000, python: 6000 }, memoryMb: 256 };

/**
 * Stores an imported paper. Each question becomes a problem row (with
 * paper_id set) whose sample tests are the examples found in its text.
 */
export async function createPaper(sql: Sql, paper: PaperCreate, clientId: string): Promise<string> {
  const id = randomUUID();
  const short = id.replace(/-/g, "").slice(0, 10);
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO papers (id, title, source, intro, duration_min, client_id)
      VALUES (${id}, ${paper.title}, ${paper.source}, ${paper.intro}, ${paper.durationMin}, ${clientId})`;
    for (const [k, q] of paper.questions.entries()) {
      const [row] = await tx<{ id: number }[]>`
        INSERT INTO problems (slug, title, difficulty, problem_type, tags, statement, limits, starter_code, paper_id, paper_ordinal)
        VALUES (${`paper-${short}-q${k + 1}`}, ${q.title}, ${q.difficulty ?? "medium"}, 'paper', ${[]}, ${q.statement},
                ${tx.json(PAPER_LIMITS)}, ${tx.json({})}, ${id}, ${k + 1})
        RETURNING id`;
      const tests = q.examples.map((e, j) => {
        const input = normalizeNewlines(e.input);
        return {
          problem_id: row.id,
          ordinal: j,
          input,
          display_input: input.length > 4000 ? input.slice(0, 4000) + "…" : input.replace(/\n$/, ""),
          expected_output: normalizeNewlines(e.output),
          is_sample: true,
          explanation: null,
        };
      });
      if (tests.length) await tx`INSERT INTO test_cases ${tx(tests)}`;
    }
  });
  return id;
}

export async function getPaper(sql: Sql, id: string): Promise<{ paper: PaperRow; questions: PaperQuestionRow[] } | null> {
  const [paper] = await sql<PaperRow[]>`
    SELECT id, title, source, intro, duration_min, created_at FROM papers WHERE id = ${id}`;
  if (!paper) return null;
  const questions = await sql<PaperQuestionRow[]>`
    SELECT p.slug, p.title, p.paper_ordinal,
      (SELECT count(*)::int FROM test_cases t WHERE t.problem_id = p.id) AS examples
    FROM problems p WHERE p.paper_id = ${id} ORDER BY p.paper_ordinal`;
  return { paper, questions };
}
