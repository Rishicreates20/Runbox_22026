import { useMemo, type CSSProperties } from 'react';
import './PlusBurst.css';

const C = {
  kw: '#F28FAD',
  type: '#7CC7FF',
  str: '#B5E88A',
  num: '#FFB86B',
  fn: '#F5D76E',
  pre: '#B49CFF',
  punct: '#93A4B8',
  com: '#7A8699',
  text: '#DCE3EC',
  accent: 'var(--accent)',
};

const FRAGMENTS: [string, string][] = [
  ['{ }', C.text],
  ['</>', C.accent],
  ['int main()', C.type],
  ['#include', C.pre],
  ['return 0;', C.kw],
  ['cin >> n;', C.text],
  ['print()', C.fn],
  ['def', C.kw],
  ['=>', C.punct],
  ['[ ]', C.punct],
  ['++i', C.num],
  ['std::', C.type],
  ['&&', C.punct],
  ['if (x)', C.kw],
  ['"YES"', C.str],
  ['0x1F', C.num],
  ['for', C.kw],
  [';', C.accent],
  ['vector<int>', C.type],
  ['O(n log n)', C.accent],
  ['// ok', C.com],
  ['yield', C.kw],
  ['malloc()', C.fn],
  ['( )', C.punct],
];

const WAVES = 3;
const PERIOD = 3.6; // seconds per full cycle; one wave every PERIOD / WAVES

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * The Code+ hero: the logo's plus beats, and on every beat a ring of code
 * fragments bursts outward from it and fades into the dark.
 */
export function PlusBurst({ className = '' }: { className?: string }) {
  const tokens = useMemo(() => {
    const rand = seeded(42);
    const perWave = Math.ceil(FRAGMENTS.length / WAVES);
    return FRAGMENTS.map(([text, color], i) => {
      const wave = i % WAVES;
      const k = Math.floor(i / WAVES);
      const angle = (360 / perWave) * k + wave * (360 / perWave / WAVES) + (rand() - 0.5) * 14;
      const dist = 32 + rand() * 15; // in cqi, container is 100cqi wide
      const delay = wave * (PERIOD / WAVES) + rand() * 0.18;
      const size = 2.3 + rand() * 1.3;
      return {
        text,
        style: {
          '--a': `${angle.toFixed(1)}deg`,
          '--d': `${dist.toFixed(1)}cqi`,
          '--fs': `${size.toFixed(2)}cqi`,
          '--delay': `${delay.toFixed(2)}s`,
          '--dur': `${PERIOD}s`,
          color,
        } as CSSProperties,
      };
    });
  }, []);

  return (
    <div className={`burst ${className}`} aria-hidden="true">
      <div className="burst-orbit burst-orbit-1" />
      <div className="burst-orbit burst-orbit-2" />
      <div className="burst-ring" />
      <div className="burst-ring burst-ring-2" />
      {tokens.map((t) => (
        <span key={t.text} className="burst-token" style={t.style}>
          {t.text}
        </span>
      ))}
      <div className="burst-core">
        <svg viewBox="0 0 32 32" className="burst-mark">
          <rect width="32" height="32" rx="8" fill="var(--accent)" />
          <path d="M16 9.5v13M9.5 16h13" stroke="#0A0C10" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
