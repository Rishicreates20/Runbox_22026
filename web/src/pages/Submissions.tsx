import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { VerdictBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { TopNav } from '../components/TopNav';
import { LANGUAGES } from '../data/languages';
import { findProblem, useProblems } from '../lib/problems';
import { formatCpu, formatMemory, relativeTime } from '../lib/stats';
import { useSubmissions } from '../lib/submissions';
import type { Verdict } from '../lib/types';
import { useNow } from '../lib/useNow';
import { VERDICTS } from '../lib/verdicts';
import './Submissions.css';

export function SubmissionsPage() {
  const { user } = useAuth();
  const subs = useSubmissions(user?.id);
  const problems = useProblems();
  const now = useNow(30_000);
  const [filter, setFilter] = useState<'all' | Verdict>('all');

  useEffect(() => {
    document.title = 'Submissions · Code+';
  }, []);

  const counts = useMemo(() => {
    const m = new Map<Verdict, number>();
    subs.forEach((s) => m.set(s.verdict, (m.get(s.verdict) ?? 0) + 1));
    return m;
  }, [subs]);

  const list = filter === 'all' ? subs : subs.filter((s) => s.verdict === filter);

  return (
    <div className="page">
      <TopNav />
      <main className="subs-page">
        <header className="subs-page-head anim-up">
          <div>
            <h1>Submissions</h1>
            <p>Every run you sent to the judge, newest first.</p>
          </div>
          <div className="verdict-filter" role="group" aria-label="Filter by verdict">
            <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All <span className="count">{subs.length}</span>
            </button>
            {[...counts.entries()].map(([v, n]) => (
              <button key={v} type="button" className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>
                <span style={{ color: VERDICTS[v].color }}>{VERDICTS[v].code}</span> <span className="count">{n}</span>
              </button>
            ))}
          </div>
        </header>

        {subs.length === 0 ? (
          <div className="card subs-page-empty anim-up">
            <Icon name="history" size={28} />
            <p>No submissions yet. Pick a problem and press Submit to see your first verdict here.</p>
            <Link to="/problems" className="btn btn-primary btn-sm">
              Browse problems
            </Link>
          </div>
        ) : (
          <div className="table-wrap scroll anim-up" style={{ animationDelay: '0.08s' }}>
            <table className="ptable subs-page-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Problem</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Language</th>
                  <th scope="col">CPU</th>
                  <th scope="col">Memory</th>
                </tr>
              </thead>
              <tbody key={filter}>
                {list.map((s, i) => {
                  const p = findProblem(problems, s.problemId);
                  return (
                    <tr key={s.id} className="prow" style={{ animationDelay: `${Math.min(i, 20) * 0.025}s` }}>
                      <td className="muted-sm" title={new Date(s.createdAt).toLocaleString()}>
                        {relativeTime(s.createdAt, now)}
                      </td>
                      <td>
                        <Link to={`/problems/${s.problemId}`} className="ptitle">
                          <span className="pnum">{s.problemId}.</span>
                          <span>{p?.title ?? 'Unknown problem'}</span>
                        </Link>
                      </td>
                      <td>
                        <span className="subs-verdict">
                          <VerdictBadge verdict={s.verdict} />
                          {s.failedTest && <span className="muted-xs">test {s.failedTest}</span>}
                          {s.filePath && (
                            <span className="file-chip" title="Submitted as an uploaded file">
                              <Icon name="upload" size={12} /> file
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="mono subs-cell">{LANGUAGES[s.language].short}</td>
                      <td className="mono subs-cell">{s.verdict === 'CE' ? '—' : formatCpu(s.cpuMs)}</td>
                      <td className="mono subs-cell">{s.verdict === 'CE' ? '—' : formatMemory(s.memoryKb)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
