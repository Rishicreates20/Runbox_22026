import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { Prec } from '@codemirror/state';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as RDragEvent,
  type KeyboardEvent as RKeyboardEvent,
  type PointerEvent as RPointerEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { VerdictBadge } from '../components/Badges';
import { codeplusTheme } from '../components/editorTheme';
import { Icon } from '../components/Icon';
import { JudgeProgress, VerdictHeader } from '../components/JudgeResult';
import { LogoMark } from '../components/Logo';
import { PlusLoader } from '../components/PlusLoader';
import { ProblemStatement } from '../components/ProblemStatement';
import { UserMenu } from '../components/TopNav';
import { LANGUAGES, LANGUAGE_ORDER } from '../data/languages';
import { SOURCE_ACCEPT, formatBytes, readSourceFile } from '../lib/files';
import { judge, type DemoOutcome } from '../lib/judge';
import { neighboursIn, useProblem, useProblems } from '../lib/problems';
import { formatCpu, formatMemory, pad2, relativeTime, statusMap } from '../lib/stats';
import { loadDraft, loadLanguage, newId, readJSON, saveDraft, saveLanguage, writeJSON } from '../lib/storage';
import { recordSubmission, useSubmissions } from '../lib/submissions';
import type { JudgeReport, Language, Problem, RunReport, Sample, TestResult } from '../lib/types';
import { useNow } from '../lib/useNow';
import { VERDICTS } from '../lib/verdicts';
import { NotFound } from './NotFound';
import './Workspace.css';

type Phase = 'idle' | 'running' | 'ran' | 'judging' | 'done' | 'error';
type EditableCase = Sample & { custom?: boolean };

const OUTCOMES: { value: DemoOutcome; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'AC', label: 'Accepted' },
  { value: 'WA', label: 'Wrong Answer' },
  { value: 'TLE', label: 'Time Limit' },
  { value: 'MLE', label: 'Memory Limit' },
  { value: 'RE', label: 'Runtime Error' },
  { value: 'SV', label: 'Blocked Syscall' },
  { value: 'OLE', label: 'Output Limit' },
  { value: 'CE', label: 'Compile Error' },
  { value: 'IE', label: 'Internal Error' },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

export function WorkspacePage() {
  const { id } = useParams();
  const { problem, ready } = useProblem(Number(id));
  if (!problem) return ready ? <NotFound /> : <PlusLoader label="Loading problem" />;
  return <Workspace key={problem.id} problem={problem} />;
}

function Workspace({ problem }: { problem: Problem }) {
  const { user } = useAuth();
  const simulatedJudge = judge.mode === 'demo';
  const userId = user!.id;
  const allSubs = useSubmissions(userId);
  const subs = useMemo(() => allSubs.filter((s) => s.problemId === problem.id), [allSubs, problem.id]);
  const solved = statusMap(subs).get(problem.id) === 'solved';
  const { prev, next } = neighboursIn(useProblems(), problem.id);

  /* ---------- Editor state ---------- */
  const [lang, setLang] = useState<Language>(() => loadLanguage());
  const [code, setCode] = useState<string>(() => loadDraft(userId, problem.id, loadLanguage()) ?? LANGUAGES[loadLanguage()].starter);
  const [saved, setSaved] = useState(true);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [confirmReset, setConfirmReset] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = `${problem.id}. ${problem.title} · Code+`;
  }, [problem]);

  // Autosave drafts shortly after typing stops.
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      saveDraft(userId, problem.id, lang, code === LANGUAGES[lang].starter ? null : code);
      setSaved(true);
    }, 450);
    return () => clearTimeout(t);
  }, [code, lang, userId, problem.id]);

  const switchLanguage = useCallback(
    (to: Language, source?: string) => {
      saveDraft(userId, problem.id, lang, code === LANGUAGES[lang].starter ? null : code);
      setLang(to);
      saveLanguage(to);
      setCode(source ?? loadDraft(userId, problem.id, to) ?? LANGUAGES[to].starter);
    },
    [userId, problem.id, lang, code],
  );

  /* ---------- Uploading a source file ---------- */
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.kind === 'error' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const loadFile = useCallback(
    async (file?: File) => {
      if (!file) return;
      try {
        const src = await readSourceFile(file);
        const to = src.language ?? lang;
        if (to !== lang) switchLanguage(to, src.text);
        else setCode(src.text);
        setNotice({
          kind: 'ok',
          text: `Loaded ${src.name} (${formatBytes(src.size)})${src.language ? ` as ${LANGUAGES[to].short}` : `. Kept ${LANGUAGES[lang].short}: the extension was not recognised`}.`,
        });
      } catch (e) {
        setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'That file could not be read.' });
      }
    },
    [lang, switchLanguage],
  );
  const hasFiles = (e: RDragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  /* ---------- Panels ---------- */
  const [leftTab, setLeftTab] = useState<'desc' | 'subs'>('desc');
  const [consoleTab, setConsoleTab] = useState<'cases' | 'result'>('cases');
  const [cases, setCases] = useState<EditableCase[]>(() => problem.samples.map((s) => ({ ...s })));
  const [caseIdx, setCaseIdx] = useState(0);
  const [layout, setLayout] = useState(() => readJSON('codeplus.layout', { left: 42, console: 300 }));
  useEffect(() => writeJSON('codeplus.layout', layout), [layout]);

  /* ---------- Judging ---------- */
  const [phase, setPhase] = useState<Phase>('idle');
  const [runReport, setRunReport] = useState<RunReport | null>(null);
  const [report, setReport] = useState<JudgeReport | null>(null);
  const [tests, setTests] = useState<TestResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DemoOutcome>('auto');
  const [resultCase, setResultCase] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const busy = phase === 'running' || phase === 'judging';

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async () => {
    if (busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('running');
    setConsoleTab('result');
    setRunReport(null);
    setError(null);
    try {
      const r = await judge.run({ problem, language: lang, source: code, cases }, { signal: ac.signal, outcome });
      setRunReport(r);
      setResultCase(Math.max(0, r.cases.findIndex((c) => !c.passed)));
      setPhase('ran');
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'The judge could not be reached.');
      setPhase('error');
    }
  }, [busy, problem, lang, code, cases, outcome]);

  const submit = useCallback(async () => {
    if (busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('judging');
    setConsoleTab('result');
    setReport(null);
    setTests([]);
    setError(null);
    try {
      const r = await judge.submit({ problem, language: lang, source: code }, { signal: ac.signal, outcome, onProgress: setTests });
      setReport(r);
      setTests(r.tests);
      setPhase('done');
      recordSubmission(userId, {
        id: newId(),
        problemId: problem.id,
        language: lang,
        verdict: r.verdict,
        cpuMs: r.cpuMs,
        memoryKb: r.memoryKb,
        failedTest: r.failedTest,
        createdAt: Date.now(),
        source: code,
      }).catch((err: unknown) => setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'This submission could not be saved.' }));
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'The judge could not be reached.');
      setPhase('error');
    }
  }, [busy, problem, lang, code, outcome, userId]);

  // Keyboard shortcuts: Mod+Enter runs, Mod+Shift+Enter submits.
  const runRef = useRef(run);
  const submitRef = useRef(submit);
  useEffect(() => {
    runRef.current = run;
    submitRef.current = submit;
  }, [run, submit]);

  const shortcuts = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', run: () => (runRef.current(), true) },
          { key: 'Mod-Shift-Enter', run: () => (submitRef.current(), true) },
          { key: 'Mod-s', run: () => true },
        ]),
      ),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (e.shiftKey) submitRef.current();
      else runRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const extensions = useMemo(
    () => [lang === 'py' ? python() : cpp(), shortcuts, EditorView.contentAttributes.of({ 'aria-label': `Source code, ${LANGUAGES[lang].short}` })],
    [lang, shortcuts],
  );

  const onEditorUpdate = useCallback((vu: ViewUpdate) => {
    if (!vu.selectionSet && !vu.docChanged) return;
    const head = vu.state.selection.main.head;
    const line = vu.state.doc.lineAt(head);
    setCursor({ line: line.number, col: head - line.from + 1 });
  }, []);

  /* ---------- Resizing ---------- */
  const bodyRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const startDrag = (axis: 'x' | 'y') => (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    document.body.classList.add(axis === 'x' ? 'dragging-x' : 'dragging-y');
    const move = (ev: PointerEvent) => {
      if (axis === 'x' && bodyRef.current) {
        const r = bodyRef.current.getBoundingClientRect();
        const left = Math.min(68, Math.max(24, ((ev.clientX - r.left) / r.width) * 100));
        setLayout((l) => ({ ...l, left }));
      } else if (axis === 'y' && rightRef.current) {
        const r = rightRef.current.getBoundingClientRect();
        const h = Math.min(r.height - 160, Math.max(140, r.bottom - ev.clientY));
        setLayout((l) => ({ ...l, console: h }));
      }
    };
    const up = () => {
      document.body.classList.remove('dragging-x', 'dragging-y');
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const nudge = (axis: 'x' | 'y') => (e: RKeyboardEvent) => {
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    if (axis === 'x') setLayout((l) => ({ ...l, left: Math.min(68, Math.max(24, l.left + d * 2)) }));
    else setLayout((l) => ({ ...l, console: Math.max(140, l.console - d * 20) }));
  };

  /* ---------- Clock ---------- */
  const [opened] = useState(() => Date.now());
  const now = useNow(1000);
  const elapsed = Math.floor((now - opened) / 1000);
  const clock = elapsed >= 3600 ? `${Math.floor(elapsed / 3600)}:${pad2(Math.floor((elapsed % 3600) / 60))}:${pad2(elapsed % 60)}` : `${pad2(Math.floor(elapsed / 60))}:${pad2(elapsed % 60)}`;

  const info = LANGUAGES[lang];
  const current = cases[caseIdx] ?? cases[0];

  return (
    <div className="ws" style={{ '--left': `${layout.left}%`, '--console': `${layout.console}px` } as CSSProperties}>
      <header className="ws-top">
        <Link to="/problems" className="logo ws-logo" aria-label="Back to problems">
          <LogoMark size={28} />
        </Link>
        <nav className="ws-crumbs" aria-label="Breadcrumb">
          <Link to="/problems">Problems</Link>
          <span aria-hidden="true">/</span>
          <span className="ws-crumb-current">
            {problem.id}. {problem.title}
          </span>
        </nav>
        <div className="ws-nav">
          {prev ? (
            <Link className="icon-btn" to={`/problems/${prev.id}`} aria-label={`Previous problem: ${prev.title}`}>
              <Icon name="chevronLeft" />
            </Link>
          ) : (
            <span className="icon-btn is-disabled" aria-hidden="true">
              <Icon name="chevronLeft" />
            </span>
          )}
          {next ? (
            <Link className="icon-btn" to={`/problems/${next.id}`} aria-label={`Next problem: ${next.title}`}>
              <Icon name="chevronRight" />
            </Link>
          ) : (
            <span className="icon-btn is-disabled" aria-hidden="true">
              <Icon name="chevronRight" />
            </span>
          )}
        </div>

        <div className="ws-center">
          <span className="ws-clock" title="Time on this problem">
            <Icon name="clock" size={14} />
            <span aria-label="Time on this problem">{clock}</span>
          </span>
        </div>

        <div className="ws-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={run} disabled={busy} title={`Run sample cases (${MOD}+Enter)`}>
            {phase === 'running' ? <span className="spinner spinner-lg" /> : <Icon name="play" size={13} />}
            Run
          </button>
          <button type="button" className="btn btn-primary btn-sm ws-submit" onClick={submit} disabled={busy} title={`Submit (${MOD}+Shift+Enter)`}>
            {phase === 'judging' ? (
              <>
                <span className="spinner" /> Judging…
              </>
            ) : (
              <>
                <Icon name="upload" size={15} strokeWidth={2.2} /> Submit
              </>
            )}
          </button>
          <UserMenu />
        </div>
      </header>

      <div className="ws-body" ref={bodyRef}>
        {/* ---------------- Problem panel ---------------- */}
        <section className="panel ws-left anim-up" aria-label="Problem">
          <div className="panel-head tabs" role="tablist">
            <button type="button" role="tab" className="tab" aria-selected={leftTab === 'desc'} onClick={() => setLeftTab('desc')}>
              <Icon name="doc" size={15} /> Description
            </button>
            <button type="button" role="tab" className="tab" aria-selected={leftTab === 'subs'} onClick={() => setLeftTab('subs')}>
              <Icon name="history" size={15} /> Submissions <span className="count">{subs.length}</span>
            </button>
          </div>

          <div className="panel-body scroll">
            {leftTab === 'desc' ? (
              <ProblemStatement problem={problem} solved={solved} />
            ) : (
              <div className="subs anim-in">
                {subs.length === 0 ? (
                  <div className="subs-empty">
                    <Icon name="history" size={26} />
                    <p>No submissions yet. When you submit, every verdict lands here.</p>
                  </div>
                ) : (
                  <table className="subs-table">
                    <thead>
                      <tr>
                        <th scope="col">Verdict</th>
                        <th scope="col">Language</th>
                        <th scope="col">CPU</th>
                        <th scope="col">Memory</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subs.map((s) => (
                        <tr key={s.id} className="anim-up">
                          <td>
                            <div className="sub-verdict">
                              <VerdictBadge verdict={s.verdict} />
                              <span>
                                {relativeTime(s.createdAt, now)}
                                {s.failedTest ? ` · test ${s.failedTest}` : ''}
                              </span>
                            </div>
                          </td>
                          <td className="mono">{LANGUAGES[s.language].short}</td>
                          <td className="mono">{s.verdict === 'CE' ? '—' : formatCpu(s.cpuMs)}</td>
                          <td className="mono">
                            <span className="sub-mem">
                              {s.verdict === 'CE' ? '—' : formatMemory(s.memoryKb)}
                              {s.source && (
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label="Open this code in the editor"
                                  title="Open in editor"
                                  onClick={() => switchLanguage(s.language, s.source)}
                                >
                                  <Icon name="code" size={14} />
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </section>

        <div
          className="resizer resizer-x"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize problem panel"
          aria-valuenow={Math.round(layout.left)}
          aria-valuemin={24}
          aria-valuemax={68}
          tabIndex={0}
          onPointerDown={startDrag('x')}
          onKeyDown={nudge('x')}
        />

        <div className="ws-right" ref={rightRef}>
          {/* ---------------- Editor ---------------- */}
          <section className="panel ws-editor anim-up" style={{ animationDelay: '0.06s' }} aria-label="Code editor">
            <div className="panel-head editor-head">
              <span className="file-tab">
                <Icon name="code" size={14} style={{ color: 'var(--accent)' }} />
                {info.file}
              </span>
              <div className="editor-tools">
                <label>
                  <span className="sr-only">Language</span>
                  <select className="select" value={lang} onChange={(e) => switchLanguage(e.target.value as Language)}>
                    {LANGUAGE_ORDER.map((l) => (
                      <option key={l} value={l}>
                        {LANGUAGES[l].label}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  ref={fileInput}
                  type="file"
                  accept={SOURCE_ACCEPT}
                  hidden
                  onChange={(e) => {
                    loadFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Upload a source file"
                  title="Upload a source file (.cpp, .c or .py), or drop one on the editor"
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon name="upload" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={copied ? 'Copied' : 'Copy code'}
                  title={copied ? 'Copied' : 'Copy code'}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(code);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1400);
                    } catch {
                      /* clipboard blocked */
                    }
                  }}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={15} />
                </button>
                {confirmReset ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm confirm-reset"
                    onClick={() => {
                      setCode(info.starter);
                      setConfirmReset(false);
                    }}
                    onBlur={() => setConfirmReset(false)}
                    autoFocus
                  >
                    Reset to starter?
                  </button>
                ) : (
                  <button type="button" className="icon-btn" aria-label="Reset to starter code" title="Reset to starter code" onClick={() => setConfirmReset(true)}>
                    <Icon name="reset" size={15} />
                  </button>
                )}
              </div>
            </div>
            <div
              className="editor-host"
              data-dragging={dragging}
              onDragEnter={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                dragDepth.current += 1;
                setDragging(true);
              }}
              onDragOver={(e) => {
                if (hasFiles(e)) e.preventDefault();
              }}
              onDragLeave={() => {
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDragging(false);
              }}
              onDropCapture={(e) => {
                if (!hasFiles(e)) return;
                // Handle file drops here so the editor does not paste the file in as text.
                e.preventDefault();
                e.stopPropagation();
                dragDepth.current = 0;
                setDragging(false);
                loadFile(e.dataTransfer.files[0]);
              }}
            >
              {dragging && (
                <div className="drop-overlay" aria-hidden="true">
                  <Icon name="upload" size={26} />
                  <strong>Drop to load this file</strong>
                  <span>.cpp, .c or .py · up to 64 KB</span>
                </div>
              )}
              {notice && (
                <div className={`editor-toast editor-toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
                  <Icon name={notice.kind === 'ok' ? 'check' : 'info'} size={14} />
                  {notice.text}
                </div>
              )}
              <CodeMirror
                value={code}
                onChange={setCode}
                onUpdate={onEditorUpdate}
                theme={codeplusTheme}
                extensions={extensions}
                height="100%"
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: true,
                  foldGutter: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: true,
                  indentOnInput: true,
                  tabSize: 4,
                }}
              />
            </div>
            <div className="statusbar">
              <span>
                <span className="save-state" data-saved={saved}>
                  <i /> {saved ? 'Saved' : 'Saving…'}
                </span>
                <span>
                  Ln {cursor.line}, Col {cursor.col}
                </span>
                <span className="hide-sm">Spaces: 4</span>
              </span>
              <span>
                <span className="hide-sm">UTF-8</span>
                <span>{info.short}</span>
                <span className="statusbar-strong">runbox · seccomp on</span>
              </span>
            </div>
          </section>

          <div
            className="resizer resizer-y"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize console"
            tabIndex={0}
            onPointerDown={startDrag('y')}
            onKeyDown={nudge('y')}
          />

          {/* ---------------- Console ---------------- */}
          <section className="panel ws-console anim-up" style={{ animationDelay: '0.12s' }} aria-label="Console">
            <div className="panel-head console-head">
              <div className="tabs" role="tablist">
                <button type="button" role="tab" className="tab" aria-selected={consoleTab === 'cases'} onClick={() => setConsoleTab('cases')}>
                  <Icon name="box" size={15} /> Testcase
                </button>
                <button type="button" role="tab" className="tab" aria-selected={consoleTab === 'result'} onClick={() => setConsoleTab('result')}>
                  <Icon name="check" size={15} /> Test result
                </button>
              </div>
              <div className="console-right">
                {phase === 'done' && report && (
                  <span className="verdict-chip-sm anim-in" style={{ color: VERDICTS[report.verdict].color, background: VERDICTS[report.verdict].bg }}>
                    <i style={{ background: VERDICTS[report.verdict].color }} />
                    {VERDICTS[report.verdict].label}
                  </span>
                )}
                {simulatedJudge && (
                  <label className="outcome" title="No judge server is connected. Pick which verdict the simulator returns.">
                    <span>Demo judge</span>
                    <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value as DemoOutcome)} disabled={busy}>
                      {OUTCOMES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>

            <div className="panel-body scroll console-body">
              {consoleTab === 'cases' ? (
                <div className="anim-in cases">
                  <div className="case-tabs">
                    {cases.map((c, i) => (
                      <span key={i} className="case-tab-wrap">
                        <button type="button" className="case-tab" aria-pressed={i === caseIdx} onClick={() => setCaseIdx(i)}>
                          Case {i + 1}
                        </button>
                        {c.custom && (
                          <button
                            type="button"
                            className="case-remove"
                            aria-label={`Remove case ${i + 1}`}
                            onClick={() => {
                              setCases((cs) => cs.filter((_, j) => j !== i));
                              setCaseIdx((ci) => Math.max(0, ci >= i ? ci - 1 : ci));
                            }}
                          >
                            <Icon name="x" size={11} strokeWidth={2.4} />
                          </button>
                        )}
                      </span>
                    ))}
                    {cases.length < 8 && (
                      <button
                        type="button"
                        className="case-add"
                        aria-label="Add a test case"
                        title="Add a test case"
                        onClick={() => {
                          setCases((cs) => [...cs, { input: cs[caseIdx]?.input ?? '', output: '', custom: true }]);
                          setCaseIdx(cases.length);
                        }}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    )}
                  </div>
                  {current && (
                    <div className="io-edit">
                      <label className="io-field">
                        <span>Input</span>
                        <textarea
                          className="io-area"
                          spellCheck={false}
                          value={current.input}
                          onChange={(e) => setCases((cs) => cs.map((c, j) => (j === caseIdx ? { ...c, input: e.target.value } : c)))}
                          rows={Math.min(8, Math.max(3, current.input.split('\n').length))}
                        />
                      </label>
                      <label className="io-field">
                        <span>Expected output {current.custom && <em>(optional)</em>}</span>
                        <textarea
                          className="io-area"
                          spellCheck={false}
                          value={current.output}
                          onChange={(e) => setCases((cs) => cs.map((c, j) => (j === caseIdx ? { ...c, output: e.target.value } : c)))}
                          rows={Math.min(8, Math.max(3, current.output.split('\n').length))}
                        />
                      </label>
                    </div>
                  )}
                </div>
              ) : (
                <ResultView
                  phase={phase}
                  runReport={runReport}
                  report={report}
                  tests={tests}
                  error={error}
                  cases={cases}
                  resultCase={resultCase}
                  setResultCase={setResultCase}
                  compileCmd={info.compile}
                  total={problem.hiddenTests}
                  demoMode={simulatedJudge}
                  onRetry={run}
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ResultView(props: {
  phase: Phase;
  runReport: RunReport | null;
  report: JudgeReport | null;
  tests: TestResult[];
  error: string | null;
  cases: EditableCase[];
  resultCase: number;
  setResultCase: (i: number) => void;
  compileCmd: string;
  total: number;
  demoMode: boolean;
  onRetry: () => void;
}) {
  const { phase, runReport, report, tests, error, cases, resultCase, setResultCase, compileCmd, total, demoMode } = props;

  if (phase === 'idle')
    return (
      <div className="result-empty anim-in">
        <Icon name="terminal" size={30} />
        <p>Run your code on the cases, or submit it for full judging.</p>
        <p className="shortcut-hint">
          <span className="kbd">{MOD}</span>
          <span className="kbd">Enter</span> run
          <span className="sep" />
          <span className="kbd">{MOD}</span>
          <span className="kbd">Shift</span>
          <span className="kbd">Enter</span> submit
        </p>
      </div>
    );

  if (phase === 'error')
    return (
      <div className="result-empty anim-in">
        <Icon name="info" size={28} style={{ color: 'var(--err)' }} />
        <p>{error}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={props.onRetry}>
          Try again
        </button>
      </div>
    );

  if (phase === 'running')
    return (
      <div className="running anim-in">
        <div className="running-head">
          <span className="spinner spinner-lg" />
          <strong>
            Running {cases.length} case{cases.length === 1 ? '' : 's'} in the sandbox…
          </strong>
        </div>
        <div className="indeterminate">
          <span />
        </div>
        <pre className="running-log">
          <span className="dim">compile </span>
          {compileCmd}
          {'\n'}
          <span className="dim">sandbox </span>namespaces · overlayfs · cgroup v2 · seccomp
        </pre>
      </div>
    );

  if (phase === 'ran' && runReport) {
    if (runReport.verdict === 'CE')
      return (
        <div className="anim-up result">
          <VerdictHeader verdict="CE" detail="Fix the error below and run again." />
          <pre className="compile-out">{runReport.compileOutput}</pre>
        </div>
      );
    const allPassed = runReport.cases.every((c) => c.passed);
    const sel = runReport.cases[resultCase] ?? runReport.cases[0];
    const failed = runReport.cases.findIndex((c) => !c.passed);
    const noExpected = sel && cases[sel.index] && !cases[sel.index].output;
    return (
      <div className="anim-up result">
        <div className="run-head">
          <span className="run-title" style={{ color: allPassed ? 'var(--ok)' : VERDICTS[runReport.verdict].color }}>
            {allPassed ? 'Cases passed' : `${VERDICTS[runReport.verdict].label} on case ${failed + 1}`}
          </span>
          <span className="mono muted-sm">
            {runReport.cases.filter((c) => c.passed).length} / {runReport.cases.length}
            {sel ? ` · ${formatCpu(sel.cpuMs)} · ${formatMemory(sel.memoryKb)}` : ''}
          </span>
        </div>
        <div className="case-tabs">
          {runReport.cases.map((c, i) => (
            <button key={i} type="button" className="case-tab" aria-pressed={i === resultCase} onClick={() => setResultCase(i)}>
              <i style={{ background: c.passed ? 'var(--ok)' : VERDICTS[c.verdict].color }} />
              Case {i + 1}
            </button>
          ))}
        </div>
        {sel && (
          <div className="io-grid io-grid-3">
            <div>
              <span className="io-label">Input</span>
              <pre>{cases[sel.index]?.input ?? ''}</pre>
            </div>
            <div>
              <span className="io-label">Your output</span>
              <pre className={sel.passed ? 'out-ok' : 'out-bad'}>{sel.stdout || <span className="dim">(no output)</span>}</pre>
            </div>
            <div>
              <span className="io-label">Expected</span>
              <pre>{sel.expected || <span className="dim">(not given)</span>}</pre>
            </div>
          </div>
        )}
        {sel?.stderr && <pre className="compile-out">{sel.stderr}</pre>}
        {noExpected && demoMode && (
          <p className="demo-note">
            <Icon name="info" /> The demo judge replays expected outputs and cannot execute custom input. Set VITE_API_URL to a Code+ server to run it for real.
          </p>
        )}
      </div>
    );
  }

  if (phase === 'judging' || phase === 'done') {
    return <JudgeProgress phase={phase} tests={tests} total={total} report={report} />;
  }

  return null;
}
