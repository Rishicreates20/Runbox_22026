import type { Difficulty, Verdict } from '../lib/types';
import { DIFFICULTY_STYLE, VERDICTS } from '../lib/verdicts';
import type { ProblemStatus } from '../lib/stats';

export function DifficultyPill({ level }: { level: Difficulty }) {
  const s = DIFFICULTY_STYLE[level];
  return (
    <span className="pill" style={{ color: s.color, background: s.bg }}>
      {level}
    </span>
  );
}

export function VerdictBadge({ verdict, compact = false }: { verdict: Verdict; compact?: boolean }) {
  const v = VERDICTS[verdict];
  return (
    <span className="verdict" style={{ color: v.color }}>
      <span className="verdict-dot" style={{ background: v.color }} />
      {compact ? v.code : v.label}
    </span>
  );
}

export function StatusIcon({ status }: { status: ProblemStatus }) {
  if (status === 'solved')
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="Solved">
        <circle cx="12" cy="12" r="10" fill="rgba(74,222,128,0.14)" />
        <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#4ADE80" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (status === 'attempted')
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="Attempted">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="#FBBF24" strokeWidth="2" />
        <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="#FBBF24" />
      </svg>
    );
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="Not attempted">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="#2E3540" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}

/** Renders `code` spans and **bold** in problem text without HTML injection. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('`')) return <code key={i} className="inline-code">{p.slice(1, -1)}</code>;
        if (p.startsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
