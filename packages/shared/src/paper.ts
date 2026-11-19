import { z } from "zod";
import { normalizeNewlines } from "./problem.ts";

/* -------------------------------------------------------------------------
 * Mock papers: turning a document's text into questions.
 *
 * The importer converts every source (DOCX, PPTX, PDF, pasted text, a web
 * page) to Markdown-ish text. `splitPaper` then finds where each question
 * starts and pulls out sample input/output pairs it can check code against.
 * It runs in the browser too, so the review step re-splits live as the user
 * edits the text.
 * ---------------------------------------------------------------------- */

export interface PaperExample {
  input: string;
  output: string;
}

export type PaperDifficulty = "easy" | "medium" | "hard";

export interface SplitQuestion {
  title: string;
  difficulty?: PaperDifficulty;
  statement: string;
  examples: PaperExample[];
}

export interface SplitPaper {
  /** Best guess at the paper's name (first heading or first line). */
  title: string;
  /** Text before the first question: instructions, marks, etc. */
  intro: string;
  questions: SplitQuestion[];
  /** Time limit the paper states ("Duration 90 minutes", "TIME: 3 HOURS"), if any. */
  durationMin?: number;
  /** How the questions were found, shown in the review step. */
  method: "labels" | "headings" | "numbers" | "separators" | "whole";
}

const KEYWORD = /^(q(?:uestion|ues|n)?|problem|prob|task|exercise|challenge)\s*\.?\s*(?:no\.?\s*)?#?\s*/i;
const KEYWORD_REST = /^(\d{1,3}|[A-Z])(?![A-Za-z0-9])\s*[:.)\-–—]?\s*(.*)$/;
const NUMBERED = /^(\d{1,2})\s*\\?[.)]\s+(\S.*)$/;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,}|(?:\* ){2,}\*|(?:- ){2,}-)\s*$/;

/** Strips Markdown decoration around a line: heading marks, bold, quotes. */
function bare(line: string): string {
  return line
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*(?:\*\*|__)\s*/, "")
    .replace(/\s*(?:\*\*|__)\s*/g, " ")
    .trim();
}

/** Undoes the backslash escapes Turndown adds (\[, \_, \*, 1\. …). */
export function unescapeMd(s: string): string {
  return s.replace(/\\([\\`*_{}\[\]()#+\-.!>|~<])/g, "$1");
}

function cleanTitle(s: string): string {
  return unescapeMd(s)
    .replace(/[*_`]+/g, "")
    .replace(/^[\s:.)\-–—]+|[\s:.\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 100)
    .trim();
}

interface Marker {
  line: number;
  title: string;
}

/** Lines like "Q1", "Question 2: Title", "Problem C", "**Task 3.** Title". */
function keywordMarkers(lines: string[]): Marker[] {
  const out: Marker[] = [];
  let prev = -1;
  lines.forEach((raw, i) => {
    const s = bare(raw);
    const k = KEYWORD.exec(s);
    if (!k) return;
    const m = KEYWORD_REST.exec(s.slice(k[0].length));
    if (!m) return;
    // A lone "Q" or "Task" followed by a capital letter word isn't a label.
    if (/^[A-Z]$/.test(m[1]) && k[1].length === 1) return;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1].charCodeAt(0) - 64;
    if (n <= prev) return; // keep the sequence increasing; skips "see Question 1"
    prev = n;
    out.push({ line: i, title: cleanTitle(m[2]) });
  });
  return out;
}

/** Top-level "1." / "2)" lines forming the chain 1, 2, 3, … */
function numberedMarkers(lines: string[]): Marker[] {
  const out: Marker[] = [];
  let want = 1;
  lines.forEach((raw, i) => {
    if (/^\s/.test(raw)) return; // indented: a nested list inside a question
    const m = NUMBERED.exec(bare(raw));
    if (!m || Number(m[1]) !== want) return;
    want++;
    out.push({ line: i, title: "" });
  });
  return out;
}

/** Markdown headings at the level that repeats most (H1–H3). */
function headingMarkers(lines: string[]): Marker[] {
  const byLevel = new Map<number, Marker[]>();
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    const m = !inFence && HEADING.exec(l);
    if (!m) return;
    const level = m[1].length;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push({ line: i, title: cleanTitle(m[2]) });
  });
  let best: Marker[] = [];
  for (const level of [1, 2, 3]) {
    const ms = byLevel.get(level) ?? [];
    if (ms.length >= 2 && ms.length > best.length) best = ms;
  }
  return best;
}

function separatorMarkers(lines: string[]): Marker[] {
  const out: Marker[] = [{ line: -1, title: "" }];
  lines.forEach((l, i) => HR.test(l) && out.push({ line: i, title: "" }));
  return out.length >= 2 ? out : [];
}

function firstLine(text: string): string {
  for (const l of text.split("\n")) {
    const t = cleanTitle(bare(l));
    if (t) return t;
  }
  return "";
}

/** Splits a document's text into questions. Never throws. */
export function splitPaper(text: string): SplitPaper {
  const src = normalizeNewlines(text)
    .replace(/ /g, " ")
    .replace(/[​‌‍﻿]/g, "")
    .replace(/\n{4,}/g, "\n\n\n");
  const lines = src.split("\n");

  let method: SplitPaper["method"] = "labels";
  let markers = keywordMarkers(lines);
  let skipMarkerLine = false;
  if (markers.length === 0) {
    method = "headings";
    markers = headingMarkers(lines);
  }
  if (markers.length < 2) {
    const nums = numberedMarkers(lines);
    if (nums.length >= 2) {
      method = "numbers";
      markers = nums;
    }
  }
  if (markers.length < 2 && method !== "labels") {
    const seps = separatorMarkers(lines);
    if (seps.length >= 2) {
      method = "separators";
      markers = seps;
      skipMarkerLine = true;
    }
  }
  if (markers.length === 0 || (markers.length === 1 && method !== "labels")) {
    method = "whole";
    markers = [{ line: -1, title: "" }];
    skipMarkerLine = true;
  }

  const intro = markers[0].line > 0 ? lines.slice(0, markers[0].line).join("\n").trim() : "";
  const questions: SplitQuestion[] = [];
  markers.forEach((m, k) => {
    const end = k + 1 < markers.length ? markers[k + 1].line : lines.length;
    const from = skipMarkerLine ? m.line + 1 : m.line;
    let body = lines.slice(Math.max(0, from), end).join("\n").trim();
    if (method === "labels" || method === "headings") {
      // The label line becomes the title; drop it from the statement when
      // that leaves something to read.
      const rest = lines.slice(m.line + 1, end).join("\n").trim();
      if (rest) body = rest;
    }
    if (!body) return;
    const n = questions.length + 1;
    let title = m.title;
    if (!title || /^\d+$/.test(title)) {
      const fl = firstLine(method === "numbers" ? body.replace(NUMBERED, "$2") : body);
      title = fl.length > 60 ? fl.slice(0, 57).trimEnd() + "…" : fl;
    }
    const examples = findExamples(body);
    if (examples.converted) body += `\n\n${CONVERTED_NOTE}`;
    // "Two Sum EASY", "Two Sum (Medium)": keep the level apart from the title.
    let difficulty: PaperDifficulty | undefined;
    title = title.replace(/\s*[-–—|(\[]?\s*\b(easy|medium|hard)\b\s*[)\]]?\s*$/i, (_, d: string) => {
      difficulty = d.toLowerCase() as PaperDifficulty;
      return "";
    }) || title;
    questions.push({
      title: title || `Question ${n}`,
      ...(difficulty ? { difficulty } : {}),
      statement: body,
      examples: examples.map((e) => ({ ...e, input: reflowInput(e.input, body) })),
    });
  });

  const title =
    (intro && firstLine(intro)) || (method === "whole" || method === "separators" ? firstLine(src) : "") || "Mock paper";
  return { title: title.slice(0, 120), intro, questions, method, ...statedDuration(intro || src.slice(0, 3000)) };
}

function statedDuration(text: string): { durationMin?: number } {
  const m =
    /\b(?:time|duration|time allowed|total time)\b[^\n\d]{0,20}(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|minutes|mins?)/i.exec(text) ??
    /\b(\d+(?:\.\d+)?)\s*(hours?|hrs?)\b/i.exec(text);
  if (!m) return {};
  const min = Math.round(Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1));
  return min >= 5 && min <= 600 ? { durationMin: min } : {};
}

/* ---------------------------- examples ---------------------------------- */

type Label = "input" | "output" | "stop";

const PREFIX = String.raw`(?:(?:sample|example|test|expected|your|correct)\s*(?:test\s*)?(?:case\s*)?(?:#?\d+\s*)?[:.\-–)]?\s*)`;
const WORD = String.raw`(input|output|stdin|stdout|i\s*\/\s*p|o\s*\/\s*p|explanation|explaination|note|notes|constraints?|hint)`;
const LABEL = new RegExp(
  String.raw`^(${PREFIX})?${WORD}\s*(#?\d+)?\s*(format|specification|description|type)?\s*(\d+)?\s*([:：=\-–]|\s+is\b)?\s*(.*)$`,
  "i",
);
const EXAMPLE_HEAD = /^(?:sample|example|test)s?\s*(?:test\s*)?(?:case\s*)?#?\d*\s*[:.)\-–]?\s*$/i;

interface LabelInfo {
  kind: Label;
  rest: string;
  format: boolean;
  /** "Sample Input", "Input:" … as opposed to a bare "Input" heading. */
  strong: boolean;
}

function labelOf(line: string): LabelInfo | null {
  const s = bare(line).replace(/^[*_`|]+|[*_`|]+$/g, "").trim();
  if (EXAMPLE_HEAD.test(s)) return { kind: "stop", rest: "", format: false, strong: true };
  const m = LABEL.exec(s);
  if (!m) return null;
  const rest = m[7].replace(/^[*_`]+|[*_`]+$/g, "").trim();
  const sep = Boolean(m[6]);
  // "Input the number of…" is a sentence, not a label.
  if (rest && !sep && !looksLikeData(rest)) return null;
  const w = m[2].toLowerCase().replace(/\s+/g, "");
  const kind: Label = w === "input" || w === "stdin" || w === "i/p" ? "input" : w === "output" || w === "stdout" || w === "o/p" ? "output" : "stop";
  return { kind, rest, format: Boolean(m[4]), strong: Boolean(m[1]) || sep };
}

/** True for lines that look like program data rather than prose. */
function looksLikeData(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  const words = t.split(/\s+/);
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  if (letters / t.length < 0.5) return true;
  return words.length <= 6 && t.length <= 60 && !/[.?!]$/.test(t);
}

function stripLine(l: string): string {
  return unescapeMd(l.replace(/^\s*`(.*)`\s*$/, "$1")).replace(/\s+$/, "");
}

const FENCE = /^\s*(```|~~~)/;

/** Reads one example block starting after a label line. */
function readBlock(lines: string[], start: number, first: string, strong: boolean): { text: string; next: number } {
  const got: string[] = [];
  if (first) got.push(stripLine(first));
  let i = start;
  // Skip blank lines, then accept a fenced block if one starts here.
  while (i < lines.length && !lines[i].trim()) i++;
  if (!first && i < lines.length && FENCE.test(lines[i])) {
    const fence = lines[i].trim().slice(0, 3);
    i++;
    while (i < lines.length && !lines[i].trim().startsWith(fence)) got.push(lines[i++].replace(/\s+$/, ""));
    return { text: got.join("\n").replace(/^\n+|\n+$/g, ""), next: i + 1 };
  }
  i = start;
  let sawBlank = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) {
      if (got.length && FENCE.test(lines[i + 1] ?? "")) break;
      if (got.length) sawBlank = true;
      continue;
    }
    if (labelOf(l) || HEADING.test(l) || HR.test(l) || FENCE.test(l) || /^\s*\|/.test(l)) break;
    const t = stripLine(l);
    // Under a clear "Sample Input:" label the first lines are data even when
    // they read like prose (string inputs); later prose is commentary.
    if (!looksLikeData(t) && !(strong && got.length === 0) && !(strong && !sawBlank && got.length < 3)) break;
    got.push(t);
  }
  return { text: got.join("\n").trim(), next: i };
}

/* ---- LeetCode-style "nums = [2,7], target = 9" → stdin ---- */

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = "", cur = "", escaped = false;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if ("[({".includes(ch)) depth++;
    if ("])}".includes(ch)) depth--;
    if ((ch === "," || ch === "\n" || ch === ";") && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseValue(raw: string): unknown {
  // Integers past 2^53 would be rounded by JSON.parse; quote them so they
  // come through digit for digit.
  const t = raw.trim().replace(/(^|[\[,\s:])(-?\d{16,})(?=$|[\],\s])/g, '$1"$2"');
  try {
    return JSON.parse(t);
  } catch {}
  try {
    return JSON.parse(t.replace(/'/g, '"').replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null"));
  } catch {}
  return t;
}

function scalar(v: unknown): string {
  return v === null ? "null" : typeof v === "string" ? v : String(v);
}

/** One value as stdin: arrays as their length then the items; grids as "rows cols". */
function encodeValue(v: unknown): string {
  if (!Array.isArray(v)) return scalar(v);
  if (v.length > 0 && v.every(Array.isArray)) {
    const rows = v as unknown[][];
    const cols = rows[0].length;
    if (rows.every((r) => r.length === cols)) return [`${rows.length} ${cols}`, ...rows.map((r) => r.map(scalar).join(" "))].join("\n");
    return [String(rows.length), ...rows.map((r) => [r.length, ...r.map(scalar)].join(" "))].join("\n");
  }
  return `${v.length}\n${v.map(scalar).join(" ")}`;
}

/** Output values: arrays as space-separated items (a grid as lines). */
function encodeOutput(raw: string): string {
  const v = parseValue(raw);
  if (Array.isArray(v)) {
    if (v.length > 0 && v.every(Array.isArray)) return (v as unknown[][]).map((r) => r.map(scalar).join(" ")).join("\n");
    return v.map(scalar).join(" ");
  }
  return typeof v === "string" ? v : scalar(v);
}

const ASSIGN = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/;

/** Converts "a = [1,2], k = 3" to stdin, or returns null if it isn't that shape. */
export function assignmentsToStdin(input: string): string | null {
  const parts = splitTopLevel(input);
  if (!parts.length || !parts.every((p) => ASSIGN.test(p))) return null;
  return parts.map((p) => encodeValue(parseValue(ASSIGN.exec(p)![2]))).join("\n");
}

export const CONVERTED_NOTE =
  "**Input on stdin:** the examples were written as `name = value`. Your program reads each value on its own line, in the order shown: a number or string as-is, a list as its length on one line and then its items separated by spaces, and a grid as `rows cols` and then one row per line. Print a list as its items separated by spaces.";

/* ---- tables: | Input | Output | ---- */

function tableExamples(lines: string[]): PaperExample[] {
  const out: PaperExample[] = [];
  const cells = (l: string) =>
    l.trim().replace(/^\||\|$/g, "").split("|").map((c) => unescapeMd(c.trim().replace(/<br\s*\/?>/gi, "\n").replace(/^`|`$/g, "")));
  for (let i = 0; i + 2 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 2 - 1])) continue;
    const head = cells(lines[i]).map((h) => h.toLowerCase().replace(/[*_]/g, ""));
    const ci = head.findIndex((h) => /\b(input|stdin|i\/p)\b/.test(h));
    const co = head.findIndex((h) => /\b(output|stdout|o\/p)\b/.test(h));
    if (ci < 0 || co < 0) continue;
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const row = cells(lines[j]);
      if (row[ci]?.trim() && row[co]?.trim()) out.push({ input: row[ci].trim(), output: row[co].trim() });
    }
  }
  return out;
}

/** Splits "Input: 5 Output: 25" written on one line into two lines. */
function splitInline(lines: string[]): string[] {
  return lines.flatMap((l) => {
    if (!/\b(input|i\/p)\s*[:：=]/i.test(l)) return [l];
    return l.split(/[,;]?\s+(?=(?:\*\*)?(?:sample\s+|expected\s+)?(?:output|o\/p|explanation)(?:\*\*)?\s*[:：=])/i);
  });
}

/**
 * Finds example input/output pairs in a question's text: "Sample Input" /
 * "Sample Output" blocks, "Input:"/"Output:" (also I/P, O/P, stdin, Expected
 * Output), fenced code blocks, Input|Output tables, and LeetCode-style
 * "nums = [..]" examples (converted to stdin; see CONVERTED_NOTE).
 */
export function findExamples(text: string): PaperExample[] & { converted?: boolean } {
  const lines = splitInline(normalizeNewlines(text).split("\n"));
  const out: PaperExample[] & { converted?: boolean } = [];
  let pendingInput: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const lab = labelOf(lines[i]);
    if (!lab || lab.format) continue;
    if (lab.kind === "stop") continue;
    const { text: block, next } = readBlock(lines, i + 1, lab.rest, lab.strong);
    if (lab.kind === "input") pendingInput = block;
    else if (pendingInput !== null) {
      if (pendingInput.trim() && block.trim()) {
        const stdin = assignmentsToStdin(pendingInput);
        if (stdin !== null) {
          out.push({ input: stdin, output: encodeOutput(block) });
          out.converted = true;
        } else out.push({ input: pendingInput, output: block });
      }
      pendingInput = null;
    }
    i = Math.max(i, next - 1);
    if (out.length >= 10) break;
  }
  if (out.length === 0) out.push(...tableExamples(lines).slice(0, 10));
  return out;
}

/* ---- putting line breaks back from the Input Format section ---- */

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, single: 1, "a single": 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const ITEM = String.raw`(?:space[- ]separated\s+|positive\s+|non-negative\s+|distinct\s+)*(?:integers?|numbers?|values?|strings?|words?|elements?|characters?)`;
const BY_VAR = new RegExp(String.raw`\b([A-Z][A-Za-z0-9_]*)\s+${ITEM}\b`);
const BY_COUNT = new RegExp(String.raw`\b(a single|a|an|one|single|two|three|four|five|six|\d+)\s+${ITEM}\b\s*((?:[A-Z][A-Za-z0-9_]*)(?:\s*(?:,|and|&)\s*[A-Z][A-Za-z0-9_]*)*)?`, "i");
const LINE_REF = /\b(first|second|third|fourth|fifth|sixth|seventh|next|last|\d+(?:st|nd|rd|th))\s+line\b/i;

type LineSpec = { count: number | string; names: string[] };

/** Reads "The first line contains N and M…" lines of an Input Format section. */
function inputLineSpecs(statement: string): LineSpec[] | null {
  const lines = statement.split("\n");
  const start = lines.findIndex((l) => /^\W*input\s*(format|specification|description)\b/i.test(bare(l)));
  if (start < 0) return null;
  const specs: LineSpec[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = bare(lines[i]).replace(/^(?:[-*•▪◦·]|l(?=\s+[A-Z]))\s+/, "");
    if (/^\W*(output|constraints?|sample|example|explanation|note)\b/i.test(l)) break;
    if (!LINE_REF.test(l)) continue;
    const rest = l.slice(l.search(LINE_REF));
    if (/\beach of the\b|\bfollowing\b|\blines\b/i.test(rest)) return null; // "next N lines…": too varied
    const byCount = BY_COUNT.exec(rest);
    const byVar = BY_VAR.exec(rest);
    if (byVar && (!byCount || byVar.index < byCount.index)) specs.push({ count: byVar[1], names: [] });
    else if (byCount) {
      const w = byCount[1].toLowerCase();
      const count = NUMBER_WORDS[w] ?? Number(w);
      const names = (byCount[2] ?? "").split(/\s*(?:,|and|&)\s*/).filter(Boolean);
      specs.push({ count, names: names.length === count ? names : [] });
    } else return null;
  }
  return specs.length >= 2 ? specs : null;
}

/**
 * PDF text often loses the line breaks inside a sample ("3 3 400 700 200 300
 * 500 800"). When the input is on fewer lines than the Input Format describes,
 * re-split its tokens line by line; if the counts don't add up exactly, the
 * input is left as it was.
 */
export function reflowInput(input: string, statement: string): string {
  const specs = inputLineSpecs(statement);
  const have = input.trim().split("\n");
  if (!specs || have.length >= specs.length) return input;
  const tokens = input.trim().split(/\s+/);
  const vars: Record<string, number> = {};
  const out: string[] = [];
  let k = 0;
  for (const sp of specs) {
    const n = typeof sp.count === "number" ? sp.count : vars[sp.count];
    if (!Number.isInteger(n) || n < 0 || k + n > tokens.length) return input;
    const take = tokens.slice(k, k + n);
    sp.names.forEach((name, j) => (vars[name] = Number(take[j])));
    out.push(take.join(" "));
    k += n;
  }
  return k === tokens.length ? out.join("\n") : input;
}

/* ---------------------------- API schema -------------------------------- */

export const PaperExampleSchema = z.strictObject({
  input: z.string().max(20_000),
  output: z.string().max(20_000),
});

export const PaperQuestion = z.strictObject({
  title: z.string().trim().min(1).max(120),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  statement: z.string().trim().min(1, "a question has no text").max(40_000),
  examples: z.array(PaperExampleSchema).max(10),
});
export type PaperQuestion = z.infer<typeof PaperQuestion>;

/** Body of POST /api/papers. */
export const PaperCreate = z.strictObject({
  title: z.string().trim().min(1).max(120),
  source: z.string().max(500),
  durationMin: z.number().int().min(5).max(600),
  intro: z.string().max(20_000).default(""),
  questions: z.array(PaperQuestion).min(1, "no questions found").max(40, "at most 40 questions per paper"),
});
export type PaperCreate = z.infer<typeof PaperCreate>;

export const PAPER_FILE_TYPES = [".pdf", ".docx", ".pptx", ".txt", ".md"] as const;
export const MAX_PAPER_FILE_BYTES = 15 * 1024 * 1024;
