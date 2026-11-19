import { useSyncExternalStore } from 'react';
import { PROBLEMS as BUILT_IN } from '../data/problems';
import type { TestPair } from './files';
import { readJSON, writeJSON } from './storage';
import { supabase } from './supabase';
import type { Difficulty, Problem, Sample } from './types';

/**
 * The problem catalog: built-in problems shipped with the app, plus problems
 * admins create. Those come from Supabase, or from this browser in demo mode.
 */

interface CatalogState {
  problems: Problem[];
  /** True once custom problems for the current user have loaded (or failed to). */
  ready: boolean;
  error: string | null;
}

const LOCAL_KEY = 'codeplus.customProblems';
let state: CatalogState = { problems: BUILT_IN, ready: false, error: null };
let loadedFor: string | null | undefined;
const listeners = new Set<() => void>();

function set(next: Partial<CatalogState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

interface ProblemRow {
  id: number;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  summary: string;
  statement: string;
  input_spec: string;
  output_spec: string;
  constraints: string[];
  hint: string | null;
  samples: Sample[];
  time_limit_ms: number;
  memory_mb: number;
  output_mb: number;
  hidden_tests: number;
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function fromRow(r: ProblemRow): Problem {
  return {
    id: r.id,
    title: r.title,
    difficulty: r.difficulty,
    tags: r.tags ?? [],
    acceptance: null,
    timeLimitMs: r.time_limit_ms,
    memoryMb: r.memory_mb,
    outputMb: r.output_mb,
    hiddenTests: r.hidden_tests,
    summary: r.summary,
    statement: splitParagraphs(r.statement),
    input: r.input_spec,
    output: r.output_spec,
    samples: Array.isArray(r.samples) ? r.samples : [],
    constraints: r.constraints ?? [],
    hint: r.hint ?? undefined,
    custom: true,
  };
}

/** Loads the custom problems visible to this user. Called when the signed-in user changes. */
export async function loadCustomProblems(userId: string | null): Promise<void> {
  if (loadedFor === userId) return;
  loadedFor = userId;
  if (!userId) {
    set({ problems: BUILT_IN, ready: true, error: null });
    return;
  }
  if (!supabase) {
    set({ problems: [...BUILT_IN, ...readJSON<Problem[]>(LOCAL_KEY, [])], ready: true, error: null });
    return;
  }
  set({ ready: false });
  const { data, error } = await supabase.from('problems').select('*').order('id');
  if (loadedFor !== userId) return;
  if (error) {
    set({ problems: BUILT_IN, ready: true, error: 'Problems created on this site could not be loaded. Built-in problems still work.' });
    return;
  }
  set({ problems: [...BUILT_IN, ...(data as ProblemRow[]).map(fromRow)], ready: true, error: null });
}

export function useCatalog(): CatalogState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function useProblems(): Problem[] {
  return useCatalog().problems;
}

/** A problem by id. `ready` is false while custom problems are still loading. */
export function useProblem(id: number): { problem: Problem | undefined; ready: boolean } {
  const { problems, ready } = useCatalog();
  const problem = problems.find((p) => p.id === id);
  return { problem, ready: ready || problem !== undefined };
}

export function findProblem(problems: Problem[], id: number): Problem | undefined {
  return problems.find((p) => p.id === id);
}

export function neighboursIn(problems: Problem[], id: number): { prev?: Problem; next?: Problem } {
  const i = problems.findIndex((p) => p.id === id);
  return { prev: i > 0 ? problems[i - 1] : undefined, next: i >= 0 ? problems[i + 1] : undefined };
}

/* ---------------- Creating problems ---------------- */

export interface NewProblem {
  title: string;
  difficulty: Difficulty;
  tags: string[];
  summary: string;
  statement: string;
  input: string;
  output: string;
  constraints: string[];
  hint: string;
  samples: Sample[];
  timeLimitMs: number;
  memoryMb: number;
  outputMb: number;
}

export type CreateProgress = { step: 'saving' } | { step: 'uploading'; done: number; total: number } | { step: 'finishing' };

export async function createProblem(input: NewProblem, tests: TestPair[], onProgress: (p: CreateProgress) => void): Promise<Problem> {
  onProgress({ step: 'saving' });
  if (!supabase) {
    const existing = readJSON<Problem[]>(LOCAL_KEY, []);
    const id = Math.max(1000, ...existing.map((p) => p.id)) + 1;
    const problem: Problem = {
      id,
      title: input.title,
      difficulty: input.difficulty,
      tags: input.tags,
      acceptance: null,
      timeLimitMs: input.timeLimitMs,
      memoryMb: input.memoryMb,
      outputMb: input.outputMb,
      hiddenTests: tests.length,
      summary: input.summary,
      statement: splitParagraphs(input.statement),
      input: input.input,
      output: input.output,
      samples: input.samples,
      constraints: input.constraints,
      hint: input.hint || undefined,
      custom: true,
    };
    writeJSON(LOCAL_KEY, [...existing, problem]);
    set({ problems: [...state.problems, problem] });
    return problem;
  }

  const { data, error } = await supabase
    .from('problems')
    .insert({
      title: input.title,
      difficulty: input.difficulty,
      tags: input.tags,
      summary: input.summary,
      statement: input.statement,
      input_spec: input.input,
      output_spec: input.output,
      constraints: input.constraints,
      hint: input.hint || null,
      samples: input.samples,
      time_limit_ms: input.timeLimitMs,
      memory_mb: input.memoryMb,
      output_mb: input.outputMb,
      hidden_tests: tests.length,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message.includes('row-level security') ? 'Only admins can create problems.' : `The problem could not be saved: ${error?.message ?? 'unknown error'}`);

  const row = data as ProblemRow;
  const uploaded: string[] = [];
  try {
    const bucket = supabase.storage.from('testcases');
    for (let i = 0; i < tests.length; i++) {
      onProgress({ step: 'uploading', done: i, total: tests.length });
      const idx = i + 1;
      for (const [file, suffix] of [
        [tests[i].input, 'in'],
        [tests[i].output, 'out'],
      ] as const) {
        const path = `${row.id}/${idx}.${suffix}`;
        const { error: upErr } = await bucket.upload(path, new Blob([file.bytes as BlobPart], { type: 'text/plain' }), { upsert: true });
        if (upErr) throw new Error(`Uploading ${file.path} failed: ${upErr.message}`);
        uploaded.push(path);
      }
    }
    onProgress({ step: 'finishing' });
    if (tests.length) {
      const { error: testErr } = await supabase.from('problem_tests').insert(
        tests.map((t, i) => ({
          problem_id: row.id,
          idx: i + 1,
          input_path: `${row.id}/${i + 1}.in`,
          output_path: `${row.id}/${i + 1}.out`,
          input_bytes: t.input.bytes.length,
          output_bytes: t.output.bytes.length,
        })),
      );
      if (testErr) throw new Error(`Saving the test list failed: ${testErr.message}`);
    }
  } catch (e) {
    // Leave nothing half-created behind.
    if (uploaded.length) await supabase.storage.from('testcases').remove(uploaded);
    await supabase.from('problems').delete().eq('id', row.id);
    throw e;
  }

  const problem = fromRow(row);
  set({ problems: [...state.problems, problem] });
  return problem;
}
