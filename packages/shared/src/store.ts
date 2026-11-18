import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import type { SubmissionId } from "./ids.ts";
import type { Language } from "./languages.ts";
import { normalizeNewlines, type NormalizedProblem } from "./problem.ts";
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
    SELECT id, slug, title, difficulty, problem_type, tags, statement, limits, starter_code
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
  if (req.mode === "run") {
    const samples = await getSamples(sql, problem.id);
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const inputs = req.customInputs?.length
      ? req.customInputs.map(normalizeNewlines)
      : samples.map((s) => s.input);
    tests = inputs.map((input, ordinal) => {
      const known = samples.find((s) => s.input === input);
      return {
        ordinal,
        inputB64: b64(input),
        ...(known ? { expectedB64: b64(known.expected_output) } : {}),
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
