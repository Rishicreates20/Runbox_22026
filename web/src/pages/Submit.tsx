import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { VerdictBadge } from '../components/Badges';
import { Dropzone, FilePickerButton } from '../components/Dropzone';
import { Icon } from '../components/Icon';
import { JudgeProgress } from '../components/JudgeResult';
import { TopNav } from '../components/TopNav';
import { LANGUAGES, LANGUAGE_ORDER } from '../data/languages';
import { SOURCE_ACCEPT, formatBytes, readSourceFile, type SourceFile } from '../lib/files';
import { judge, type DemoOutcome } from '../lib/judge';
import { findProblem, useProblems } from '../lib/problems';
import { relativeTime } from '../lib/stats';
import { loadLanguage, newId, saveDraft, saveLanguage } from '../lib/storage';
import { recordSubmission, useSubmissions } from '../lib/submissions';
import type { Difficulty, JudgeReport, Language, TestResult } from '../lib/types';
import './Submit.css';

const PREVIEW_LINES = 40;
const OUTCOMES: { value: DemoOutcome; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'AC', label: 'Accepted' },
  { value: 'WA', label: 'Wrong Answer' },
  { value: 'TLE', label: 'Time Limit' },
  { value: 'MLE', label: 'Memory Limit' },
  { value: 'RE', label: 'Runtime Error' },
  { value: 'CE', label: 'Compile Error' },
];

type Phase = 'idle' | 'judging' | 'done' | 'error';

export function SubmitPage() {
  const { user, backend } = useAuth();
  const problems = useProblems();
  const subs = useSubmissions(user?.id);
  const [params, setParams] = useSearchParams();

  const requested = Number(params.get('problem'));
  const [problemId, setProblemId] = useState<number>(() => (requested > 0 ? requested : 42));
  const problem = findProblem(problems, problemId);

  const [picked, setPicked] = useState<{ file: File; src: SourceFile } | null>(null);
  const [lang, setLang] = useState<Language>(() => loadLanguage());
  const [fileError, setFileError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<DemoOutcome>('auto');
  const [phase, setPhase] = useState<Phase>('idle');
  const [tests, setTests] = useState<TestResult[]>([]);
  const [report, setReport] = useState<JudgeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Submit a solution · Code+';
    return () => abortRef.current?.abort();
  }, []);

  const grouped = useMemo(() => {
    const groups: Record<Difficulty, typeof problems> = { Easy: [], Medium: [], Hard: [] };
    problems.forEach((p) => groups[p.difficulty].push(p));
    return groups;
  }, [problems]);

  async function pick(files: File[]) {
    setFileError(null);
    try {
      const src = await readSourceFile(files[0]);
      setPicked({ file: files[0], src });
      if (src.language) setLang(src.language);
      setPhase('idle');
      setReport(null);
      setSaveWarning(null);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'That file could not be read.');
    }
  }

  async function submit() {
    if (!picked || !problem || !user || phase === 'judging') return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('judging');
    setTests([]);
    setReport(null);
    setError(null);
    setSaveWarning(null);
    saveLanguage(lang);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    try {
      const r = await judge.submit({ problem, language: lang, source: picked.src.text }, { signal: ac.signal, outcome, onProgress: setTests });
      setReport(r);
      setTests(r.tests);
      setPhase('done');
      // Open in editor shows exactly what was submitted.
      saveDraft(user.id, problem.id, lang, picked.src.text);
      const blob = new Blob([picked.src.text], { type: 'text/plain' });
      recordSubmission(
        user.id,
        {
          id: newId(),
          problemId: problem.id,
          language: lang,
          verdict: r.verdict,
          cpuMs: r.cpuMs,
          memoryKb: r.memoryKb,
          failedTest: r.failedTest,
          createdAt: Date.now(),
          source: picked.src.text,
        },
        blob,
      ).catch((e: unknown) => setSaveWarning(e instanceof Error ? e.message : 'This submission could not be saved.'));
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'The judge could not be reached.');
      setPhase('error');
    }
  }

  const lines = picked ? picked.src.text.split('\n') : [];
  const recent = subs.slice(0, 6);

  return (
    <div className="page">
      <TopNav />
      <main className="submit-page">
        <header className="submit-head anim-up">
          <p className="eyebrow">Upload</p>
          <h1>Submit a solution</h1>
          <p>Upload a source file and it is judged on the problem&apos;s hidden tests. The language comes from the file extension.</p>
        </header>

        <div className="submit-layout">
          <section className="card submit-card anim-up" style={{ animationDelay: '0.06s' }} aria-labelledby="submit-form-h">
            <h2 id="submit-form-h" className="sr-only">
              Submission
            </h2>

            <div className="submit-row">
              <label className="field submit-problem">
                <span className="field-label">Problem</span>
                <select
                  className="select select-tall"
                  value={problemId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setProblemId(id);
                    setParams({ problem: String(id) }, { replace: true });
                    setPhase('idle');
                    setReport(null);
                  }}
                >
                  {(['Easy', 'Medium', 'Hard'] as Difficulty[]).map(
                    (d) =>
                      grouped[d].length > 0 && (
                        <optgroup key={d} label={d}>
                          {grouped[d].map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.id}. {p.title}
                            </option>
                          ))}
                        </optgroup>
                      ),
                  )}
                </select>
              </label>
              <label className="field submit-lang">
                <span className="field-label">Language</span>
                <select className="select select-tall" value={lang} onChange={(e) => setLang(e.target.value as Language)}>
                  {LANGUAGE_ORDER.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGES[l].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {problem && (
              <p className="submit-limits mono">
                {problem.hiddenTests} hidden tests · {problem.timeLimitMs} ms · {problem.memoryMb} MB ·{' '}
                <Link to={`/problems/${problem.id}`}>Read the statement</Link>
              </p>
            )}

            {!picked ? (
              <Dropzone
                accept={SOURCE_ACCEPT}
                onFiles={pick}
                title="Drop your solution file here"
                hint={
                  <>
                    <span className="mono">.cpp</span> · <span className="mono">.c</span> · <span className="mono">.py</span> · up to 64 KB
                  </>
                }
              />
            ) : (
              <div className="file-card anim-up">
                <div className="file-card-head">
                  <span className="file-icon" aria-hidden="true">
                    <Icon name="file" size={18} />
                  </span>
                  <span className="file-meta">
                    <strong>{picked.src.name}</strong>
                    <span className="mono muted-xs">
                      {formatBytes(picked.src.size)} · {lines.length} lines ·{' '}
                      {picked.src.language ? `detected ${LANGUAGES[picked.src.language].short}` : 'language not detected, pick one above'}
                    </span>
                  </span>
                  <span className="file-actions">
                    <FilePickerButton accept={SOURCE_ACCEPT} onFiles={pick}>
                      Replace
                    </FilePickerButton>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Remove file"
                      title="Remove file"
                      onClick={() => {
                        setPicked(null);
                        setPhase('idle');
                        setReport(null);
                      }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </span>
                </div>
                <pre className="file-preview scroll" aria-label={`Preview of ${picked.src.name}`}>
                  {lines.slice(0, PREVIEW_LINES).map((l, i) => (
                    <span key={i} className="file-line">
                      <i aria-hidden="true">{i + 1}</i>
                      {l || ' '}
                    </span>
                  ))}
                </pre>
                {lines.length > PREVIEW_LINES && (
                  <p className="muted-xs file-more">
                    Showing the first {PREVIEW_LINES} of {lines.length} lines.
                  </p>
                )}
              </div>
            )}
            {fileError && (
              <p className="form-msg form-msg-error" role="alert">
                {fileError}
              </p>
            )}

            <div className="submit-actions">
              {judge.mode === 'demo' && (
                <label className="outcome-inline" title="No judge server is connected. Pick which verdict the simulator returns.">
                  <span>Simulated judge</span>
                  <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value as DemoOutcome)}>
                    {OUTCOMES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className="btn btn-primary btn-lg submit-go" onClick={submit} disabled={!picked || !problem || phase === 'judging'}>
                {phase === 'judging' ? (
                  <>
                    <span className="spinner" /> Judging…
                  </>
                ) : (
                  <>
                    <Icon name="upload" size={16} strokeWidth={2.2} /> Submit file
                  </>
                )}
              </button>
            </div>

            <div ref={resultRef} aria-live="polite">
              {(phase === 'judging' || phase === 'done') && problem && (
                <div className="submit-result anim-up">
                  <JudgeProgress phase={phase} tests={tests} total={problem.hiddenTests} report={report} />
                  {phase === 'done' && (
                    <div className="submit-next">
                      <Link to={`/problems/${problem.id}`} className="btn btn-ghost btn-sm">
                        <Icon name="code" size={14} /> Open in editor
                      </Link>
                      <button
                        type="button"
                        className="btn-text link-sm"
                        onClick={() => {
                          setPicked(null);
                          setPhase('idle');
                          setReport(null);
                        }}
                      >
                        Submit another file
                      </button>
                    </div>
                  )}
                </div>
              )}
              {phase === 'error' && (
                <p className="form-msg form-msg-error" role="alert">
                  {error}
                </p>
              )}
              {saveWarning && (
                <p className="form-msg form-msg-error" role="alert">
                  {saveWarning}
                </p>
              )}
            </div>
          </section>

          <aside className="submit-side anim-up" style={{ animationDelay: '0.12s' }}>
            <article className="card side-card">
              <div className="card-row">
                <h2 className="card-title">Recent submissions</h2>
                <Link to="/submissions" className="muted-sm link-muted">
                  View all
                </Link>
              </div>
              {recent.length === 0 ? (
                <p className="muted-sm">Nothing yet. Your verdicts show up here after you submit.</p>
              ) : (
                <ul className="recent-list">
                  {recent.map((s) => (
                    <li key={s.id}>
                      <Link to={`/problems/${s.problemId}`} className="recent-item">
                        <VerdictBadge verdict={s.verdict} compact />
                        <span className="recent-title">{findProblem(problems, s.problemId)?.title ?? `Problem ${s.problemId}`}</span>
                        <span className="muted-xs">{relativeTime(s.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="card side-card">
              <h2 className="card-title">Upload rules</h2>
              <ul className="rules">
                <li>
                  <Icon name="file" size={14} /> One source file: <span className="mono">.cpp .cc .c .py</span>
                </li>
                <li>
                  <Icon name="info" size={14} /> UTF-8 text, 64 KB at most
                </li>
                <li>
                  <Icon name="shield" size={14} /> Runs in the runbox sandbox with the problem&apos;s time and memory limits
                </li>
                <li>
                  <Icon name="lock" size={14} />{' '}
                  {backend === 'supabase' ? 'Files are stored privately in your account' : 'In demo mode, files stay in this browser'}
                </li>
              </ul>
            </article>
          </aside>
        </div>
      </main>
    </div>
  );
}
