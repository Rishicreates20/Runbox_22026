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

export interface SplitQuestion {
  title: string;
  statement: string;
  examples: PaperExample[];
}

export interface SplitPaper {
  /** Best guess at the paper's name (first heading or first line). */
  title: string;
  /** Text before the first question: instructions, marks, etc. */
  intro: string;
  questions: SplitQuestion[];
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
    if (/^\s*```/.test(l)) inFence = !inFence;
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
    questions.push({ title: title || `Question ${n}`, statement: body, examples: findExamples(body) });
  });

  const title =
    (intro && firstLine(intro)) || (method === "whole" || method === "separators" ? firstLine(src) : "") || "Mock paper";
  return { title: title.slice(0, 120), intro, questions, method };
}

/* ---------------------------- examples ---------------------------------- */

type Label = "input" | "output" | "stop";

const LABEL =
  /^(?:(?:sample|example|test)\s*(?:case\s*)?(?:#?\d+\s*)?[:.\-–]?\s*)?(input|output|explanation|note|notes|constraints?)\s*(#?\d+)?\s*(format|specification|description)?\s*([:：])?\s*(.*)$/i;
const EXAMPLE_HEAD = /^(?:sample|example)s?\s*(?:test\s*)?(?:case\s*)?#?\d*\s*[:.]?\s*$/i;

function labelOf(line: string): { kind: Label; rest: string; format: boolean } | null {
  const s = bare(line).replace(/^[*_`]+|[*_`]+$/g, "").trim();
  if (EXAMPLE_HEAD.test(s)) return { kind: "stop", rest: "", format: false };
  const m = LABEL.exec(s);
  if (!m) return null;
  const rest = m[5].replace(/^[*_`]+|[*_`]+$/g, "").trim();
  // "Input the number of…" is a sentence, not a label.
  if (rest && !m[4] && !looksLikeData(rest)) return null;
  const word = m[1].toLowerCase();
  const kind: Label = word === "input" ? "input" : word === "output" ? "output" : "stop";
  return { kind, rest, format: Boolean(m[3]) };
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

/** Reads one example block starting after a label line. */
function readBlock(lines: string[], start: number, first: string): { text: string; next: number } {
  const got: string[] = [];
  if (first) got.push(stripLine(first));
  let i = start;
  // Skip blank lines, then accept a fenced block if one starts here.
  while (i < lines.length && !lines[i].trim()) i++;
  if (!first && i < lines.length && /^\s*(```|~~~)/.test(lines[i])) {
    const fence = lines[i].trim().slice(0, 3);
    i++;
    while (i < lines.length && !lines[i].trim().startsWith(fence)) got.push(lines[i++].replace(/\s+$/, ""));
    return { text: got.join("\n").replace(/^\n+|\n+$/g, ""), next: i + 1 };
  }
  i = start;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) {
      if (got.length && /^\s*(```|~~~)/.test(lines[i + 1] ?? "")) break;
      continue;
    }
    if (labelOf(l) || HEADING.test(l) || HR.test(l) || /^\s*(```|~~~)/.test(l)) break;
    if (!looksLikeData(stripLine(l))) break;
    got.push(stripLine(l));
  }
  return { text: got.join("\n"), next: i };
}

/** LeetCode-style "nums = [1,2], k = 3" isn't stdin; we can't run it as-is. */
function isAssignmentStyle(s: string): boolean {
  return /^[A-Za-z_]\w*\s*=\s*\S/.test(s.trim());
}

/** Finds Sample Input / Sample Output pairs in a question's text. */
export function findExamples(text: string): PaperExample[] {
  const lines = normalizeNewlines(text).split("\n");
  const out: PaperExample[] = [];
  let pendingInput: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const lab = labelOf(lines[i]);
    if (!lab || lab.format) continue;
    if (lab.kind === "stop") continue;
    const { text: block, next } = readBlock(lines, i + 1, lab.rest);
    if (lab.kind === "input") pendingInput = block;
    else if (pendingInput !== null) {
      if (pendingInput.trim() && block.trim() && !isAssignmentStyle(pendingInput)) {
        out.push({ input: pendingInput, output: block });
      }
      pendingInput = null;
    }
    i = Math.max(i, next - 1);
    if (out.length >= 10) break;
  }
  return out;
}

/* ---------------------------- API schema -------------------------------- */

export const PaperExampleSchema = z.strictObject({
  input: z.string().max(20_000),
  output: z.string().max(20_000),
});

export const PaperQuestion = z.strictObject({
  title: z.string().trim().min(1).max(120),
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
