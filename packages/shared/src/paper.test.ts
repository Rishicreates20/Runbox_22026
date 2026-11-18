import { test } from "node:test";
import assert from "node:assert/strict";
import { CONVERTED_NOTE, findExamples, reflowInput, splitPaper } from "./paper.ts";

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

test("skips Input Format sections; converts LeetCode-style examples", () => {
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
  assert.deepEqual([...ex], [
    { input: "4\n2 7 11 15\n9", output: "0 1" },
    { input: "4\n1 2 3 4", output: "10" },
  ]);
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

test("one-line, I/P-O/P, Expected Output and table examples", () => {
  assert.deepEqual([...findExamples("Example: Input: 5 Output: 25")], [{ input: "5", output: "25" }]);
  assert.deepEqual([...findExamples("I/P: 3 4\nO/P: 7")], [{ input: "3 4", output: "7" }]);
  assert.deepEqual([...findExamples("Input:\n2\n1 2\nExpected Output:\n3")], [{ input: "2\n1 2", output: "3" }]);
  assert.deepEqual([...findExamples("| Input | Output |\n|---|---|\n| 2<br>1 2 | 3 |\n| hello | olleh |")], [
    { input: "2\n1 2", output: "3" },
    { input: "hello", output: "olleh" },
  ]);
});

test("a sentence under Sample Input is still data; a bare Input heading isn't", () => {
  assert.deepEqual([...findExamples("Sample Input:\nthe quick brown fox jumps over the lazy dog.\nSample Output:\n9")], [
    { input: "the quick brown fox jumps over the lazy dog.", output: "9" },
  ]);
  assert.deepEqual([...findExamples("Input\nThe first line contains an integer n, the number of items.\nOutput\nPrint the answer on one line.")], []);
});

test("converted questions get the stdin note", () => {
  const p = splitPaper("Q1 Two Sum\nExample 1:\nInput: nums = [3,2,4], target = 6\nOutput: [1,2]\n");
  assert.equal(p.questions[0].examples[0].input, "3\n3 2 4\n6");
  assert.ok(p.questions[0].statement.includes(CONVERTED_NOTE));
});

test("PDF-style one-line samples are split and reflowed from the Input Format", () => {
  const p = splitPaper(`Question 2: Stall Power MEDIUM
Input Format
l The first line contains two space-separated integers N and M — the number of stalls and generators.
l The second line contains N space-separated integers P1 ... PN — power needed by each stall.
l The third line contains M space-separated integers G1 ... GM — capacity of each generator.
Output Format
l Print a single integer.
Sample Test Case 1
Input: 3 3 400 700 200 300 500 800 Output: 3
Explanation: Assign the 300 W generator to the 200 W stall.
Sample Test Case 2
Input: 4 2 500 500 500 100 450 2000 Output: 2
Explanation: The 2000 W generator powers one stall.
`);
  const q = p.questions[0];
  assert.equal(q.title, "Stall Power");
  assert.equal(q.difficulty, "medium");
  assert.deepEqual(q.examples, [
    { input: "3 3\n400 700 200\n300 500 800", output: "3" },
    { input: "4 2\n500 500 500 100\n450 2000", output: "2" },
  ]);
});

test("reflow leaves input alone when counts don't match", () => {
  const st = "Input Format\nThe first line contains a single integer N.\nThe second line contains N integers.\n";
  assert.equal(reflowInput("3 1 2", st), "3 1 2");
  assert.equal(reflowInput("3 1 2 3", st), "3\n1 2 3");
});

test("the paper's stated time is picked up", () => {
  assert.equal(splitPaper("Mock\nMOCK TEST 1 TIME: 3 HOURS | QUESTIONS: 3\nQ1 A\nx\nQ2 B\ny").durationMin, 180);
  assert.equal(splitPaper("Mock\nDuration 90 minutes.\nQ1 A\nx").durationMin, 90);
  assert.equal(splitPaper("Q1 A\nx").durationMin, undefined);
});
