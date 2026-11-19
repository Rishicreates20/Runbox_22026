import type { Verdict } from './types';

export interface VerdictMeta {
  code: string;
  label: string;
  color: string;
  bg: string;
  when: string;
}

export const VERDICTS: Record<Verdict, VerdictMeta> = {
  AC: { code: 'AC', label: 'Accepted', color: 'var(--ok)', bg: 'rgba(74, 222, 128, 0.12)', when: 'Exit 0 and the output matches' },
  WA: { code: 'WA', label: 'Wrong Answer', color: 'var(--err)', bg: 'rgba(248, 113, 113, 0.12)', when: 'Clean run, but the checker found a mismatch' },
  TLE: { code: 'TLE', label: 'Time Limit Exceeded', color: 'var(--warn)', bg: 'rgba(251, 191, 36, 0.12)', when: 'CPU or wall-clock time went over the limit' },
  MLE: { code: 'MLE', label: 'Memory Limit Exceeded', color: 'var(--mem)', bg: 'rgba(196, 165, 255, 0.14)', when: 'The cgroup killed the process for using too much memory' },
  RE: { code: 'RE', label: 'Runtime Error', color: 'var(--orange)', bg: 'rgba(251, 146, 60, 0.12)', when: 'Non-zero exit code or killed by a signal' },
  SV: { code: 'SV', label: 'Blocked Syscall', color: 'var(--orange)', bg: 'rgba(251, 146, 60, 0.12)', when: 'seccomp killed the process (SIGSYS)' },
  OLE: { code: 'OLE', label: 'Output Limit Exceeded', color: 'var(--info)', bg: 'rgba(124, 199, 255, 0.12)', when: 'An output stream went over the limit (SIGXFSZ)' },
  CE: { code: 'CE', label: 'Compile Error', color: 'var(--err)', bg: 'rgba(248, 113, 113, 0.12)', when: 'The source did not compile' },
  IE: { code: 'IE', label: 'Internal Error', color: 'var(--muted)', bg: 'rgba(154, 163, 178, 0.12)', when: 'Sandbox setup failed. Not your code.' },
};

export const DIFFICULTY_STYLE = {
  Easy: { color: 'var(--ok)', bg: 'rgba(74, 222, 128, 0.12)' },
  Medium: { color: 'var(--warn)', bg: 'rgba(251, 191, 36, 0.12)' },
  Hard: { color: 'var(--err)', bg: 'rgba(248, 113, 113, 0.12)' },
} as const;
