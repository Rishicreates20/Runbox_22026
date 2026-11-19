import { useSyncExternalStore } from 'react';
import { LANGUAGE_EXT } from './files';
import * as local from './storage';
import { supabase } from './supabase';
import type { Language, Submission, Verdict } from './types';

/**
 * Submission history. With Supabase it lives in the `submissions` table (and
 * uploaded files in the `solutions` bucket); otherwise in this browser.
 */

interface SubmissionRow {
  id: string;
  problem_id: number;
  language: Language;
  verdict: Verdict;
  cpu_ms: number;
  memory_kb: number;
  failed_test: number | null;
  source: string;
  file_path: string | null;
  created_at: string;
}

const EMPTY: Submission[] = [];
const remote = new Map<string, Submission[]>();
const listeners = new Set<() => void>();
let loadingFor: string | null = null;
let loadError: string | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function fromRow(r: SubmissionRow): Submission {
  return {
    id: r.id,
    problemId: r.problem_id,
    language: r.language,
    verdict: r.verdict,
    cpuMs: r.cpu_ms,
    memoryKb: r.memory_kb,
    failedTest: r.failed_test ?? undefined,
    createdAt: Date.parse(r.created_at),
    source: r.source,
    filePath: r.file_path ?? undefined,
  };
}

export async function loadSubmissions(userId: string | null): Promise<void> {
  if (!supabase || !userId || remote.has(userId) || loadingFor === userId) return;
  loadingFor = userId;
  const { data, error } = await supabase
    .from('submissions')
    .select('id, problem_id, language, verdict, cpu_ms, memory_kb, failed_test, source, file_path, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  loadingFor = null;
  loadError = error ? 'Your submission history could not be loaded.' : null;
  remote.set(userId, error ? [] : (data as SubmissionRow[]).map(fromRow));
  emit();
}

export function clearSubmissions(): void {
  remote.clear();
  emit();
}

export function useSubmissions(userId: string | undefined): Submission[] {
  const localList = local.useSubmissions(supabase ? undefined : userId);
  const remoteList = useSyncExternalStore(
    subscribe,
    () => (userId && supabase ? (remote.get(userId) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
  return supabase ? remoteList : localList;
}

export function submissionsError(): string | null {
  return loadError;
}

/** Saves a judged submission. With Supabase, an uploaded file is stored too. */
export async function recordSubmission(userId: string, sub: Submission, file?: File | Blob): Promise<void> {
  if (!supabase) {
    local.addSubmission(userId, sub);
    return;
  }
  let filePath: string | undefined;
  if (file) {
    filePath = `${userId}/${sub.id}.${LANGUAGE_EXT[sub.language]}`;
    const { error } = await supabase.storage.from('solutions').upload(filePath, file, { contentType: 'text/plain', upsert: false });
    if (error) throw new Error(`Your file could not be stored: ${error.message}`);
  }
  const saved: Submission = { ...sub, filePath };
  remote.set(userId, [saved, ...(remote.get(userId) ?? [])]);
  emit();
  const { error } = await supabase.from('submissions').insert({
    id: sub.id,
    problem_id: sub.problemId,
    language: sub.language,
    verdict: sub.verdict,
    cpu_ms: sub.cpuMs,
    memory_kb: sub.memoryKb,
    failed_test: sub.failedTest ?? null,
    source: sub.source,
    file_path: filePath ?? null,
  });
  if (error) {
    remote.set(
      userId,
      (remote.get(userId) ?? []).filter((s) => s.id !== sub.id),
    );
    emit();
    throw new Error(`This submission could not be saved: ${error.message}`);
  }
}
