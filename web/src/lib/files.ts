import { unzipSync } from 'fflate';
import type { Language } from './types';

export const MAX_SOURCE_BYTES = 64 * 1024;
export const MAX_TEST_BYTES = 50 * 1024 * 1024;
export const SOURCE_ACCEPT = '.cpp,.cc,.cxx,.c++,.hpp,.h,.c,.py,.txt';
export const TEST_ACCEPT = '.in,.out,.ans,.txt,.zip';

const EXT_LANG: Record<string, Language> = {
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  'c++': 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  c: 'c',
  h: 'c',
  py: 'py',
  pyw: 'py',
};

export function extension(name: string): string {
  const base = name.split('/').pop() ?? name;
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function detectLanguage(name: string): Language | null {
  return EXT_LANG[extension(name)] ?? null;
}

export const LANGUAGE_EXT: Record<Language, string> = { cpp: 'cpp', c: 'c', py: 'py' };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export interface SourceFile {
  name: string;
  size: number;
  text: string;
  language: Language | null;
}

/** Reads a solution file the user picked or dropped, with the judge's size and text checks. */
export async function readSourceFile(file: File): Promise<SourceFile> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}. Source files can be at most 64 KB.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksBinary(bytes)) {
    throw new Error(`${file.name} looks like a binary file. Upload the source code itself (.cpp, .c or .py).`);
  }
  const text = new TextDecoder('utf-8').decode(bytes).replace(/\r\n/g, '\n');
  if (!text.trim()) throw new Error(`${file.name} is empty.`);
  return { name: file.name, size: file.size, text, language: detectLanguage(file.name) };
}

/* ---------------- Test cases ---------------- */

export interface TestFile {
  path: string;
  bytes: Uint8Array;
}

export interface TestPair {
  key: string;
  input: TestFile;
  output: TestFile;
}

/** Flattens picked files and any .zip archives into plain test files. */
export async function collectTestFiles(files: File[]): Promise<TestFile[]> {
  const out: TestFile[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (extension(f.name) === 'zip') {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(bytes);
      } catch {
        throw new Error(`${f.name} could not be opened as a zip archive.`);
      }
      for (const [path, data] of Object.entries(entries)) {
        const name = path.split('/').pop() ?? '';
        if (path.endsWith('/') || path.startsWith('__MACOSX/') || name.startsWith('.')) continue;
        out.push({ path, bytes: data });
      }
    } else {
      out.push({ path: f.name, bytes });
    }
  }
  return out;
}

function classify(path: string): { role: 'in' | 'out'; key: string } | null {
  const lower = path.toLowerCase();
  const dir = lower.match(/(?:^|\/)(inputs?|in|outputs?|out|answers?|ans)\/([^/]+)$/);
  if (dir) {
    const role = dir[1].startsWith('in') ? 'in' : 'out';
    return { role, key: dir[2].replace(/\.[^.]+$/, '') };
  }
  const ext = extension(lower);
  const stem = lower.replace(/\.[^./]+$/, '');
  if (ext === 'in') return { role: 'in', key: stem };
  if (ext === 'out' || ext === 'ans') return { role: 'out', key: stem };
  const base = lower.split('/').pop() ?? lower;
  const prefix = lower.slice(0, lower.length - base.length);
  const named = base.match(/^(input|in|output|out|answer|ans)[_-]?(.+?)(\.txt)?$/);
  if (named) {
    return { role: named[1].startsWith('in') ? 'in' : 'out', key: prefix + named[2] };
  }
  return null;
}

/** Pairs inputs with outputs: 1.in/1.out, 1.in/1.ans, input1.txt/output1.txt, or input/1.txt with output/1.txt. */
export function pairTests(files: TestFile[]): { pairs: TestPair[]; unmatched: string[] } {
  const ins = new Map<string, TestFile>();
  const outs = new Map<string, TestFile>();
  const unmatched: string[] = [];
  for (const f of files) {
    const c = classify(f.path);
    if (!c) {
      unmatched.push(f.path);
      continue;
    }
    (c.role === 'in' ? ins : outs).set(c.key, f);
  }
  const pairs: TestPair[] = [];
  for (const [key, input] of ins) {
    const output = outs.get(key);
    if (output) {
      pairs.push({ key, input, output });
      outs.delete(key);
    } else unmatched.push(input.path);
  }
  for (const f of outs.values()) unmatched.push(f.path);
  pairs.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return { pairs, unmatched };
}

export function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text.endsWith('\n') ? text : `${text}\n`);
}
