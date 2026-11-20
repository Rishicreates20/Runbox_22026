import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Dropzone } from '../components/Dropzone';
import { Icon } from '../components/Icon';
import { ProblemStatement } from '../components/ProblemStatement';
import { TopNav } from '../components/TopNav';
import { MAX_TEST_BYTES, TEST_ACCEPT, collectTestFiles, formatBytes, pairTests, textBytes, type TestFile, type TestPair } from '../lib/files';
import { createProblem, splitParagraphs, type CreateProgress } from '../lib/problems';
import type { Difficulty, Problem } from '../lib/types';
import './CreateProblem.css';

interface SampleDraft {
  input: string;
  output: string;
  explanation: string;
}

interface FormState {
  title: string;
  difficulty: Difficulty;
  tags: string;
  summary: string;
  statement: string;
  input: string;
  output: string;
  constraints: string;
  hint: string;
  timeLimitMs: number;
  memoryMb: number;
  outputMb: number;
}

const EMPTY_FORM: FormState = {
  title: '',
  difficulty: 'Easy',
  tags: '',
  summary: '',
  statement: '',
  input: '',
  output: '',
  constraints: '',
  hint: '',
  timeLimitMs: 1000,
  memoryMb: 256,
  outputMb: 16,
};

type Errors = Partial<Record<keyof FormState | 'samples' | 'tests', string>>;

function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 6);
}

export function CreateProblemPage() {
  const { user, canCreateProblems, demoMode } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [samples, setSamples] = useState<SampleDraft[]>([{ input: '', output: '', explanation: '' }]);
  const [testFiles, setTestFiles] = useState<TestFile[]>([]);
  const [useSamples, setUseSamples] = useState(true);
  const [testError, setTestError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [progress, setProgress] = useState<CreateProgress | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Create a problem · Code+';
  }, []);

  const { pairs, unmatched } = useMemo(() => pairTests(testFiles), [testFiles]);
  const updateSamples = (fn: (prev: SampleDraft[]) => SampleDraft[]) => {
    setSamples(fn);
    if (errors.samples || errors.tests) setErrors((e) => ({ ...e, samples: undefined, tests: undefined }));
  };
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const preview: Problem = useMemo(
    () => ({
      id: 0,
      title: form.title.trim(),
      difficulty: form.difficulty,
      tags: parseTags(form.tags),
      acceptance: null,
      timeLimitMs: form.timeLimitMs,
      memoryMb: form.memoryMb,
      outputMb: form.outputMb,
      hiddenTests: pairs.length,
      summary: form.summary,
      statement: form.statement.trim() ? splitParagraphs(form.statement) : ['Your statement appears here as you type.'],
      input: form.input,
      output: form.output,
      samples: samples.filter((s) => s.input.trim() || s.output.trim()).map((s) => ({ ...s, explanation: s.explanation || undefined })),
      constraints: form.constraints.split('\n').map((c) => c.trim()).filter(Boolean),
      hint: form.hint.trim() || undefined,
      custom: true,
    }),
    [form, samples, pairs.length],
  );

  async function addTests(files: File[]) {
    setTestError(null);
    const tooBig = files.find((f) => f.size > MAX_TEST_BYTES);
    if (tooBig) {
      setTestError(`${tooBig.name} is ${formatBytes(tooBig.size)}. Each file can be at most 50 MB.`);
      return;
    }
    try {
      const found = await collectTestFiles(files);
      setTestFiles((prev) => {
        const byPath = new Map(prev.map((f) => [f.path, f]));
        found.forEach((f) => byPath.set(f.path, f));
        return Array.from(byPath.values());
      });
      if (errors.tests) setErrors((e) => ({ ...e, tests: undefined }));
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Those files could not be read.');
    }
  }

  function removePair(p: TestPair) {
    setTestFiles((prev) => prev.filter((f) => f !== p.input && f !== p.output));
  }

  function validate(): Errors {
    const e: Errors = {};
    const title = form.title.trim();
    if (title.length < 3 || title.length > 80) e.title = 'Use 3–80 characters.';
    if (!form.statement.trim()) e.statement = 'Describe the task.';
    if (form.summary.length > 200) e.summary = 'Keep the summary under 200 characters.';
    if (!(form.timeLimitMs >= 100 && form.timeLimitMs <= 10000)) e.timeLimitMs = '100–10,000 ms.';
    if (!(form.memoryMb >= 16 && form.memoryMb <= 1024)) e.memoryMb = '16–1,024 MB.';
    if (!(form.outputMb >= 1 && form.outputMb <= 64)) e.outputMb = '1–64 MB.';
    const filled = samples.filter((s) => s.input.trim() || s.output.trim());
    if (filled.length === 0) e.samples = 'Add at least one example.';
    else if (filled.some((s) => !s.input.trim() || !s.output.trim())) e.samples = 'Every example needs both an input and an output.';
    const testCount = pairs.length + (useSamples ? filled.length : 0);
    if (testCount === 0) e.tests = 'Upload at least one test, or use the examples as tests.';
    return e;
  }

  async function submit() {
    if (progress) return;
    const e = validate();
    setErrors(e);
    setSubmitError(null);
    if (Object.values(e).some(Boolean)) {
      document.querySelector('.cp-form [aria-invalid="true"], .cp-form .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const filled = samples.filter((s) => s.input.trim() && s.output.trim());
    const sampleTests: TestPair[] = useSamples
      ? filled.map((s, i) => ({
          key: `example-${i + 1}`,
          input: { path: `example-${i + 1}.in`, bytes: textBytes(s.input) },
          output: { path: `example-${i + 1}.out`, bytes: textBytes(s.output) },
        }))
      : [];
    try {
      const created = await createProblem(
        {
          title: form.title.trim(),
          difficulty: form.difficulty,
          tags: parseTags(form.tags),
          summary: form.summary.trim(),
          statement: form.statement.trim(),
          input: form.input.trim(),
          output: form.output.trim(),
          constraints: preview.constraints,
          hint: form.hint.trim(),
          samples: filled.map((s) => ({ input: s.input.replace(/\s+$/, ''), output: s.output.replace(/\s+$/, ''), ...(s.explanation.trim() ? { explanation: s.explanation.trim() } : {}) })),
          timeLimitMs: form.timeLimitMs,
          memoryMb: form.memoryMb,
          outputMb: form.outputMb,
        },
        [...sampleTests, ...pairs],
        setProgress,
      );
      navigate(`/problems/${created.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'The problem could not be created.');
      setProgress(null);
    }
  }

  if (!canCreateProblems) {
    return (
      <div className="page">
        <TopNav />
        <main className="cp-locked anim-up">
          <span className="sent-icon">
            <Icon name="lock" size={22} />
          </span>
          <h1>Only admins can add problems</h1>
          <p>
            You are signed in as <strong>{user?.username}</strong>, a regular member. Ask the site owner to give your account the admin
            role, then reload this page.
          </p>
          <Link to="/problems" className="btn btn-ghost">
            Back to problems
          </Link>
        </main>
      </div>
    );
  }

  const fieldErr = (k: keyof Errors) => (errors[k] ? { 'aria-invalid': true as const } : {});
  const totalTests = pairs.length + (useSamples ? samples.filter((s) => s.input.trim() && s.output.trim()).length : 0);
  const totalBytes = pairs.reduce((n, p) => n + p.input.bytes.length + p.output.bytes.length, 0);

  return (
    <div className="page">
      <TopNav />
      <main className="cp">
        <header className="cp-head anim-up">
          <div>
            <p className="eyebrow">Admin</p>
            <h1>Create a problem</h1>
            <p>Write the statement, add examples, then upload the hidden tests your submissions are judged on.</p>
          </div>
        </header>

        {demoMode && (
          <p className="form-msg anim-up" role="note">
            <Icon name="info" /> Demo mode: the problem is saved in this browser only. Test files are checked and counted, but not stored.
          </p>
        )}

        <div className="cp-layout">
          <form
            className="cp-form anim-up"
            style={{ animationDelay: '0.06s' }}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <fieldset className="card cp-section">
              <legend>Basics</legend>
              <div className="field">
                <label className="field-label" htmlFor="cp-title">
                  Title
                </label>
                <input id="cp-title" className="input" value={form.title} maxLength={80} placeholder="Bracket Balance" onChange={(e) => set('title', e.target.value)} {...fieldErr('title')} />
                {errors.title && <span className="field-error">{errors.title}</span>}
              </div>
              <div className="cp-grid-2">
                <div className="field">
                  <span className="field-label" id="cp-diff">
                    Difficulty
                  </span>
                  <div className="pills cp-pills" role="radiogroup" aria-labelledby="cp-diff">
                    {(['Easy', 'Medium', 'Hard'] as Difficulty[]).map((d) => (
                      <button key={d} type="button" role="radio" aria-checked={form.difficulty === d} className="pill-btn" aria-pressed={form.difficulty === d} onClick={() => set('difficulty', d)}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="cp-tags">
                    Topics <span className="cp-opt">comma separated</span>
                  </label>
                  <input id="cp-tags" className="input" value={form.tags} placeholder="stack, strings" onChange={(e) => set('tags', e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="cp-summary">
                  One-line summary <span className="cp-opt">shown in lists</span>
                </label>
                <input id="cp-summary" className="input" value={form.summary} maxLength={200} placeholder="Decide whether each bracket string closes every pair in order." onChange={(e) => set('summary', e.target.value)} {...fieldErr('summary')} />
                {errors.summary && <span className="field-error">{errors.summary}</span>}
              </div>
            </fieldset>

            <fieldset className="card cp-section">
              <legend>Limits</legend>
              <div className="cp-grid-3">
                {(
                  [
                    ['timeLimitMs', 'Time', 'ms', 100],
                    ['memoryMb', 'Memory', 'MB', 16],
                    ['outputMb', 'Output', 'MB', 1],
                  ] as const
                ).map(([key, label, unit, step]) => (
                  <div className="field" key={key}>
                    <label className="field-label" htmlFor={`cp-${key}`}>
                      {label}
                    </label>
                    <div className="unit-input">
                      <input
                        id={`cp-${key}`}
                        className="input"
                        type="number"
                        inputMode="numeric"
                        step={step}
                        value={Number.isFinite(form[key]) ? form[key] : ''}
                        onChange={(e) => set(key, e.target.valueAsNumber)}
                        {...fieldErr(key)}
                      />
                      <span>{unit}</span>
                    </div>
                    {errors[key] && <span className="field-error">{errors[key]}</span>}
                  </div>
                ))}
              </div>
            </fieldset>

            <fieldset className="card cp-section">
              <legend>Statement</legend>
              <div className="field">
                <label className="field-label" htmlFor="cp-statement">
                  Task
                </label>
                <textarea id="cp-statement" className="input textarea" rows={7} value={form.statement} placeholder={'You are given T strings made only of the characters `( ) [ ] { }`.\n\nFor each string, print `YES` if it is **balanced**, otherwise `NO`.'} onChange={(e) => set('statement', e.target.value)} {...fieldErr('statement')} />
                <span className="field-help">
                  Leave a blank line between paragraphs. Wrap code in <code className="inline-code">`backticks`</code> and bold in <code className="inline-code">**double asterisks**</code>.
                </span>
                {errors.statement && <span className="field-error">{errors.statement}</span>}
              </div>
              <div className="cp-grid-2">
                <div className="field">
                  <label className="field-label" htmlFor="cp-input">
                    Input format
                  </label>
                  <textarea id="cp-input" className="input textarea" rows={3} value={form.input} onChange={(e) => set('input', e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="cp-output">
                    Output format
                  </label>
                  <textarea id="cp-output" className="input textarea" rows={3} value={form.output} onChange={(e) => set('output', e.target.value)} />
                </div>
              </div>
              <div className="cp-grid-2">
                <div className="field">
                  <label className="field-label" htmlFor="cp-constraints">
                    Constraints <span className="cp-opt">one per line</span>
                  </label>
                  <textarea id="cp-constraints" className="input textarea mono" rows={3} value={form.constraints} placeholder={'1 ≤ T ≤ 10⁴\n1 ≤ |s| ≤ 2 · 10⁵'} onChange={(e) => set('constraints', e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="cp-hint">
                    Hint <span className="cp-opt">optional</span>
                  </label>
                  <textarea id="cp-hint" className="input textarea" rows={3} value={form.hint} onChange={(e) => set('hint', e.target.value)} />
                </div>
              </div>
            </fieldset>

            <fieldset className="card cp-section">
              <legend>Examples</legend>
              {samples.map((s, i) => (
                <div key={i} className="cp-sample">
                  <div className="cp-sample-head">
                    <strong>Example {i + 1}</strong>
                    {samples.length > 1 && (
                      <button type="button" className="icon-btn" aria-label={`Remove example ${i + 1}`} onClick={() => updateSamples((ss) => ss.filter((_, j) => j !== i))}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                  <div className="cp-grid-2">
                    <label className="field">
                      <span className="field-label">Input</span>
                      <textarea className="input textarea mono" rows={4} value={s.input} onChange={(e) => updateSamples((ss) => ss.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))} />
                    </label>
                    <label className="field">
                      <span className="field-label">Output</span>
                      <textarea className="input textarea mono" rows={4} value={s.output} onChange={(e) => updateSamples((ss) => ss.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)))} />
                    </label>
                  </div>
                  <label className="field">
                    <span className="field-label">
                      Explanation <span className="cp-opt">optional</span>
                    </span>
                    <input className="input" value={s.explanation} onChange={(e) => updateSamples((ss) => ss.map((x, j) => (j === i ? { ...x, explanation: e.target.value } : x)))} />
                  </label>
                </div>
              ))}
              {errors.samples && <span className="field-error">{errors.samples}</span>}
              {samples.length < 5 && (
                <button type="button" className="btn btn-ghost btn-sm cp-add" onClick={() => updateSamples((ss) => [...ss, { input: '', output: '', explanation: '' }])}>
                  <Icon name="plus" size={14} /> Add example
                </button>
              )}
            </fieldset>

            <fieldset className="card cp-section">
              <legend>Hidden tests</legend>
              <Dropzone
                accept={TEST_ACCEPT}
                multiple
                onFiles={addTests}
                title="Drop test files or a .zip"
                hint={
                  <>
                    Pairs like <span className="mono">1.in</span> + <span className="mono">1.out</span>, <span className="mono">input1.txt</span> +{' '}
                    <span className="mono">output1.txt</span>, or a zip of them
                  </>
                }
              />
              {testError && (
                <p className="form-msg form-msg-error" role="alert">
                  {testError}
                </p>
              )}
              <label className="check">
                <input type="checkbox" checked={useSamples} onChange={(e) => setUseSamples(e.target.checked)} />
                Also judge the examples as the first hidden tests
              </label>

              {pairs.length > 0 && (
                <div className="cp-tests scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Input</th>
                        <th scope="col">Expected output</th>
                        <th scope="col">
                          <span className="sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pairs.map((p, i) => (
                        <tr key={p.key} className="anim-in">
                          <td className="mono dim">{String(i + 1 + (useSamples ? samples.filter((s) => s.input.trim() && s.output.trim()).length : 0)).padStart(2, '0')}</td>
                          <td>
                            <span className="mono">{p.input.path}</span> <span className="muted-xs">{formatBytes(p.input.bytes.length)}</span>
                          </td>
                          <td>
                            <span className="mono">{p.output.path}</span> <span className="muted-xs">{formatBytes(p.output.bytes.length)}</span>
                          </td>
                          <td>
                            <button type="button" className="icon-btn" aria-label={`Remove test ${p.key}`} onClick={() => removePair(p)}>
                              <Icon name="x" size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {unmatched.length > 0 && (
                <div className="form-msg form-msg-error" role="status">
                  <span>
                    {unmatched.length} file{unmatched.length === 1 ? ' has' : 's have'} no partner and will be skipped:{' '}
                    <span className="mono">{unmatched.slice(0, 6).join(', ')}{unmatched.length > 6 ? '…' : ''}</span>
                  </span>
                  <button type="button" className="btn-text link-sm" onClick={() => setTestFiles((fs) => fs.filter((f) => !unmatched.includes(f.path)))}>
                    Clear
                  </button>
                </div>
              )}
              <p className="muted-sm cp-count">
                <strong>{totalTests}</strong> hidden test{totalTests === 1 ? '' : 's'}
                {pairs.length > 0 && ` · ${formatBytes(totalBytes)} uploaded`}
              </p>
              {errors.tests && <span className="field-error">{errors.tests}</span>}
            </fieldset>

            {submitError && (
              <p className="form-msg form-msg-error" role="alert">
                {submitError}
              </p>
            )}

            <div className="cp-submit">
              {progress && (
                <span className="cp-progress mono" aria-live="polite">
                  <span className="spinner spinner-lg" />
                  {progress.step === 'saving' && 'Saving the problem…'}
                  {progress.step === 'uploading' && `Uploading test ${progress.done + 1} of ${progress.total}…`}
                  {progress.step === 'finishing' && 'Finishing up…'}
                </span>
              )}
              <Link to="/problems" className="btn btn-ghost">
                Cancel
              </Link>
              <button type="submit" className="btn btn-primary" disabled={progress !== null}>
                <Icon name="check" size={16} strokeWidth={2.4} /> Create problem
              </button>
            </div>
          </form>

          <aside className="cp-preview anim-up" style={{ animationDelay: '0.12s' }} aria-label="Preview">
            <div className="cp-preview-head">
              <span className="eyebrow">Live preview</span>
              <span className="muted-xs">{totalTests} hidden tests</span>
            </div>
            <div className="cp-preview-body scroll">
              <ProblemStatement problem={preview} preview />
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
