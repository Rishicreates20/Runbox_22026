/**
 * Timer state of a mock-paper attempt, kept in this browser only
 * (localStorage). Nothing here is trusted by the server: it's practice.
 */
export interface ExamState {
  startedAt?: number;
  finishedAt?: number;
  /** The user chose to keep going after time ran out. */
  untimed?: boolean;
}

const key = (paperId: string) => `codeplus:paper:${paperId}`;

export function loadExam(paperId: string): ExamState {
  try {
    return JSON.parse(localStorage.getItem(key(paperId)) ?? "{}") as ExamState;
  } catch {
    return {};
  }
}

export function saveExam(paperId: string, s: ExamState) {
  try {
    localStorage.setItem(key(paperId), JSON.stringify(s));
  } catch {}
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
