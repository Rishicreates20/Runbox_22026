import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "postgres";
import {
  LANGUAGE_INFO, clip, outputsMatch, publishEvent,
  type EvalRedis, type ExecEvent, type JobTest, type JudgeJob, type Verdict,
} from "@codeplus/shared";
import { config } from "./config.ts";
import { runbox, type RunboxResult } from "./runbox.ts";

/* Cache of each problem's tests, keyed by id and invalidated by version. */
const testCache = new Map<number, { version: number; tests: JobTest[] }>();

async function loadTests(sql: Sql, problemId: number): Promise<JobTest[]> {
  const [p] = await sql<{ version: number }[]>`SELECT version FROM problems WHERE id = ${problemId}`;
  if (!p) throw new Error(`problem ${problemId} not found`);
  const hit = testCache.get(problemId);
  if (hit && hit.version === p.version) return hit.tests;
  const rows = await sql<{ ordinal: number; input: string; expected_output: string; is_sample: boolean; display_input: string }[]>`
    SELECT ordinal, input, expected_output, is_sample, display_input
    FROM test_cases WHERE problem_id = ${problemId} ORDER BY is_sample DESC, ordinal`;
  const tests = rows.map((r) => ({
    ordinal: r.ordinal,
    inputB64: Buffer.from(r.input).toString("base64"),
    expectedB64: Buffer.from(r.expected_output).toString("base64"),
    hidden: !r.is_sample,
    displayInput: r.display_input,
  }));
  testCache.set(problemId, { version: p.version, tests });
  return tests;
}

/** Maps a runbox verdict on a program that exited, plus the checker, to ours. */
function verdictOf(r: RunboxResult, expected: string | undefined): { verdict: Verdict; detail?: string } {
  switch (r.verdict) {
    case "OK":
      if (expected === undefined || outputsMatch(r.stdout.toString("utf8"), expected)) return { verdict: "AC" };
      return { verdict: "WA" };
    case "SV":
      return { verdict: "RE", detail: "blocked system call" };
    case "IE":
      return { verdict: "IE", detail: r.detail };
    default:
      return { verdict: r.verdict, detail: r.detail || undefined };
  }
}

interface Compiled {
  ok: boolean;
  output: string;
  files: [string, string][];
  argv: string[];
}

async function compile(job: JudgeJob, dir: string): Promise<Compiled> {
  const info = LANGUAGE_INFO[job.language];
  const src = path.join(dir, info.source);
  await writeFile(src, Buffer.from(job.codeB64, "base64"), { mode: 0o600 });
  const box = `/box/${info.source}`;

  if (job.language === "python") {
    // Byte-compile only, so syntax errors come back as CE, not RE.
    const r = await runbox({
      rootfs: config.runRootfs, timeMs: 5000, memMb: 256, files: [[src, box]],
      argv: ["/usr/bin/python3", "-c", `compile(open(${JSON.stringify(box)}).read(), "main.py", "exec")`],
    });
    // IE is the sandbox failing (missing image, setup error), not the code.
    if (r.verdict === "IE") throw new Error(`sandbox error during syntax check: ${r.detail}`);
    const ok = r.verdict === "OK";
    return { ok, output: ok ? "" : cleanCompilerOutput(r), files: [[src, box]], argv: ["/usr/bin/python3", box] };
  }

  const prog = path.join(dir, "prog");
  const cc = job.language === "cpp"
    ? ["/usr/bin/g++", "-std=gnu++17", "-O2", "-pipe", "-DONLINE_JUDGE", "-o", "/box/prog", box]
    : ["/usr/bin/gcc", "-std=gnu11", "-O2", "-pipe", "-DONLINE_JUDGE", "-o", "/box/prog", box, "-lm"];
  const r = await runbox({
    rootfs: config.compileRootfs, timeMs: 15_000, wallMs: 30_000, memMb: 1024, pids: 32,
    output: "64M", files: [[src, box]], exports: [["/box/prog", prog]], argv: cc,
  });
  if (r.verdict === "IE") throw new Error(`sandbox error during compile: ${r.detail}`);
  const ok = r.verdict === "OK" && r.exported;
  return { ok, output: cleanCompilerOutput(r), files: [[prog, "/box/prog"]], argv: ["/box/prog"] };
}

function cleanCompilerOutput(r: RunboxResult): string {
  let text = r.stderr || r.stdout.toString("utf8");
  if (r.verdict === "TLE") text = `Compilation timed out.\n${text}`;
  if (r.verdict === "MLE") text = `Compiler ran out of memory.\n${text}`;
  return clip(text.replaceAll("/box/", ""), 8000);
}

export type Completed = Extract<ExecEvent, { type: "completed" }>;

/** Compiles and runs one job, streaming progress events. The caller stores
 * the returned "completed" event and then publishes it, so a browser that
 * sees it can already read the final row. */
export async function judge(job: JudgeJob, sql: Sql, redis: EvalRedis): Promise<Completed> {
  const emit = (e: ExecEvent) => publishEvent(redis, job.submissionId, e);
  const dir = path.join(config.workDir, job.submissionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  try {
    await sql`UPDATE submissions SET status = 'running' WHERE id = ${job.submissionId}`;
    await emit({ type: "compiling", at: Date.now() });
    const c = await compile(job, dir);
    if (!c.ok) {
      return {
        type: "completed", at: Date.now(), verdict: "CE", passed: 0,
        total: 0, timeMs: 0, memoryKb: 0, compileOutput: c.output || "Compilation failed.",
      };
    }

    const tests = job.tests === "all" ? await loadTests(sql, job.problemId) : job.tests;
    const timeMs = job.timeMs;
    let passed = 0, maxTime = 0, maxMem = 0;
    let firstFail: { verdict: Verdict; test: number; detail?: string } | undefined;

    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      await emit({ type: "running", at: Date.now(), test: i + 1, total: tests.length });
      const r = await runbox({
        rootfs: config.runRootfs, timeMs, memMb: job.memoryMb, pids: 16,
        files: c.files, argv: c.argv, stdin: Buffer.from(t.inputB64, "base64"),
      });
      const expected = t.expectedB64 === undefined ? undefined : Buffer.from(t.expectedB64, "base64").toString("utf8");
      const v = verdictOf(r, expected);
      maxTime = Math.max(maxTime, r.cpu_time_ms);
      maxMem = Math.max(maxMem, r.memory_kb);
      if (v.verdict === "AC") passed++;
      else if (!firstFail) firstFail = { verdict: v.verdict, test: i + 1, detail: v.detail };

      await emit({
        type: "test_result", at: Date.now(), test: i + 1, total: tests.length,
        verdict: v.verdict, timeMs: Math.round(r.cpu_time_ms), memoryKb: r.memory_kb, hidden: t.hidden,
        ...(v.detail ? { detail: v.detail } : {}),
        ...(t.hidden ? {} : {
          displayInput: t.displayInput,
          input: clip(Buffer.from(t.inputB64, "base64").toString("utf8")),
          output: clip(r.stdout.toString("utf8")),
          ...(expected !== undefined ? { expected: clip(expected) } : {}),
          stderr: clip(r.stderr, 4000),
        }),
      });
      // "submit" stops at the first failure, like most judges; "run" shows every case.
      if (firstFail && job.mode === "submit") break;
    }

    return {
      type: "completed", at: Date.now(),
      verdict: firstFail?.verdict ?? "AC",
      passed, total: tests.length, timeMs: Math.round(maxTime), memoryKb: maxMem,
      ...(firstFail ? { failedTest: firstFail.test } : {}),
      ...(firstFail?.detail ? { detail: firstFail.detail } : {}),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
