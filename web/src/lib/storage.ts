import { useSyncExternalStore } from 'react';
import type { Language, Submission } from './types';

/**
 * Small persistence layer over localStorage. Every read and write is guarded:
 * private windows and blocked storage fall back to in-memory values so the
 * app keeps working, it just forgets on reload.
 */

const memory = new Map<string, string>();

export function readRaw(key: string, store: Storage | null = safeLocal()): string | null {
  try {
    if (store) return store.getItem(key);
  } catch {
    /* fall through to memory */
  }
  return memory.get(key) ?? null;
}

export function writeRaw(key: string, value: string | null, store: Storage | null = safeLocal()): void {
  try {
    if (store) {
      if (value === null) store.removeItem(key);
      else store.setItem(key, value);
      return;
    }
  } catch {
    /* fall through to memory */
  }
  if (value === null) memory.delete(key);
  else memory.set(key, value);
}

export function readJSON<T>(key: string, fallback: T, store?: Storage | null): T {
  const raw = readRaw(key, store);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown, store?: Storage | null): void {
  writeRaw(key, JSON.stringify(value), store);
}

export function safeLocal(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function safeSession(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/* ---------------- Submissions (reactive) ---------------- */

const EMPTY: Submission[] = [];
const subsCache = new Map<string, Submission[]>();
const listeners = new Set<() => void>();

const subsKey = (userId: string) => `codeplus.subs.${userId}`;

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('codeplus.subs.')) {
      subsCache.clear();
      emit();
    }
  });
}

export function getSubmissions(userId: string): Submission[] {
  const cached = subsCache.get(userId);
  if (cached) return cached;
  const list = readJSON<Submission[]>(subsKey(userId), []);
  subsCache.set(userId, list);
  return list;
}

export function setSubmissions(userId: string, list: Submission[]): void {
  subsCache.set(userId, list);
  writeJSON(subsKey(userId), list.slice(0, 500));
  emit();
}

export function addSubmission(userId: string, sub: Submission): void {
  setSubmissions(userId, [sub, ...getSubmissions(userId)]);
}

export function useSubmissions(userId: string | undefined): Submission[] {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? getSubmissions(userId) : EMPTY),
    () => EMPTY,
  );
}

/* ---------------- Code drafts and preferences ---------------- */

const codeKey = (userId: string, problemId: number, lang: Language) => `codeplus.code.${userId}.${problemId}.${lang}`;

export function loadDraft(userId: string, problemId: number, lang: Language): string | null {
  return readRaw(codeKey(userId, problemId, lang));
}

export function saveDraft(userId: string, problemId: number, lang: Language, source: string | null): void {
  writeRaw(codeKey(userId, problemId, lang), source);
}

export function loadLanguage(): Language {
  const v = readRaw('codeplus.lang');
  return v === 'c' || v === 'py' || v === 'cpp' ? v : 'cpp';
}

export function saveLanguage(lang: Language): void {
  writeRaw('codeplus.lang', lang);
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
