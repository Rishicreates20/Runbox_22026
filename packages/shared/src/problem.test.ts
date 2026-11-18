import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemIngest, normalizeNewlines } from "./problem.ts";
import { SubmissionRequest } from "./events.ts";
import { outputsMatch } from "./compare.ts";

const base = {
  slug: "demo",
  title: "Demo",
  difficulty: "easy",
  statement: "Do it.",
  limits: { timeMs: { cpp: 1000, c: 1000, python: 3000 }, memoryMb: 256 },
};

test("CRLF is normalised and a trailing LF is added", () => {
  assert.equal(normalizeNewlines("4\r\n2 7 11 15\r\n9"), "4\n2 7 11 15\n9\n");
  const p = ProblemIngest.parse({
    ...base,
    problem_type: "generic",
    tests: [{ input: "1 2\r\n", displayInput: "a = 1, b = 2", expectedOutput: "3\r\n", sample: true }],
  });
  assert.equal(p.tests[0].input, "1 2\n");
  assert.equal(p.tests[0].expectedOutput, "3\n");
});

test("array_manipulation derives stdin and display from args", () => {
  const p = ProblemIngest.parse({
    ...base,
    problem_type: "array_manipulation",
    tests: [{ args: { target_array: [2, 7, 11, 15], k_value: 2 }, expectedOutput: "26", sample: true }],
  });
  assert.equal(p.tests[0].input, "4\n2 7 11 15\n2\n");
  assert.equal(p.tests[0].displayInput, "nums = [2,7,11,15], k = 2");
});

test("array_manipulation rejects negative k and unknown fields", () => {
  const r = ProblemIngest.safeParse({
    ...base,
    problem_type: "array_manipulation",
    tests: [{ args: { target_array: [1], k_value: -1, evil: 1 }, expectedOutput: "1", sample: true }],
  });
  assert.equal(r.success, false);
  const msgs = r.error!.issues.map((i) => i.message).join(" | ");
  assert.match(msgs, /k must be >= 0/);
  assert.match(msgs, /evil/);
});

test("graph_traversal checks node bounds", () => {
  const r = ProblemIngest.safeParse({
    ...base,
    problem_type: "graph_traversal",
    tests: [{ args: { adjacency_list: [[1], [5]], start_node: 3 }, expectedOutput: "1", sample: true }],
  });
  assert.equal(r.success, false);
  const msgs = r.error!.issues.map((i) => i.message);
  assert.ok(msgs.some((m) => m.includes("start_node must be < 2")));
  assert.ok(msgs.some((m) => m.includes("neighbour 5 of node 1")));
});

test("string_parsing validates the regex and every input", () => {
  const bad = ProblemIngest.safeParse({
    ...base,
    problem_type: "string_parsing",
    input_pattern: "[(",
    tests: [{ args: { input_string: "()" }, expectedOutput: "true", sample: true }],
  });
  assert.equal(bad.success, false);
  const mismatch = ProblemIngest.safeParse({
    ...base,
    problem_type: "string_parsing",
    input_pattern: "[()]*",
    tests: [{ args: { input_string: "(x)" }, expectedOutput: "false", sample: true }],
  });
  assert.equal(mismatch.success, false);
  assert.match(mismatch.error!.issues[0].message, /does not match input_pattern/);
});

test("python must get at least the C++ time limit", () => {
  const r = ProblemIngest.safeParse({
    ...base,
    limits: { timeMs: { cpp: 2000, c: 2000, python: 1000 }, memoryMb: 256 },
    problem_type: "generic",
    tests: [{ input: "", displayInput: "-", expectedOutput: "", sample: true }],
  });
  assert.equal(r.success, false);
});

test("at least one sample test is required", () => {
  const r = ProblemIngest.safeParse({
    ...base,
    problem_type: "generic",
    tests: [{ input: "1", displayInput: "1", expectedOutput: "1" }],
  });
  assert.equal(r.success, false);
});

test("submission request limits code size and mode", () => {
  assert.equal(SubmissionRequest.safeParse({ problem: "demo", language: "cpp", code: "x", mode: "submit" }).success, true);
  assert.equal(SubmissionRequest.safeParse({ problem: "demo", language: "java", code: "x", mode: "submit" }).success, false);
  assert.equal(SubmissionRequest.safeParse({ problem: "demo", language: "cpp", code: "x".repeat(70_000), mode: "run" }).success, false);
});

test("checker ignores trailing whitespace only", () => {
  assert.ok(outputsMatch("1 2  \n3\n\n", "1 2\n3"));
  assert.ok(!outputsMatch("1  2\n", "1 2\n"));
  assert.ok(outputsMatch("5\r\n", "5\n"));
});
