import { Link } from 'react-router-dom';
import './Logo.css';

const SPARKS = ['{', '}', '</>', ';'];

/** The Code+ mark: a lime tile with a plus. On hover, code sparks fly out of it. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path className="logo-plus" d="M16 9.5v13M9.5 16h13" stroke="#0A0C10" strokeWidth="3.4" strokeLinecap="round" />
      </svg>
      {SPARKS.map((g, i) => (
        <span key={g} className={`logo-spark logo-spark-${i}`} aria-hidden="true">
          {g}
        </span>
      ))}
    </span>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      code<span className="wordmark-plus">+</span>
    </span>
  );
}

export function Logo({ to = '/', size = 30, label = 'Code+ home' }: { to?: string; size?: number; label?: string }) {
  return (
    <Link to={to} className="logo" aria-label={label}>
      <LogoMark size={size} />
      <Wordmark size={Math.round(size * 0.7)} />
    </Link>
  );
}
