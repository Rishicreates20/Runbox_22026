"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { MAX_PAPER_FILE_BYTES, PAPER_FILE_TYPES, splitPaper, type PaperExample } from "@codeplus/shared";

type Source = "file" | "paste" | "link";

interface Extracted {
  text: string;
  title: string;
  source: string;
  kind: string;
}

const METHOD_NOTE: Record<ReturnType<typeof splitPaper>["method"], string> = {
  labels: "Found questions by their labels (Q1, Question 2, Problem 3…).",
  headings: "Found questions by their headings.",
  numbers: "Found questions as a numbered list (1., 2., 3.…).",
  separators: "Found one question per slide or section.",
  whole: "Couldn't see separate questions, so the whole text is one question.",
};

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180];

export default function Importer() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("file");
  const [pasted, setPasted] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [doc, setDoc] = useState<Extracted | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function extract(body: FormData | { url: string } | { text: string }, label: string) {
    setError(null);
    setBusy(label);
    try {
      const res = await fetch("/api/papers/extract", {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? `Import failed (${res.status}).`);
      else if (!String(data.text ?? "").trim()) setError("No text was found in that document.");
      else setDoc(data as Extracted);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_PAPER_FILE_BYTES) return setError("The file is larger than 15 MB.");
    const fd = new FormData();
    fd.append("file", f);
    extract(fd, `Reading ${f.name}…`);
  }

  if (doc) return <Review doc={doc} onBack={() => setDoc(null)} onSaved={(id) => router.push(`/papers/${id}`)} />;

  return (
    <section className="importer pane">
      <div className="tabs" role="tablist">
        {(
          [
            ["file", "Upload a file"],
            ["paste", "Paste questions"],
            ["link", "From a link"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={source === k}
            className={`tab ${source === k ? "active" : ""}`}
            onClick={() => (setSource(k), setError(null))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="importer-body">
        {error && <div className="error-banner">{error}</div>}

        {source === "file" && (
          <label
            className={`dropzone ${drag ? "drag" : ""}`}
            onDragOver={(e) => (e.preventDefault(), setDrag(true))}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pickFile(e.dataTransfer.files[0]);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept={PAPER_FILE_TYPES.join(",")}
              onChange={(e) => (pickFile(e.target.files?.[0]), (e.target.value = ""))}
              disabled={busy !== null}
              hidden
            />
            <strong>{busy ?? "Drop your paper here, or click to choose a file"}</strong>
            <span className="hint">PDF, Word (.docx), PowerPoint (.pptx) or a text file, up to 15 MB</span>
          </label>
        )}

        {source === "paste" && (
          <>
            <textarea
              className="mono"
              rows={12}
              placeholder={"Q1. Sum of numbers\nRead n, then n integers, and print their sum.\nSample Input\n3\n1 2 3\nSample Output\n6\n\nQ2. …"}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <div className="row-end">
              <button
                className="btn primary"
                disabled={!pasted.trim() || busy !== null}
                onClick={() => extract({ text: pasted }, "Reading…")}
              >
                {busy ?? "Continue"}
              </button>
            </div>
          </>
        )}

        {source === "link" && (
          <form
            className="link-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) extract({ url: link.trim() }, "Fetching…");
            }}
          >
            <input
              type="url"
              required
              placeholder="https://… (web page, PDF, Google Doc or Slides)"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <button className="btn primary" disabled={busy !== null}>
              {busy ?? "Fetch"}
            </button>
            <p className="hint">
              The link must be open to anyone. Google Docs and Slides work when shared as &quot;anyone with the link&quot;.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}

function Review({ doc, onBack, onSaved }: { doc: Extracted; onBack: () => void; onSaved: (id: string) => void }) {
  const [text, setText] = useState(doc.text);
  const deferred = useDeferredValue(text);
  const split = useMemo(() => splitPaper(deferred), [deferred]);
  const [title, setTitle] = useState(() => (doc.title || split.title || doc.source).slice(0, 120));
  const [duration, setDuration] = useState(() => {
    if (split.durationMin) return split.durationMin; // the paper says how long it is
    const guess = Math.max(15, Math.min(180, split.questions.length * 20));
    return DURATIONS.find((d) => d >= guess) ?? 180;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Test cases the user added or fixed, per question number (overrides what
  // was found in the text).
  const [edited, setEdited] = useState<Record<number, PaperExample[]>>({});
  const [open, setOpen] = useState<number | null>(null);
  const testsOf = (i: number) => edited[i] ?? split.questions[i]?.examples ?? [];
  const tooMany = split.questions.length > 40;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Mock paper",
          source: doc.source.slice(0, 500),
          durationMin: duration,
          intro: split.intro.slice(0, 20_000),
          questions: split.questions.map((q, i) => ({
            ...q,
            title: q.title.slice(0, 120),
            examples: testsOf(i).filter((e) => e.input.trim() || e.output.trim()).slice(0, 10),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? `Saving failed (${res.status}).`);
      else onSaved(data.id);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="review">
      <div className="review-head">
        <label>
          <span className="field-label">Paper title</span>
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          <span className="field-label">Time</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[...new Set([...DURATIONS, duration])].sort((x, y) => x - y).map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ""}`}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button className="btn" onClick={onBack} disabled={saving}>
          Back
        </button>
        <button className="btn primary" onClick={save} disabled={saving || split.questions.length === 0 || tooMany}>
          {saving ? "Saving…" : `Practise ${split.questions.length} question${split.questions.length === 1 ? "" : "s"} →`}
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="review-grid">
        <div className="pane">
          <div className="tabs">
            <span className="hint">Text from {doc.source}</span>
          </div>
          <textarea className="mono review-text" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="pane">
          <div className="tabs">
            <span className="hint">
              {split.questions.length} question{split.questions.length === 1 ? "" : "s"} found
            </span>
          </div>
          <div className="scroll">
            <p className="hint">
              {METHOD_NOTE[split.method]} Wrong split? Edit the text so each question starts on its own line with
              &quot;Q1&quot;, &quot;Q2&quot;… and this list updates.
            </p>
            {tooMany && <div className="error-banner">At most 40 questions per paper. Remove some from the text.</div>}
            <ol className="found">
              {split.questions.map((q, i) => (
                <li key={i}>
                  <div className="found-title">
                    <strong>Q{i + 1}.</strong> {q.title}
                  </div>
                  <div className="found-preview">{q.statement.slice(0, 220)}</div>
                  <div className="found-tests">
                    <span className={testsOf(i).length ? "found-ok" : "found-warn"}>
                      {testsOf(i).length
                        ? `✓ ${testsOf(i).length} test case${testsOf(i).length > 1 ? "s" : ""}${edited[i] ? "" : " found"}: Submit checks ${testsOf(i).length > 1 ? "them" : "it"}`
                        : "No test cases found: add one so your answer can be checked"}
                    </span>
                    <button className="btn small" onClick={() => setOpen(open === i ? null : i)}>
                      {open === i ? "Done" : testsOf(i).length ? "View / edit tests" : "+ Add test case"}
                    </button>
                  </div>
                  {open === i && (
                    <TestsEditor
                      tests={testsOf(i).length ? testsOf(i) : [{ input: "", output: "" }]}
                      onChange={(t) => setEdited({ ...edited, [i]: t })}
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

function TestsEditor({ tests, onChange }: { tests: PaperExample[]; onChange: (t: PaperExample[]) => void }) {
  const set = (j: number, k: keyof PaperExample, v: string) => onChange(tests.map((t, x) => (x === j ? { ...t, [k]: v } : t)));
  return (
    <div className="tests-editor">
      {tests.map((t, j) => (
        <div key={j} className="test-pair">
          <label>
            <span className="field-label">Input {j + 1} (stdin)</span>
            <textarea className="mono" rows={3} value={t.input} spellCheck={false} onChange={(e) => set(j, "input", e.target.value)} />
          </label>
          <label>
            <span className="field-label">Expected output</span>
            <textarea className="mono" rows={3} value={t.output} spellCheck={false} onChange={(e) => set(j, "output", e.target.value)} />
          </label>
          <button className="btn small" title="Remove this test" onClick={() => onChange(tests.filter((_, x) => x !== j))}>
            ✕
          </button>
        </div>
      ))}
      {tests.length < 10 && (
        <button className="btn small" onClick={() => onChange([...tests, { input: "", output: "" }])}>
          + Add another
        </button>
      )}
    </div>
  );
}
