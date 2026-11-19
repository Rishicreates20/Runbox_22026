import type { CSSProperties } from 'react';
import { formatCpu, formatMemory, pad2 } from '../lib/stats';
import type { JudgeReport, TestResult, Verdict } from '../lib/types';
import { VERDICTS } from '../lib/verdicts';
import { Icon } from './Icon';
import './JudgeResult.css';

export function VerdictHeader({ verdict, detail }: { verdict: Verdict; detail: string }) {
  const v = VERDICTS[verdict];
  const ok = verdict === 'AC';
  return (
    <div className="verdict-head anim-up">
      <span className={`verdict-icon ${ok ? 'verdict-icon-ok' : ''}`} style={{ color: v.color, background: v.bg }}>
        <Icon name={ok ? 'check' : 'x'} size={22} strokeWidth={2.6} />
      </span>
      <span className="verdict-text">
        <strong style={{ color: v.color }} aria-live="polite">
          {v.label}
        </strong>
        <span>{detail}</span>
      </span>
    </div>
  );
}

/** Live test-by-test judging, then the verdict with runbox's metrics and raw JSON. */
export function JudgeProgress({
  phase,
  tests,
  total,
  report,
}: {
  phase: 'judging' | 'done';
  tests: TestResult[];
  total: number;
  report: JudgeReport | null;
}) {
  const shown: TestResult[] = tests.length ? tests : Array.from({ length: total }, (_, i) => ({ index: i + 1, state: 'pending' }));
  const finished = shown.filter((t) => t.state === 'passed' || t.state === 'failed').length;
  const runningIdx = shown.findIndex((t) => t.state === 'running');
  return (
    <div className="result">
      {phase === 'judging' && (
        <div className="judging-head anim-in">
          <span>
            <span className="spinner spinner-lg" />
            <strong>{runningIdx === -1 && finished === 0 ? 'Compiling' : 'Judging'}</strong>
          </span>
          <span className="mono muted-sm" aria-live="polite">
            {runningIdx === -1 ? 'preparing sandbox' : `test ${runningIdx + 1} of ${shown.length}`}
          </span>
        </div>
      )}
      {phase === 'done' && report && <VerdictHeader verdict={report.verdict} detail={report.detail} />}

      <ol className="cells" aria-label="Hidden test results">
        {shown.map((t) => (
          <li
            key={t.index}
            className={`cell cell-${t.state}`}
            title={`Test ${t.index}: ${t.state}${t.verdict && t.state === 'failed' ? ` (${VERDICTS[t.verdict].label})` : ''}`}
            style={t.state === 'failed' && t.verdict ? ({ '--fail': VERDICTS[t.verdict].color } as CSSProperties) : undefined}
          >
            {pad2(t.index)}
          </li>
        ))}
      </ol>

      {phase === 'judging' && (
        <div className="progress">
          <span style={{ width: `${(finished / Math.max(1, shown.length)) * 100}%` }} />
        </div>
      )}

      {phase === 'done' && report && (
        <div className="anim-up report" style={{ animationDelay: '0.1s' }}>
          {report.verdict === 'CE' ? (
            <pre className="compile-out">{report.compileOutput}</pre>
          ) : (
            <>
              <dl className="metrics">
                <div>
                  <dt>Tests</dt>
                  <dd>
                    {report.passed} / {report.total}
                  </dd>
                </div>
                <div>
                  <dt>CPU time</dt>
                  <dd>{formatCpu(report.cpuMs)}</dd>
                </div>
                <div>
                  <dt>Wall time</dt>
                  <dd>{formatCpu(report.wallMs)}</dd>
                </div>
                <div>
                  <dt>Memory</dt>
                  <dd>{formatMemory(report.memoryKb)}</dd>
                </div>
              </dl>
              {report.raw && (
                <pre className="raw">
                  <span className="dim">runbox → </span>
                  {JSON.stringify(report.raw)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
