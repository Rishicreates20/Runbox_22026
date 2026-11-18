import { test } from "node:test";
import assert from "node:assert/strict";
import { findExamples, splitPaper } from "./paper.ts";

test("splits on Q1/Question 2 labels and keeps the intro", () => {
  const p = splitPaper(`Mid-term mock paper
Answer all questions. 90 minutes.

Q1. Sum of array
Read n and then n integers. Print their sum.

Sample Input
3
1 2 3

Sample Output
6

Question 2: Reverse a string
Read a line and print it reversed.
Input:
hello
Output:
olleh
`);
  assert.equal(p.method, "labels");
  assert.equal(p.title, "Mid-term mock paper");
  assert.match(p.intro, /Answer all questions/);
  assert.equal(p.questions.length, 2);
  assert.equal(p.questions[0].title, "Sum of array");
  assert.deepEqual(p.questions[0].examples, [{ input: "3\n1 2 3", output: "6" }]);
  assert.equal(p.questions[1].title, "Reverse a string");
  assert.deepEqual(p.questions[1].examples, [{ input: "hello", output: "olleh" }]);
});

test("ignores Input Format sections and LeetCode-style assignments", () => {
  const ex = findExamples(`Input Format
The first line contains an integer n, the size of the array.
Output Format
Print a single integer.
Example 1:
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Example 2
Input
\`\`\`
4
1 2 3 4
\`\`\`
Output
\`\`\`
10
\`\`\``);
  assert.deepEqual(ex, [{ input: "4\n1 2 3 4", output: "10" }]);
});

test("Markdown headings split when there are no labels", () => {
  const p = splitPaper(`# Practice set\n\n## Two sum\nFind two numbers.\n\n## Palindrome\nCheck a string.\n`);
  assert.equal(p.method, "headings");
  assert.deepEqual(p.questions.map((q) => q.title), ["Two sum", "Palindrome"]);
});

test("numbered list split skips indented sub-lists", () => {
  const p = splitPaper(`1. Write a program that prints the factorial of n.\n   1. n is at most 20\n   2. read from stdin\n2. Write a program that checks if n is prime.\n`);
  assert.equal(p.method, "numbers");
  assert.equal(p.questions.length, 2);
});

test("plain text with no structure is one question", () => {
  const p = splitPaper("Print hello world.");
  assert.equal(p.method, "whole");
  assert.equal(p.questions.length, 1);
  assert.equal(p.questions[0].statement, "Print hello world.");
});

test("prose mentioning a question number later is not a new question", () => {
  const p = splitPaper(`Q1 Count words\nRead text.\nQ2 Count vowels\nUse your Q1 code.\nQuestion 1 reminder: be careful.\n`);
  assert.equal(p.questions.length, 2);
});
