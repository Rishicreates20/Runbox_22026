import type { Difficulty, Problem, Submission } from './types';

export type ProblemStatus = 'solved' | 'attempted' | 'todo';

const DAY = 86_400_000;

export function statusMap(subs: Submission[]): Map<number, ProblemStatus> {
  const map = new Map<number, ProblemStatus>();
  for (const s of subs) {
    if (s.verdict === 'AC') map.set(s.problemId, 'solved');
    else if (!map.has(s.problemId)) map.set(s.problemId, 'attempted');
  }
  return map;
}

export function solvedByDifficulty(subs: Submission[], problems: Problem[]) {
  const status = statusMap(subs);
  const out: Record<Difficulty, { solved: number; total: number }> = {
    Easy: { solved: 0, total: 0 },
    Medium: { solved: 0, total: 0 },
    Hard: { solved: 0, total: 0 },
  };
  for (const p of problems) {
    out[p.difficulty].total++;
    if (status.get(p.id) === 'solved') out[p.difficulty].solved++;
  }
  const solved = out.Easy.solved + out.Medium.solved + out.Hard.solved;
  return { byDifficulty: out, solved, total: problems.length };
}

function dayIndex(ts: number): number {
  const d = new Date(ts);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** Submission counts per local day for the last `weeks` weeks, oldest first, column-major by week. */
export function activity(subs: Submission[], weeks = 20, now = Date.now()) {
  const today = dayIndex(now);
  const todayDow = new Date(now).getDay();
  const days = weeks * 7;
  const start = today - (days - 7) - todayDow;
  const counts = new Array<number>(days).fill(0);
  for (const s of subs) {
    const i = dayIndex(s.createdAt) - start;
    if (i >= 0 && i < days) counts[i]++;
  }
  const max = Math.max(1, ...counts);
  return {
    cells: counts.map((count, i) => ({
      count,
      level: count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)),
      future: start + i > today,
      date: new Date((start + i) * DAY),
    })),
    total: counts.reduce((a, b) => a + b, 0),
  };
}

/** Consecutive days with at least one submission, ending today or yesterday. */
export function streak(subs: Submission[], now = Date.now()): number {
  const days = new Set(subs.map((s) => dayIndex(s.createdAt)));
  let d = dayIndex(now);
  if (!days.has(d)) d--;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

export function acceptanceRate(subs: Submission[]): number | null {
  if (subs.length === 0) return null;
  return (subs.filter((s) => s.verdict === 'AC').length / subs.length) * 100;
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatMemory(kb: number): string {
  if (kb >= 10_240) return `${(kb / 1024).toFixed(1)} MB`;
  return `${Math.round(kb).toLocaleString()} KB`;
}

export function formatCpu(ms: number): string {
  if (ms >= 100) return `${Math.round(ms).toLocaleString()} ms`;
  return `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function countdown(ms: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(total / 86_400),
    h: Math.floor((total % 86_400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/** Next Saturday 18:00 UTC: the weekly round. */
export function nextWeeklyRound(now = Date.now()): number {
  const d = new Date(now);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 18, 0, 0));
  const daysAhead = (6 - target.getUTCDay() + 7) % 7;
  target.setUTCDate(target.getUTCDate() + daysAhead);
  if (target.getTime() <= now) target.setUTCDate(target.getUTCDate() + 7);
  return target.getTime();
}

export function nextUtcMidnight(now = Date.now()): number {
  return (Math.floor(now / DAY) + 1) * DAY;
}
