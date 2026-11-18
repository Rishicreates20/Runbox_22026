/**
 * End-to-end check of queue -> judge -> runbox -> events. Needs Postgres and
 * Redis with the seed problems loaded, and a running worker (`npm run judge`).
 *
 *   npx tsx judge/test/e2e.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import postgres from "postgres";
import { ExecEvent, enqueueSubmission, keys, type Language, type SubmissionRequest } from "@codeplus/shared";
import { config } from "../src/config.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = postgres(config.databaseUrl);
const redis = new Redis(config.redisUrl);
const sol = (f: string) => readFile(path.join(here, "solutions", f), "utf8");

type Case = { name: string; problem: string; language: Language; code: string; mode?: "run" | "submit";
  customInputs?: string[]; want: string; check?: (events: ExecEvent[]) => string | undefined };

const cases: Case[] = [
  { name: "two-sum C++ reference", problem: "two-sum", language: "cpp", code: await sol("two-sum.cpp"), want: "AC" },
  { name: "two-sum Python reference", problem: "two-sum", language: "python", code: await sol("two-sum.py"), want: "AC" },
  { name: "max-sum-window C reference", problem: "max-sum-window", language: "c", code: await sol("max-sum-window.c"), want: "AC" },
  { name: "max-sum-window Python reference", problem: "max-sum-window", language: "python", code: await sol("max-sum-window.py"), want: "AC" },
  { name: "shortest-hops C++ reference", problem: "shortest-hops", language: "cpp", code: await sol("shortest-hops.cpp"), want: "AC" },
  { name: "valid-parentheses Python reference", problem: "valid-parentheses", language: "python", code: await sol("valid-parentheses.py"), want: "AC" },
  { name: "climbing-stairs C reference", problem: "climbing-stairs", language: "c", code: await sol("climbing-stairs.c"), want: "AC" },
  {
    name: "climbing-stairs with int overflow", problem: "climbing-stairs", language: "cpp",
    code: "#include <cstdio>\nint main(){int n;scanf(\"%d\",&n);int a=1,b=1;for(int i=0;i<n;i++){int c=a+b;a=b;b=c;}printf(\"%d\\n\",a);}",
    want: "WA",
    check: (ev) => {
      const done = ev.at(-1) as Extract<ExecEvent, { type: "completed" }>;
      return done.failedTest === 6 ? undefined : `failedTest=${done.failedTest}, want 6 (n = 46)`;
    },
  },
  { name: "starter code is wrong", problem: "two-sum", language: "python", code: "print(0, 1)\n", want: "WA" },
  { name: "compile error", problem: "two-sum", language: "cpp", code: "int main() { return x; }", want: "CE",
    check: (ev) => ((ev.at(-1) as { compileOutput?: string }).compileOutput?.includes("'x' was not declared") ? undefined : "no compiler message") },
  { name: "python syntax error", problem: "two-sum", language: "python", code: "def f(:\n", want: "CE" },
  { name: "infinite loop", problem: "climbing-stairs", language: "cpp", code: "int main(){volatile long x=0;for(;;)x++;}", want: "TLE" },
  { name: "memory hog", problem: "climbing-stairs", language: "python", code: "x = bytearray(1 << 30)\n", want: "MLE" },
  { name: "segfault", problem: "climbing-stairs", language: "c", code: "int main(void){*(volatile int*)0=1;return 0;}", want: "RE" },
  { name: "fork() is fine, socket() is refused", problem: "climbing-stairs", language: "python",
    code: "import os, socket\ntry:\n    socket.socket()\nexcept OSError:\n    pass\nos.fork() or os._exit(0)\nn=int(input());a,b=1,1\nfor _ in range(n): a,b=b,a+b\nprint(a)\n",
    want: "AC" },
  { name: "blocked syscall (mount)", problem: "climbing-stairs", language: "c",
    code: "#include <sys/mount.h>\nint main(void){mount(\"none\",\"/box\",\"tmpfs\",0,0);return 0;}", want: "RE",
    check: (ev) => (ev.some((e) => e.type === "test_result" && e.detail === "blocked system call") ? undefined : "no 'blocked system call' detail") },
  { name: "run mode: samples", problem: "two-sum", language: "cpp", code: await sol("two-sum.cpp"), mode: "run", want: "AC",
    check: (ev) => (ev.filter((e) => e.type === "test_result" && e.expected !== undefined).length === 3 ? undefined : "expected 3 checked samples") },
  { name: "run mode: custom CRLF input", problem: "climbing-stairs", language: "python", code: "print(repr(input()))\n", mode: "run",
    customInputs: ["5\r\n"], want: "AC",
    check: (ev) => { const r = ev.find((e) => e.type === "test_result"); return r && "output" in r && r.output === "'5'\n" ? undefined : `output ${JSON.stringify(r && "output" in r ? r.output : null)}`; } },
];

async function waitForCompletion(id: string): Promise<ExecEvent[]> {
  const events: ExecEvent[] = [];
  let last = "0";
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const res = (await redis.xread("BLOCK", 2000, "STREAMS", keys.events(id), last)) as [string, [string, string[]][]][] | null;
    for (const [, entries] of res ?? []) {
      for (const [eid, fields] of entries) {
        last = eid;
        const e = ExecEvent.parse(JSON.parse(fields[1]));
        events.push(e);
        if (e.type === "completed") return events;
      }
    }
  }
  throw new Error("timed out");
}

let failures = 0;
const t0 = Date.now();
// Submit everything at once so the worker's slots run in parallel.
const started = await Promise.all(cases.map(async (c) => {
  const req: SubmissionRequest = { problem: c.problem as SubmissionRequest["problem"], language: c.language, code: c.code,
    mode: c.mode ?? "submit", ...(c.customInputs ? { customInputs: c.customInputs } : {}) };
  const r = await enqueueSubmission(sql, redis, req, "e2e-test-client-000");
  if ("error" in r) throw new Error(r.error);
  return { c, id: r.id };
}));
for (const { c, id } of started) {
  const events = await waitForCompletion(id);
  const done = events.at(-1) as Extract<ExecEvent, { type: "completed" }>;
  const why = done.verdict !== c.want ? `got ${done.verdict}` : c.check?.(events);
  if (why) failures++;
  console.log(`[${why ? "FAIL" : "PASS"}] ${c.name.padEnd(42)} ${done.verdict.padEnd(3)} ${done.passed}/${done.total} ` +
    `${done.timeMs}ms ${done.memoryKb}KB ${why ?? ""}${why && done.detail ? ` (${done.detail})` : ""}`);
  const [row] = await sql`SELECT status, verdict FROM submissions WHERE id = ${id}`;
  if (row.status !== "done" || row.verdict !== done.verdict) {
    failures++;
    console.log(`       database row not updated: ${JSON.stringify(row)}`);
  }
}
console.log(`\n${cases.length - failures}/${cases.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await sql`DELETE FROM submissions WHERE client_id = 'e2e-test-client-000'`;
await sql.end();
redis.disconnect();
process.exit(failures ? 1 : 0);
