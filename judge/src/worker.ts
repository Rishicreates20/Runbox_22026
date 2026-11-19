/**
 * Judge worker. Pops jobs from the Redis queue with BLMOVE into a per-slot
 * "processing" list (so a crash never loses a job), runs them through
 * runbox, streams events, and stores the final result in Postgres.
 *
 * Must run as root: runbox needs it to set up namespaces and cgroups.
 */
import { mkdir } from "node:fs/promises";
import { Redis } from "ioredis";
import postgres from "postgres";
import { JudgeJob, keys, publishEvent } from "@codeplus/shared";
import { config } from "./config.ts";
import { judge, type Completed } from "./judge.ts";

const sql = postgres(config.databaseUrl, { max: config.concurrency + 2 });
const redis = new Redis(config.redisUrl);
let stopping = false;

async function slot(i: number) {
  const conn = redis.duplicate(); // BLMOVE blocks its connection
  const processing = keys.processing(`${config.workerName}:${i}`);
  // Jobs left over from a previous crash of this slot go back on the queue.
  while (await conn.lmove(processing, keys.queue, "RIGHT", "RIGHT")) {}

  while (!stopping) {
    const raw = await conn.blmove(keys.queue, processing, "RIGHT", "LEFT", 5);
    if (!raw) continue;
    const parsed = JudgeJob.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error("dropping malformed job", parsed.error.issues);
      await conn.lrem(processing, 1, raw);
      continue;
    }
    const job = parsed.data;
    const t0 = Date.now();
    let done: Completed;
    try {
      done = await judge(job, sql, redis);
    } catch (e) {
      console.error(`${job.submissionId} failed:`, e);
      done = {
        type: "completed", at: Date.now(), verdict: "IE", passed: 0, total: 0,
        timeMs: 0, memoryKb: 0, detail: "The judge hit an internal error. Try again.",
      };
    }
    try {
      await sql`
        UPDATE submissions SET status = 'done', verdict = ${done.verdict}, passed = ${done.passed},
          total = ${done.total}, time_ms = ${done.timeMs}, memory_kb = ${done.memoryKb},
          result = ${sql.json(done)}, finished_at = now()
        WHERE id = ${job.submissionId}`;
    } catch (e) {
      // Postgres is unreachable: keep the job in this slot's processing list
      // so it is requeued when the worker restarts, instead of losing it.
      console.error(`${job.submissionId}: could not store result, leaving job for retry:`, e);
      await publishEvent(redis, job.submissionId, done).catch(() => {});
      continue;
    }
    // The verdict is stored; a failed publish only affects the live view
    // (the SSE endpoint falls back to the stored row), never the verdict.
    await publishEvent(redis, job.submissionId, done).catch((e) =>
      console.error(`${job.submissionId}: publish failed:`, e));
    console.log(`${job.submissionId} ${job.problemSlug} ${job.language} ${job.mode}: ${done.verdict} ` +
      `${done.passed}/${done.total} in ${Date.now() - t0} ms (queued ${t0 - job.enqueuedAt} ms)`);
    await conn.lrem(processing, 1, raw);
  }
  conn.disconnect();
}

async function main() {
  if (process.getuid?.() !== 0) console.warn("warning: runbox needs root; jobs will fail with IE");
  await mkdir(config.workDir, { recursive: true, mode: 0o700 });
  console.log(`judge ${config.workerName}: ${config.concurrency} slots, runbox ${config.runbox}`);
  const stop = () => { stopping = true; console.log("stopping after current jobs…"); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await Promise.all(Array.from({ length: config.concurrency }, (_, i) => slot(i)));
  await sql.end();
  redis.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
