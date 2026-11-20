import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { DifficultyPill, StatusIcon } from '../components/Badges';
import { Icon } from '../components/Icon';
import { TopNav } from '../components/TopNav';
import { TOPICS, dailyProblem } from '../data/problems';
import { useCatalog } from '../lib/problems';
import {
  acceptanceRate,
  activity,
  countdown,
  nextUtcMidnight,
  nextWeeklyRound,
  pad2,
  solvedByDifficulty,
  statusMap,
  streak,
  type ProblemStatus,
} from '../lib/stats';
import { useSubmissions } from '../lib/submissions';
import type { Difficulty, Problem, Submission } from '../lib/types';
import { useNow } from '../lib/useNow';
import './Problems.css';

const DIFFS: ('All' | Difficulty)[] = ['All', 'Easy', 'Medium', 'Hard'];
const STATUSES: { key: 'all' | ProblemStatus; label: string }[] = [
  { key: 'all', label: 'Any status' },
  { key: 'todo', label: 'Not attempted' },
  { key: 'attempted', label: 'Attempted' },
  { key: 'solved', label: 'Solved' },
];
const HEAT = ['#161a21', '#34421a', '#5e7a1f', '#93bf2a', '#c8f031'];
const DIFF_COLOR: Record<Difficulty, string> = { Easy: 'var(--ok)', Medium: 'var(--warn)', Hard: 'var(--err)' };

interface Filters {
  difficulty: 'All' | Difficulty;
  topic: string;
  status: 'all' | ProblemStatus;
  q: string;
  sort: '' | 'acc-asc' | 'acc-desc';
}
const DEFAULT_FILTERS: Filters = { difficulty: 'All', topic: 'all', status: 'all', q: '', sort: '' };

function readFilters(p: URLSearchParams): Filters {
  const d = p.get('difficulty');
  const st = p.get('status');
  const so = p.get('sort');
  return {
    difficulty: d === 'Easy' || d === 'Medium' || d === 'Hard' ? d : 'All',
    topic: p.get('topic') ?? 'all',
    status: st === 'todo' || st === 'attempted' || st === 'solved' ? st : 'all',
    q: p.get('q') ?? '',
    sort: so === 'acc-asc' || so === 'acc-desc' ? so : '',
  };
}

function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).forEach((k) => {
    if (f[k] !== DEFAULT_FILTERS[k]) p.set(k, f[k]);
  });
  return p;
}

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function ProblemsPage() {
  const { user, canCreateProblems } = useAuth();
  const subs = useSubmissions(user?.id);
  const { problems: PROBLEMS, error: catalogError } = useCatalog();
  const now = useNow(1000);
  const [params, setParams] = useSearchParams();

  // Filters live in React state (instant, race-free) and are mirrored into the
  // URL so a filtered view can be shared or restored with the back button.
  const [filters, setFilters] = useState<Filters>(() => readFilters(params));
  const written = useRef(filtersToParams(filters).toString());
  const { difficulty: diff, topic, status, q: query, sort } = filters;
  const setParam = (key: keyof Filters, value: string | null) =>
    setFilters((f) => ({ ...f, [key]: value ?? DEFAULT_FILTERS[key] }));

  useEffect(() => {
    const next = filtersToParams(filters).toString();
    if (next === written.current) return;
    const t = setTimeout(() => {
      written.current = next;
      setParams(new URLSearchParams(next), { replace: true });
    }, 150);
    return () => clearTimeout(t);
  }, [filters, setParams]);

  const search = params.toString();
  useEffect(() => {
    if (search === written.current) return;
    written.current = search;
    setFilters(readFilters(new URLSearchParams(search)));
  }, [search]);

  useEffect(() => {
    document.title = 'Problems · Code+';
  }, []);

  const statuses = useMemo(() => statusMap(subs), [subs]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = PROBLEMS.filter(
      (p) =>
        (diff === 'All' || p.difficulty === diff) &&
        (topic === 'all' || p.tags.includes(topic)) &&
        (status === 'all' || (statuses.get(p.id) ?? 'todo') === status) &&
        (!needle || p.title.toLowerCase().includes(needle) || String(p.id).startsWith(needle) || p.tags.some((t) => t.includes(needle))),
    );
    const acc = (p: Problem) => p.acceptance ?? -1;
    if (sort === 'acc-asc') list = [...list].sort((a, b) => acc(a) - acc(b));
    if (sort === 'acc-desc') list = [...list].sort((a, b) => acc(b) - acc(a));
    return list;
  }, [diff, topic, status, query, sort, statuses, PROBLEMS]);

  const filtersKey = `${diff}|${topic}|${status}|${query}|${sort}`;
  const filtered = diff !== 'All' || topic !== 'all' || status !== 'all' || query !== '';
  const nextUp = PROBLEMS.find((p) => statuses.get(p.id) === 'attempted') ?? PROBLEMS.find((p) => !statuses.has(p.id));

  return (
    <div className="page">
      <TopNav />
      <main className="problems">
        <section className="welcome anim-up">
          <div>
            <p className="eyebrow">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <h1>
              {greeting(now)}, {user?.username}
            </h1>
            <p className="welcome-sub">
              {nextUp ? (
                <>
                  Up next: <strong>{nextUp.title}</strong>, {nextUp.summary.charAt(0).toLowerCase() + nextUp.summary.slice(1)}
                </>
              ) : (
                <>You have solved every problem in the set. Nice work.</>
              )}
            </p>
          </div>
          {nextUp && (
            <Link to={`/problems/${nextUp.id}`} className="btn btn-primary">
              <Icon name="play" size={14} />
              {statuses.get(nextUp.id) === 'attempted' ? 'Continue' : 'Start'} · {nextUp.title}
            </Link>
          )}
        </section>

        {catalogError && (
          <p className="form-msg form-msg-error" role="alert">
            {catalogError}
          </p>
        )}

        <section className="stat-grid">
          <SolvedCard subs={subs} problems={PROBLEMS} />
          <ActivityCard subs={subs} now={now} />
          <DailyCard now={now} solved={statuses.get(dailyProblem(now).id) === 'solved'} />
        </section>

        <div className="problems-layout">
          <section className="problems-main anim-up" style={{ animationDelay: '0.2s' }} aria-labelledby="problems-h">
            <div className="section-head">
              <h2 id="problems-h">Problems</h2>
              <span className="section-tools">
                <span className="muted-sm">
                  Showing <strong>{rows.length}</strong> of {PROBLEMS.length}
                </span>
                {canCreateProblems && (
                  <Link to="/admin/problems/new" className="btn btn-ghost btn-sm">
                    <Icon name="plus" size={14} /> Create problem
                  </Link>
                )}
              </span>
            </div>

            <div className="filters">
              <label className="search filters-search">
                <span className="sr-only">Filter problems</span>
                <Icon name="search" />
                <input
                  className="input"
                  type="search"
                  placeholder="Search by title, number or topic"
                  value={query}
                  onChange={(e) => setParam('q', e.target.value)}
                />
              </label>
              <div className="pills" role="group" aria-label="Difficulty">
                {DIFFS.map((d) => (
                  <button key={d} type="button" className="pill-btn" aria-pressed={diff === d} onClick={() => setParam('difficulty', d)}>
                    {d}
                  </button>
                ))}
              </div>
              <label>
                <span className="sr-only">Status</span>
                <select className="select select-lg" value={status} onChange={(e) => setParam('status', e.target.value)}>
                  {STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="topics" role="group" aria-label="Topics">
              {[{ key: 'all', label: 'All topics' }, ...TOPICS].map((t) => (
                <button key={t.key} type="button" className="chip" aria-pressed={topic === t.key} onClick={() => setParam('topic', t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="table-wrap scroll">
              <table className="ptable">
                <thead>
                  <tr>
                    <th scope="col" className="c-status">
                      Status
                    </th>
                    <th scope="col">Title</th>
                    <th scope="col" className="c-tags">
                      Topics
                    </th>
                    <th scope="col" className="c-acc" aria-sort={sort === 'acc-asc' ? 'ascending' : sort === 'acc-desc' ? 'descending' : 'none'}>
                      <button
                        type="button"
                        className="sort-btn"
                        data-active={sort !== ''}
                        onClick={() => setParam('sort', sort === '' ? 'acc-desc' : sort === 'acc-desc' ? 'acc-asc' : null)}
                      >
                        Acceptance <span aria-hidden="true">{sort === 'acc-desc' ? '↓' : sort === 'acc-asc' ? '↑' : '↕'}</span>
                      </button>
                    </th>
                    <th scope="col" className="c-level">
                      Level
                    </th>
                    <th scope="col" className="c-limits">
                      Limits
                    </th>
                  </tr>
                </thead>
                <tbody key={filtersKey}>
                  {rows.map((p, i) => (
                    <tr key={p.id} className="prow" style={{ animationDelay: `${i * 0.035}s` }}>
                      <td className="c-status">
                        <StatusIcon status={statuses.get(p.id) ?? 'todo'} />
                      </td>
                      <td>
                        <Link to={`/problems/${p.id}`} className="ptitle">
                          <span className="pnum">{p.id}.</span>
                          <span>{p.title}</span>
                        </Link>
                      </td>
                      <td className="c-tags">
                        <span className="tag-row">
                          {p.tags.map((t) => (
                            <span key={t} className="tag">
                              {t}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="c-acc">
                        <span className="acc">
                          {p.acceptance === null ? (
                            <span className="acc-new">New</span>
                          ) : (
                            <>
                              <span className="acc-num">{p.acceptance.toFixed(1)}%</span>
                              <span className="acc-bar">
                                <span style={{ width: `${p.acceptance}%` }} />
                              </span>
                            </>
                          )}
                        </span>
                      </td>
                      <td className="c-level">
                        <DifficultyPill level={p.difficulty} />
                      </td>
                      <td className="c-limits">
                        {p.timeLimitMs / 1000} s · {p.memoryMb} MB
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="empty">
                  <Icon name="search" size={28} />
                  <p>No problems match these filters.</p>
                  {filtered && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          <aside className="problems-side anim-up" style={{ animationDelay: '0.28s' }}>
            <ContestCard now={now} />
            <TopicProgress subs={subs} problems={PROBLEMS} />
            <YourStats subs={subs} />
          </aside>
        </div>
      </main>
    </div>
  );
}

function SolvedCard({ subs, problems }: { subs: Submission[]; problems: Problem[] }) {
  const { byDifficulty, solved, total } = solvedByDifficulty(subs, problems);
  const C = 2 * Math.PI * 48;
  let offset = 0;
  const segments = (['Easy', 'Medium', 'Hard'] as Difficulty[]).map((d, i) => {
    const len = (byDifficulty[d].solved / total) * C;
    const seg = { d, len, offset, delay: 0.2 + i * 0.2 };
    offset += len;
    return seg;
  });
  return (
    <article className="card stat-card anim-up" style={{ animationDelay: '0.06s' }}>
      <div className="ring">
        <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`${solved} of ${total} problems solved`}>
          <circle cx="60" cy="60" r="48" fill="none" stroke="#1a1f27" strokeWidth="10" />
          {segments.map(
            (s) =>
              s.len > 0 && (
                <circle
                  key={s.d}
                  className="ring-seg"
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  stroke={DIFF_COLOR[s.d]}
                  strokeWidth="10"
                  strokeDasharray={`${Math.max(0, s.len - 2)} ${C}`}
                  strokeDashoffset={-s.offset}
                  style={{ animationDelay: `${s.delay}s` }}
                />
              ),
          )}
        </svg>
        <div className="ring-label">
          <strong>{solved}</strong>
          <span>of {total}</span>
        </div>
      </div>
      <div className="solved-list">
        <h2 className="card-title">Solved</h2>
        {(['Easy', 'Medium', 'Hard'] as Difficulty[]).map((d) => (
          <div key={d} className="solved-row">
            <span>
              <i style={{ background: DIFF_COLOR[d] }} />
              {d}
            </span>
            <span className="mono">
              {byDifficulty[d].solved}
              <span className="dim">/{byDifficulty[d].total}</span>
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

function ActivityCard({ subs, now }: { subs: Submission[]; now: number }) {
  // Recompute the heatmap at most once a minute, not on every clock tick.
  const minute = Math.floor(now / 60_000);
  const { cells, total } = useMemo(() => activity(subs, 20, minute * 60_000), [subs, minute]);
  const s = streak(subs, now);
  return (
    <article className="card stat-card stat-col anim-up" style={{ animationDelay: '0.12s' }}>
      <div className="card-row">
        <h2 className="card-title">Activity</h2>
        <span className="streak">
          <Icon name="flame" size={14} style={{ color: s > 0 ? 'var(--warn)' : 'var(--dim)' }} />
          <strong>{s}-day</strong> streak
        </span>
      </div>
      <div className="heat" role="img" aria-label={`${total} submissions in the last 20 weeks`}>
        {cells.map((c, i) => (
          <span
            key={i}
            className="heat-cell"
            title={c.future ? undefined : `${c.count} submission${c.count === 1 ? '' : 's'} on ${c.date.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })}`}
            style={{ background: c.future ? 'transparent' : HEAT[c.level], animationDelay: `${Math.floor(i / 7) * 0.025}s` }}
          />
        ))}
      </div>
      <div className="card-row muted-xs">
        <span>
          {total} submission{total === 1 ? '' : 's'} in the last 20 weeks
        </span>
        <span className="legend">
          Less {HEAT.map((h) => <i key={h} style={{ background: h }} />)} More
        </span>
      </div>
    </article>
  );
}

function DailyCard({ now, solved }: { now: number; solved: boolean }) {
  const p = dailyProblem(now);
  const t = countdown(nextUtcMidnight(now) - now);
  return (
    <article className="card stat-card stat-col daily anim-up" style={{ animationDelay: '0.18s' }}>
      <div className="card-row">
        <span className="daily-label">
          <span className="ping daily-dot" />
          Daily challenge
        </span>
        <span className="mono muted-sm" aria-label="Time left today">
          {pad2(t.h)}:{pad2(t.m)}:{pad2(t.s)}
        </span>
      </div>
      <div className="daily-body">
        <h2>{p.title}</h2>
        <p>{p.summary}</p>
      </div>
      <div className="card-row">
        <span className="tag-row">
          <DifficultyPill level={p.difficulty} />
          {p.tags.slice(0, 1).map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </span>
        <Link to={`/problems/${p.id}`} className={`btn btn-sm ${solved ? 'btn-ghost' : 'btn-primary'}`}>
          {solved ? (
            <>
              <Icon name="check" size={15} /> Solved
            </>
          ) : (
            <>
              Solve now <Icon name="arrowRight" size={15} strokeWidth={2.2} />
            </>
          )}
        </Link>
      </div>
    </article>
  );
}

function ContestCard({ now }: { now: number }) {
  const start = nextWeeklyRound(now);
  const t = countdown(start - now);
  const week = Math.floor((start - Date.UTC(2025, 0, 4, 18)) / (7 * 86_400_000)) + 1;
  return (
    <article className="card side-card">
      <div className="card-row">
        <h2 className="card-title">Next contest</h2>
        <span className="eyebrow">Weekly</span>
      </div>
      <div>
        <div className="contest-name">Weekly Round {week}</div>
        <div className="muted-sm">
          {new Date(start).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · 4 problems · 90 min
        </div>
      </div>
      <div className="countdown">
        {(
          [
            [t.d, 'days'],
            [t.h, 'hrs'],
            [t.m, 'min'],
            [t.s, 'sec'],
          ] as const
        ).map(([v, l], i) => (
          <div key={l} className={i === 3 ? 'cd-live' : undefined}>
            <strong>{pad2(v)}</strong>
            <span>{l}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function TopicProgress({ subs, problems }: { subs: Submission[]; problems: Problem[] }) {
  const statuses = statusMap(subs);
  const colors = ['var(--accent)', 'var(--info)', 'var(--mem)', 'var(--warn)'];
  const topics = TOPICS.map((t) => {
    const inTopic = problems.filter((p) => p.tags.includes(t.key));
    const done = inTopic.filter((p) => statuses.get(p.id) === 'solved').length;
    return { ...t, done, total: inTopic.length };
  })
    .filter((t) => t.total > 0)
    .sort((a, b) => b.done / b.total - a.done / a.total || b.total - a.total)
    .slice(0, 4);
  return (
    <article className="card side-card">
      <h2 className="card-title">Topic progress</h2>
      {topics.map((t, i) => (
        <div key={t.key} className="topic-row">
          <div className="card-row">
            <span>{t.label}</span>
            <span className="mono muted-xs">
              {t.done}/{t.total}
            </span>
          </div>
          <div className="bar">
            <span style={{ width: `${(t.done / t.total) * 100}%`, background: colors[i % colors.length] }} />
          </div>
        </div>
      ))}
    </article>
  );
}

function YourStats({ subs }: { subs: Submission[] }) {
  const rate = acceptanceRate(subs);
  const langs = new Map<string, number>();
  subs.forEach((s) => langs.set(s.language, (langs.get(s.language) ?? 0) + 1));
  const fav = [...langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const favLabel = fav === 'cpp' ? 'C++' : fav === 'c' ? 'C' : fav === 'py' ? 'Python' : '—';
  return (
    <article className="card side-card">
      <div className="card-row">
        <h2 className="card-title">Your stats</h2>
        <Link to="/submissions" className="muted-sm link-muted">
          All submissions
        </Link>
      </div>
      <dl className="mini-stats">
        <div>
          <dt>Submitted</dt>
          <dd>{subs.length}</dd>
        </div>
        <div>
          <dt>AC rate</dt>
          <dd>{rate === null ? '—' : `${rate.toFixed(0)}%`}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{favLabel}</dd>
        </div>
      </dl>
    </article>
  );
}
