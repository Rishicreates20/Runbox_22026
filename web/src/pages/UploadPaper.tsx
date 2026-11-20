import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Dropzone } from '../components/Dropzone';
import { Icon } from '../components/Icon';
import { formatBytes } from '../lib/files';
import { toDraft, type QuestionDraft } from '../lib/importPaper';
import { splitPaper } from '../lib/paper';
import { MAX_PDF_BYTES, PdfError, readPdf } from '../lib/pdf';
import { importQuestions } from '../lib/problems';
import type { Difficulty, Problem } from '../lib/types';
import { TopNav } from '../components/TopNav';
import './UploadPaper.css';

const MAX_QUESTIONS = 40;

const METHOD_NOTE: Record<ReturnType<typeof splitPaper>['method'], string> = {
  labels: 'Found questions by their labels (Q1, Question 2, Problem 3…).',
  headings: 'Found questions by their headings.',
  numbers: 'Found questions as a numbered list (1., 2., 3.…).',
  separators: 'Found one question per section.',
  whole: "Couldn't see separate questions, so the whole text is one question. Edit the text so each starts with Q1, Q2… and find them again.",
};

type Stage =
  | { step: 'pick' }
  | { step: 'reading'; name: string; done: number; total: number }
  | { step: 'review' }
  | { step: 'saving' }
  | { step: 'done'; created: Problem[] };

export function UploadPaperPage() {
  const { demoMode } = useAuth();
  const [stage, setStage] = useState<Stage>({ step: 'pick' });
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [paperName, setPaperName] = useState('');
  const [method, setMethod] = useState<ReturnType<typeof splitPaper>['method']>('labels');
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [showText, setShowText] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Upload a question paper · Code+';
  }, []);

  function findQuestions(raw: string, name: string, metaTitle = '') {
    const split = splitPaper(raw);
    setText(raw);
    setMethod(split.method);
    setDrafts(split.questions.map(toDraft));
    setPaperName((metaTitle || split.title || name).replace(/\.pdf$/i, '').slice(0, 120));
    setOpen(null);
    setStage({ step: 'review' });
  }

  async function onPdf(files: File[]) {
    const file = files[0];
    if (!file) return;
    setError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError(`${file.name} isn't a PDF. Upload a .pdf file, or paste the questions below.`);
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(`${file.name} is ${formatBytes(file.size)}. The limit is 15 MB.`);
      return;
    }
    setStage({ step: 'reading', name: file.name, done: 0, total: 0 });
    try {
      const pdf = await readPdf(file, (done, total) => setStage({ step: 'reading', name: file.name, done, total }));
      setSource(file.name);
      findQuestions(pdf.text, file.name, pdf.title);
    } catch (e) {
      setError(e instanceof PdfError ? e.message : `Reading ${file.name} failed. Try another PDF, or paste the questions below.`);
      setStage({ step: 'pick' });
    }
  }

  const chosen = drafts.filter((d) => d.include);
  const problems = useMemo(() => {
    const out: string[] = [];
    drafts.forEach((d, i) => {
      if (!d.include) return;
      if (d.title.trim().length < 3) out.push(`Question ${i + 1} needs a title of at least 3 characters.`);
      if (!d.statement.trim()) out.push(`Question ${i + 1} has no text.`);
    });
    if (chosen.length > MAX_QUESTIONS) out.push(`Pick at most ${MAX_QUESTIONS} questions at a time.`);
    return out;
  }, [drafts, chosen.length]);

  function update(key: string, patch: Partial<QuestionDraft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  async function save() {
    if (problems.length || chosen.length === 0) return;
    setError(null);
    setStage({ step: 'saving' });
    try {
      const created = await importQuestions(chosen, paperName);
      setStage({ step: 'done', created });
    } catch (e) {
      setError((e as Error).message);
      setStage({ step: 'review' });
    }
  }

  return (
    <div className="page">
      <TopNav />
      <main className="up">
        <header className="up-head anim-up">
          <p className="eyebrow">Upload</p>
          <h1>Turn a question paper into problems</h1>
          <p>
            Upload a PDF of coding questions. Code+ reads it in your browser, finds each question with its sample input and output,
            and adds them to your problem list so you can solve them in the editor.
          </p>
        </header>

        {error && (
          <p className="form-msg form-msg-error anim-up" role="alert">
            <Icon name="info" /> {error}
          </p>
        )}

        {stage.step === 'pick' && (
          <div className="up-pick anim-up">
            <Dropzone
              accept=".pdf,application/pdf"
              onFiles={onPdf}
              title="Drop your question paper PDF here"
              hint="PDFs with selectable text, up to 15 MB. The file stays on your device."
            />
            <details className="card up-paste">
              <summary>No PDF, or a scanned one? Paste the questions instead</summary>
              <textarea
                className="input textarea mono"
                rows={10}
                value={pasted}
                placeholder={'Q1. Sum of numbers\nRead n, then n integers, and print their sum.\nSample Input\n3\n1 2 3\nSample Output\n6\n\nQ2. …'}
                onChange={(e) => setPasted(e.target.value)}
              />
              <div className="up-row-end">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!pasted.trim()}
                  onClick={() => {
                    setError(null);
                    setSource('pasted text');
                    findQuestions(pasted, 'Pasted questions');
                  }}
                >
                  Find questions
                </button>
              </div>
            </details>
          </div>
        )}

        {stage.step === 'reading' && (
          <div className="card up-reading anim-up" aria-live="polite">
            <span className="spinner spinner-lg" />
            <div>
              <strong>Reading {stage.name}</strong>
              <p className="muted-sm">{stage.total ? `Page ${stage.done} of ${stage.total}` : 'Opening the PDF…'}</p>
            </div>
          </div>
        )}

        {(stage.step === 'review' || stage.step === 'saving') && (
          <section className="up-review anim-up">
            <div className="card up-bar">
              <label className="field up-name">
                <span className="field-label">Paper name</span>
                <input className="input" value={paperName} maxLength={120} onChange={(e) => setPaperName(e.target.value)} />
              </label>
              <div className="up-bar-actions">
                <button type="button" className="btn btn-ghost" onClick={() => (setStage({ step: 'pick' }), setError(null))} disabled={stage.step === 'saving'}>
                  Start over
                </button>
                <button type="button" className="btn btn-primary" onClick={save} disabled={stage.step === 'saving' || chosen.length === 0 || problems.length > 0}>
                  {stage.step === 'saving' ? (
                    <>
                      <span className="spinner" /> Adding…
                    </>
                  ) : (
                    <>
                      <Icon name="plus" size={16} /> Add {chosen.length} question{chosen.length === 1 ? '' : 's'}
                    </>
                  )}
                </button>
              </div>
            </div>

            <p className="muted-sm up-note">
              <strong>
                {drafts.length} question{drafts.length === 1 ? '' : 's'} found in {source}.
              </strong>{' '}
              {METHOD_NOTE[method]} Check each one below; untick any you don't want.
              {demoMode && ' Demo mode: imported questions are saved in this browser only.'}
            </p>
            {problems.length > 0 && (
              <p className="form-msg form-msg-error" role="alert">
                <Icon name="info" /> {problems[0]}
              </p>
            )}

            <details className="card up-text" open={showText} onToggle={(e) => setShowText((e.target as HTMLDetailsElement).open)}>
              <summary>Wrong split? Edit the text from the PDF</summary>
              <p className="muted-sm">Start each question on its own line with Q1, Q2… (or Question 1, Problem 2…), then find them again.</p>
              <textarea className="input textarea mono" rows={14} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="up-row-end">
                <button type="button" className="btn btn-ghost" onClick={() => findQuestions(text, paperName)}>
                  <Icon name="reset" size={14} /> Find questions again
                </button>
              </div>
            </details>

            <ol className="up-list">
              {drafts.map((d, i) => (
                <QuestionCard
                  key={d.key}
                  n={i + 1}
                  draft={d}
                  open={open === d.key}
                  onToggle={() => setOpen(open === d.key ? null : d.key)}
                  onChange={(patch) => update(d.key, patch)}
                />
              ))}
            </ol>
          </section>
        )}

        {stage.step === 'done' && (
          <section className="card up-done anim-up">
            <span className="up-done-icon">
              <Icon name="check" size={22} strokeWidth={2.6} />
            </span>
            <h2>
              Added {stage.created.length} question{stage.created.length === 1 ? '' : 's'} from {paperName || 'your paper'}
            </h2>
            <p className="muted-sm">They're in your problem list, tagged Imported. Only you can see them.</p>
            <ul className="up-done-list">
              {stage.created.map((p) => (
                <li key={p.id}>
                  <Link to={`/problems/${p.id}`}>
                    <span className="mono dim">{p.id}.</span> {p.title}
                  </Link>
                  <span className="muted-xs">
                    {p.samples.length} test{p.samples.length === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
            <div className="up-row-end">
              <button type="button" className="btn btn-ghost" onClick={() => setStage({ step: 'pick' })}>
                Upload another
              </button>
              {stage.created[0] && (
                <Link className="btn btn-primary" to={`/problems/${stage.created[0].id}`}>
                  Start solving <Icon name="play" size={14} />
                </Link>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function QuestionCard({
  n,
  draft: d,
  open,
  onToggle,
  onChange,
}: {
  n: number;
  draft: QuestionDraft;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<QuestionDraft>) => void;
}) {
  const tests = d.samples.filter((s) => s.input.trim() || s.output.trim()).length;
  const setSample = (j: number, k: 'input' | 'output', v: string) => onChange({ samples: d.samples.map((s, x) => (x === j ? { ...s, [k]: v } : s)) });
  return (
    <li className={`card up-q${d.include ? '' : ' is-off'}`}>
      <div className="up-q-head">
        <label className="check" title={d.include ? 'Leave this question out' : 'Include this question'}>
          <input type="checkbox" checked={d.include} onChange={(e) => onChange({ include: e.target.checked })} />
          <span className="sr-only">Include question {n}</span>
        </label>
        <span className="up-q-n mono">Q{n}</span>
        <input className="input up-q-title" value={d.title} maxLength={80} aria-label={`Title of question ${n}`} onChange={(e) => onChange({ title: e.target.value })} />
        <select className="select" value={d.difficulty} aria-label={`Difficulty of question ${n}`} onChange={(e) => onChange({ difficulty: e.target.value as Difficulty })}>
          <option>Easy</option>
          <option>Medium</option>
          <option>Hard</option>
        </select>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} aria-expanded={open}>
          {open ? 'Done' : 'Edit'}
        </button>
      </div>
      {!open && <p className="up-q-preview">{d.statement.slice(0, 260)}</p>}
      <p className={`up-q-tests ${tests ? 'ok' : 'warn'}`}>
        <Icon name={tests ? 'check' : 'info'} size={13} />
        {tests ? `${tests} sample test${tests === 1 ? '' : 's'} found` : 'No sample input/output found. Add one so answers can be checked.'}
        {d.input && ' · input format'}
        {d.output && ' · output format'}
        {d.constraints && ' · constraints'}
      </p>
      {open && (
        <div className="up-q-edit">
          <label className="field">
            <span className="field-label">Question</span>
            <textarea className="input textarea" rows={6} value={d.statement} onChange={(e) => onChange({ statement: e.target.value })} />
          </label>
          <div className="up-grid-2">
            <label className="field">
              <span className="field-label">Input format</span>
              <textarea className="input textarea" rows={3} value={d.input} onChange={(e) => onChange({ input: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Output format</span>
              <textarea className="input textarea" rows={3} value={d.output} onChange={(e) => onChange({ output: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Constraints, one per line</span>
            <textarea className="input textarea mono" rows={2} value={d.constraints} onChange={(e) => onChange({ constraints: e.target.value })} />
          </label>
          {d.samples.map((s, j) => (
            <div key={j} className="up-grid-2 up-sample">
              <label className="field">
                <span className="field-label">Sample {j + 1} input</span>
                <textarea className="input textarea mono" rows={3} value={s.input} onChange={(e) => setSample(j, 'input', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">
                  Expected output
                  <button type="button" className="icon-btn" aria-label={`Remove sample ${j + 1}`} onClick={() => onChange({ samples: d.samples.filter((_, x) => x !== j) })}>
                    <Icon name="trash" size={13} />
                  </button>
                </span>
                <textarea className="input textarea mono" rows={3} value={s.output} onChange={(e) => setSample(j, 'output', e.target.value)} />
              </label>
            </div>
          ))}
          {d.samples.length < 10 && (
            <button type="button" className="btn btn-ghost btn-sm up-add" onClick={() => onChange({ samples: [...d.samples, { input: '', output: '' }] })}>
              <Icon name="plus" size={14} /> Add sample test
            </button>
          )}
        </div>
      )}
    </li>
  );
}
