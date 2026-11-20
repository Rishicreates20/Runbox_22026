import { useState } from 'react';
import type { Problem } from '../lib/types';
import { DifficultyPill, RichText } from './Badges';
import { Icon } from './Icon';
import './ProblemStatement.css';

/** The full problem statement: used in the workspace and as the live preview when creating a problem. */
export function ProblemStatement({ problem, solved = false, preview = false }: { problem: Problem; solved?: boolean; preview?: boolean }) {
  const [hintOpen, setHintOpen] = useState(false);
  return (
    <article className="statement anim-in">
      <div className="st-head">
        <h1>
          {preview ? '' : `${problem.id}. `}
          {problem.title || <span className="dim">Untitled problem</span>}
        </h1>
        {solved && (
          <span className="solved-badge">
            <Icon name="check" size={12} strokeWidth={3} /> Solved
          </span>
        )}
      </div>
      <div className="tag-row">
        <DifficultyPill level={problem.difficulty} />
        {problem.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>
      <dl className="limits">
        <div>
          <dt>Time</dt>
          <dd>{problem.timeLimitMs} ms</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{problem.memoryMb} MB</dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>{problem.outputMb} MB</dd>
        </div>
      </dl>

      {problem.statement.map((p, i) => (
        <p key={i}>
          <RichText text={p} />
        </p>
      ))}

      {problem.input && (
        <>
          <h2>Input</h2>
          <p>
            <RichText text={problem.input} />
          </p>
        </>
      )}
      {problem.output && (
        <>
          <h2>Output</h2>
          <p>
            <RichText text={problem.output} />
          </p>
        </>
      )}

      {problem.samples.map((s, i) => (
        <div key={i} className="example">
          <h2>Example {i + 1}</h2>
          <div className="io-grid">
            <div>
              <span className="io-label">Input</span>
              <pre>{s.input}</pre>
            </div>
            <div>
              <span className="io-label">Output</span>
              <pre>{s.output}</pre>
            </div>
          </div>
          {s.explanation && (
            <p className="explain">
              <strong>Why:</strong> <RichText text={s.explanation} />
            </p>
          )}
        </div>
      ))}

      {problem.constraints.length > 0 && (
        <>
          <h2>Constraints</h2>
          <ul className="constraints">
            {problem.constraints.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}

      <div className="note">
        <Icon name="shield" size={18} />
        <span>
          Your program reads stdin and writes stdout inside the runbox sandbox. Windows line endings in the input become plain newlines,
          and network access is blocked.
        </span>
      </div>

      {problem.hint && (
        <div className="hint">
          <button type="button" aria-expanded={hintOpen} onClick={() => setHintOpen((o) => !o)}>
            <span>
              <Icon name="bulb" size={16} style={{ color: 'var(--warn)' }} /> Hint
            </span>
            <Icon name="chevronDown" className="hint-chev" />
          </button>
          {hintOpen && <p className="anim-up">{problem.hint}</p>}
        </div>
      )}
    </article>
  );
}
