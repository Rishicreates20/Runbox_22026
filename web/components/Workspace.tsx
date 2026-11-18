"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { OnMount } from "@monaco-editor/react";
import {
  LANGUAGES, LANGUAGE_INFO, VERDICT_LABEL,
  type ExecEvent, type Language, type SubmissionMode, type Verdict,
} from "@codeplus/shared";
import { useExecution } from "@/lib/useExecution";

// Monaco touches window/document while loading, so it is never rendered on
// the server: the rest of the page is SSR'd, the editor mounts in the browser.
const CodeEditor = dynamic(() => import("./CodeEditor"), {
  ssr: false,
  loading: () => <div className="editor-loading">Loading editor…</div>,
});

type MonacoEditor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];
type TestResult = Extract<ExecEvent, { type: "test_result" }>;

const FALLBACK: Record<Language, string> = {
  cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n",
  c: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n",
  python: "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n\n\nmain()\n",
};

interface Props {
  slug: string;
  description: ReactNode;
  starterCode: Partial<Record<Language, string>>;
  samples: { input: string; displayInput: string }[];
  /** Previous/next question links shown in the left pane's tab bar. */
  nav?: { prev: NavLink | null; next: NavLink | null; label: string };
  /** False when there's nothing to check a submission against. */
  canSubmit?: boolean;
  /** Extra class on the grid, e.g. to leave room for the exam bar. */
  className?: string;
}

interface NavLink {
  href: string;
  title: string;
}

interface SubmissionRow {
  id: string;
  language: Language;
  code: string;
  status: string;
  verdict: Verdict | null;
  passed: number | null;
  total: number | null;
  time_ms: number | null;
  memory_kb: number | null;
  created_at: string;
}

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

export default function Workspace({ slug, description, starterCode, samples, nav, canSubmit = true, className }: Props) {
  const [leftTab, setLeftTab] = useState<"description" | "submissions">("description");
  const [consoleTab, setConsoleTab] = useState<"testcase" | "result">("testcase");
  const [language, setLanguage] = useState<Language>("cpp");
  const [ready, setReady] = useState(false);
  const [cases, setCasesState] = useState<string[]>(() => (samples.length ? samples.map((s) => s.input) : [""]));
  // Expected output typed for each case ("" = not checked); parallel to cases.
  const [expected, setExpected] = useState<string[]>(() => cases.map(() => ""));
  const casesKey = `codeplus:cases:${slug}`;
  const setCases = (next: string[], nextExpected = expected) => {
    const exp = next.map((_, j) => nextExpected[j] ?? "");
    setCasesState(next);
    setExpected(exp);
    storage.set(casesKey, JSON.stringify({ cases: next, expected: exp }));
  };
  const [activeCase, setActiveCase] = useState(0);
  const [activeResult, setActiveResult] = useState(0);
  const [current, setCurrent] = useState<{ id: string; mode: SubmissionMode } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);

  // Editor instance and Monaco API live in refs: switching language swaps the
  // model's contents and language in place instead of re-rendering the editor.
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const codeKey = (l: Language) => `codeplus:code:${slug}:${l}`;
  const initialCode = (l: Language) => storage.get(codeKey(l)) ?? starterCode[l] ?? FALLBACK[l];

  useEffect(() => {
    // Test cases you added for this problem come back after navigating away.
    try {
      const c = JSON.parse(storage.get(casesKey) ?? "null") as { cases: string[]; expected: string[] } | null;
      if (c && Array.isArray(c.cases) && c.cases.length) {
        setCasesState(c.cases.slice(0, 6).map(String));
        setExpected(c.cases.slice(0, 6).map((_, j) => String(c.expected?.[j] ?? "")));
      }
    } catch {}
    const saved = storage.get("codeplus:language") as Language | null;
    if (saved && LANGUAGES.includes(saved)) setLanguage(saved);
    setReady(true);
  }, []);

  const { events, done, connectionLost } = useExecution(current?.id ?? null);
  const running = pending || (current !== null && !done);

  const loadSubmissions = useCallback(async () => {
    const r = await fetch(`/api/submissions?problem=${slug}`, { cache: "no-store" });
    if (r.ok) setSubmissions((await r.json()).submissions);
  }, [slug]);
  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);
  useEffect(() => {
    if (done && current?.mode === "submit") loadSubmissions();
  }, [done, current, loadSubmissions]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => document.getElementById("run-btn")?.click());
  };

  function switchLanguage(next: Language, code?: string) {
    const editor = editorRef.current, monaco = monacoRef.current;
    if (editor) storage.set(codeKey(language), editor.getValue());
    setLanguage(next);
    storage.set("codeplus:language", next);
    const model = editor?.getModel();
    if (editor && monaco && model) {
      monaco.editor.setModelLanguage(model, LANGUAGE_INFO[next].monaco);
      editor.setValue(code ?? initialCode(next));
    }
  }

  async function submit(mode: SubmissionMode) {
    const code = editorRef.current?.getValue() ?? "";
    setError(null);
    setCurrent(null);
    setPending(true);
    setConsoleTab("result");
    setActiveResult(0);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem: slug, language, code, mode, ...(mode === "run" ? { customInputs: cases, customExpected: expected } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.issues?.[0]?.message ?? body.error ?? `Request failed (${res.status})`);
      else setCurrent({ id: body.id, mode });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={`workspace ${className ?? ""}`}>
      <section className="pane left">
        <div className="tabs">
          <button className={`tab ${leftTab === "description" ? "active" : ""}`} onClick={() => setLeftTab("description")}>
            Description
          </button>
          <button className={`tab ${leftTab === "submissions" ? "active" : ""}`} onClick={() => setLeftTab("submissions")}>
            Submissions
          </button>
          {nav && (
            <>
              <span className="spacer" />
              <span className="hint nav-label">{nav.label}</span>
              <NavButton link={nav.prev} dir="prev" />
              <NavButton link={nav.next} dir="next" />
            </>
          )}
        </div>
        <div className="scroll">
          {leftTab === "description" ? (
            description
          ) : (
            <SubmissionsTable rows={submissions} onPick={(s) => switchLanguage(s.language, s.code)} />
          )}
        </div>
      </section>

      <section className="right">
        <div className="pane">
          <div className="tabs">
            <select value={language} onChange={(e) => switchLanguage(e.target.value as Language)} aria-label="Language">
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_INFO[l].label}
                </option>
              ))}
            </select>
            <button
              className="btn small"
              style={{ marginLeft: 8 }}
              onClick={() => editorRef.current?.setValue(starterCode[language] ?? FALLBACK[language])}
            >
              Reset
            </button>
            <span className="spacer" />
            <button id="run-btn" className="btn" disabled={running} onClick={() => submit("run")}>
              Run
            </button>
            <button
              className="btn primary"
              style={{ marginLeft: 6 }}
              disabled={running || !canSubmit}
              title={canSubmit ? "Run every test and record the verdict" : "No sample output was found in this question, so there's nothing to check. Use Run."}
              onClick={() => submit("submit")}
            >
              Submit
            </button>
          </div>
          <div className="editor-host">
            {ready && (
              <CodeEditor
                defaultLanguage={LANGUAGE_INFO[language].monaco}
                defaultValue={initialCode(language)}
                onMount={onMount}
                onChange={(v) => storage.set(codeKey(language), v)}
              />
            )}
          </div>
        </div>

        <div className="pane">
          <div className="tabs">
            <button className={`tab ${consoleTab === "testcase" ? "active" : ""}`} onClick={() => setConsoleTab("testcase")}>
              Testcase
            </button>
            <button className={`tab ${consoleTab === "result" ? "active" : ""}`} onClick={() => setConsoleTab("result")}>
              Result
            </button>
            <span className="spacer" />
            <span className="hint">Ctrl/⌘ + Enter runs</span>
          </div>
          <div className="scroll">
            {consoleTab === "testcase" ? (
              <TestcaseEditor
                cases={cases}
                expected={expected}
                setExpected={(e) => setCases(cases, e)}
                resetCases={() => setCases(samples.length ? samples.map((s) => s.input) : [""], [])}
                samples={samples}
                active={activeCase}
                setActive={setActiveCase}
                setCases={setCases}
              />
            ) : (
              <ResultView
                error={error}
                pending={pending}
                current={current}
                events={events}
                done={done}
                connectionLost={connectionLost}
                active={activeResult}
                setActive={setActiveResult}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function NavButton({ link, dir }: { link: NavLink | null; dir: "prev" | "next" }) {
  const text = dir === "prev" ? "‹ Prev" : "Next ›";
  if (!link)
    return (
      <span className="btn small nav-btn" aria-disabled="true">
        {text}
      </span>
    );
  return (
    <Link className="btn small nav-btn" href={link.href} title={link.title} rel={dir}>
      {text}
    </Link>
  );
}

function TestcaseEditor(props: {
  cases: string[];
  expected: string[];
  setExpected: (e: string[]) => void;
  resetCases: () => void;
  samples: Props["samples"];
  active: number;
  setActive: (i: number) => void;
  setCases: (c: string[], e?: string[]) => void;
}) {
  const { cases, expected, setExpected, resetCases, samples, active, setActive, setCases } = props;
  const i = Math.min(active, cases.length - 1);
  const sample = samples.find((s) => s.input === cases[i]);
  return (
    <>
      <div className="cases">
        {cases.map((_, j) => (
          <button key={j} className={`case-chip ${j === i ? "active" : ""}`} onClick={() => setActive(j)}>
            Case {j + 1}
          </button>
        ))}
        {cases.length < 6 && (
          <button
            className="case-chip"
            onClick={() => (setCases([...cases, ""], [...expected, ""]), setActive(cases.length))}
            title="Add your own test case"
          >
            +
          </button>
        )}
        {cases.length > 1 && (
          <button
            className="case-chip"
            onClick={() => (
              setCases(
                cases.filter((_, j) => j !== i),
                expected.filter((_, j) => j !== i),
              ),
              setActive(Math.max(0, i - 1))
            )}
            title="Remove this case"
          >
            −
          </button>
        )}
      </div>
      {sample && (
        <>
          <div className="field-label">Example</div>
          <div className="out">{sample.displayInput}</div>
        </>
      )}
      <div className="field-label">stdin (exactly what your program reads)</div>
      <textarea
        className="mono"
        spellCheck={false}
        value={cases[i] ?? ""}
        onChange={(e) => setCases(cases.map((c, j) => (j === i ? e.target.value : c)))}
        rows={Math.min(10, Math.max(3, (cases[i] ?? "").split("\n").length))}
      />
      {!sample && (
        <>
          <div className="field-label">Expected output (optional: fill it in and Run checks your answer)</div>
          <textarea
            className="mono"
            spellCheck={false}
            value={expected[i] ?? ""}
            placeholder="Leave empty to just see your output"
            onChange={(e) => setExpected(cases.map((_, j) => (j === i ? e.target.value : (expected[j] ?? ""))))}
            rows={Math.min(8, Math.max(2, (expected[i] ?? "").split("\n").length))}
          />
        </>
      )}
      {samples.length > 0 && cases.some((c) => !samples.some((s) => s.input === c)) && (
        <button className="btn small" style={{ marginTop: 8 }} onClick={resetCases}>
          Restore the example cases
        </button>
      )}
    </>
  );
}

function ResultView(props: {
  error: string | null;
  pending: boolean;
  current: { id: string; mode: SubmissionMode } | null;
  events: ExecEvent[];
  done: Extract<ExecEvent, { type: "completed" }> | undefined;
  connectionLost: boolean;
  active: number;
  setActive: (i: number) => void;
}) {
  const { error, pending, current, events, done, connectionLost, active, setActive } = props;
  if (error) return <div className="error-banner">{error}</div>;
  if (pending)
    return (
      <div className="progress">
        <span className="spinner" /> Sending…
      </div>
    );
  if (!current) return <p className="hint">Run your code on the test cases, or submit it against every test.</p>;

  const results = events.filter((e): e is TestResult => e.type === "test_result");
  const last = events.at(-1);

  if (!done) {
    let text = "Connecting…";
    if (last?.type === "queued") text = last.position ? `In queue (position ${last.position + 1})` : "In queue";
    if (last?.type === "compiling") text = "Compiling…";
    if (last?.type === "running" || last?.type === "test_result")
      text = `Running test ${last.type === "running" ? last.test : Math.min(last.test + 1, last.total)} of ${last.total}`;
    return (
      <>
        <div className="progress">
          <span className="spinner" /> {text}
        </div>
        {connectionLost && <p className="hint">Connection dropped. Reconnecting and catching up…</p>}
        {current.mode === "run" && results.length > 0 && <CaseResults results={results} active={active} setActive={setActive} />}
      </>
    );
  }

  const failed = done.failedTest ? results.find((r) => r.test === done.failedTest) : undefined;
  // A run on custom input has nothing to compare against: don't call it "Accepted".
  const unchecked = current.mode === "run" && done.verdict === "AC" && results.length > 0 && results.every((r) => r.expected === undefined);
  return (
    <>
      <div className={`verdict v-${done.verdict}`}>
        {unchecked ? "Finished · output not checked" : VERDICT_LABEL[done.verdict]}
      </div>
      {done.verdict !== "CE" && done.verdict !== "IE" && (
        <div className="stats">
          {!unchecked && (
            <span>
              {done.passed} / {done.total} tests passed
            </span>
          )}
          <span>Runtime {done.timeMs} ms</span>
          <span>Memory {(done.memoryKb / 1024).toFixed(1)} MB</span>
        </div>
      )}
      {done.detail && <p className="hint">{done.detail}</p>}
      {done.compileOutput && <pre className="out err">{done.compileOutput}</pre>}
      {current.mode === "run" ? (
        results.length > 0 && <CaseResults results={results} active={active} setActive={setActive} />
      ) : failed ? (
        failed.hidden ? (
          <p className="hint">Failed on hidden test {failed.test}. Its data isn&apos;t shown.</p>
        ) : (
          <CaseDetail r={failed} />
        )
      ) : null}
    </>
  );
}

function CaseResults({ results, active, setActive }: { results: TestResult[]; active: number; setActive: (i: number) => void }) {
  const i = Math.min(active, results.length - 1);
  return (
    <>
      <div className="cases" style={{ marginTop: 10 }}>
        {results.map((r, j) => (
          <button
            key={j}
            className={`case-chip ${j === i ? "active" : ""} ${r.verdict === "AC" ? "ok" : "bad"}`}
            onClick={() => setActive(j)}
          >
            Case {r.test}
          </button>
        ))}
      </div>
      <CaseDetail r={results[i]} />
    </>
  );
}

function CaseDetail({ r }: { r: TestResult }) {
  const checked = r.expected !== undefined;
  return (
    <div>
      <div className={`v-${r.verdict}`} style={{ fontWeight: 600 }}>
        {r.verdict === "AC" && !checked ? "Finished" : VERDICT_LABEL[r.verdict]}
        <span className="hint" style={{ fontWeight: 400, marginLeft: 10 }}>
          {r.timeMs} ms · {(r.memoryKb / 1024).toFixed(1)} MB{r.detail ? ` · ${r.detail}` : ""}
        </span>
      </div>
      <div className="field-label">Input</div>
      <pre className="out">{r.displayInput && r.displayInput !== "custom input" ? r.displayInput : r.input}</pre>
      <div className="field-label">Your output</div>
      <pre className="out">{r.output || " "}</pre>
      {checked && (
        <>
          <div className="field-label">Expected</div>
          <pre className="out">{r.expected}</pre>
        </>
      )}
      {r.stderr && (
        <>
          <div className="field-label">stderr</div>
          <pre className="out err">{r.stderr}</pre>
        </>
      )}
    </div>
  );
}

function SubmissionsTable({ rows, onPick }: { rows: SubmissionRow[]; onPick: (s: SubmissionRow) => void }) {
  if (rows.length === 0) return <p className="hint">You haven&apos;t submitted this problem yet.</p>;
  return (
    <table className="subs">
      <thead>
        <tr>
          <th>Status</th>
          <th>Language</th>
          <th>Runtime</th>
          <th>Memory</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id} className="clickable" onClick={() => onPick(s)} title="Open this code in the editor">
            <td className={s.verdict ? `v-${s.verdict}` : ""}>
              {s.verdict ? VERDICT_LABEL[s.verdict] : s.status === "running" ? "Running" : "Queued"}
            </td>
            <td>{LANGUAGE_INFO[s.language].label}</td>
            <td>{s.time_ms != null && s.verdict !== "CE" ? `${Math.round(s.time_ms)} ms` : "–"}</td>
            <td>{s.memory_kb != null && s.verdict !== "CE" ? `${(s.memory_kb / 1024).toFixed(1)} MB` : "–"}</td>
            <td>{new Date(s.created_at).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
