"use client";

import { useState } from "react";

const EXAMPLE = JSON.stringify(
  {
    slug: "sum-of-two",
    title: "Sum of Two",
    difficulty: "easy",
    tags: ["math"],
    problem_type: "generic",
    statement: "Read two integers `a` and `b` and print `a + b`.\n\n### Input\nOne line: `a b`.\n\n### Output\nTheir sum.",
    limits: { timeMs: { cpp: 1000, c: 1000, python: 2000 }, memoryMb: 64 },
    tests: [
      { input: "1 2\n", displayInput: "a = 1, b = 2", expectedOutput: "3\n", sample: true },
      { input: "1000000000 1000000000\n", displayInput: "a = 10^9, b = 10^9", expectedOutput: "2000000000\n" },
    ],
  },
  null,
  2,
);

interface Result {
  ok?: boolean;
  saved?: boolean;
  error?: string;
  issues?: { path: string; message: string }[];
  preview?: { slug: string; problemType: string; tests: number; samples: { displayInput: string; input: string; expectedOutput: string }[] };
}

export default function UploadForm() {
  const [text, setText] = useState(EXAMPLE);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    setBusy(true);
    setResult(null);
    try {
      JSON.parse(text);
    } catch (e) {
      setResult({ error: `Not valid JSON: ${(e as Error).message}` });
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`/api/problems${dryRun ? "?dryRun=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: text,
      });
      setResult(await res.json().catch(() => ({ error: `Request failed (${res.status})` })));
    } catch (e) {
      setResult({ error: `Network error: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <textarea className="mono" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button className="btn" disabled={busy || !token} onClick={() => send(true)}>
          Validate
        </button>
        <input type="password" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn primary" disabled={busy || !token} onClick={() => send(false)}>
          Save problem
        </button>
      </div>
      {result?.error && (
        <div className="error-banner">
          {result.error}
          {result.issues && (
            <ul className="issues">
              {result.issues.map((i, k) => (
                <li key={k}>
                  {i.path || "(root)"}: {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.ok && result.preview && (
        <div>
          <p>
            {result.saved ? (
              <>
                Saved. <a href={`/problems/${result.preview.slug}`}>Open the problem</a>.
              </>
            ) : (
              "Valid."
            )}{" "}
            {result.preview.tests} tests, type <code>{result.preview.problemType}</code>. Samples after normalisation:
          </p>
          {result.preview.samples.map((s, i) => (
            <div key={i} className="example">
              <b>display: </b>
              {s.displayInput}
              {"\n"}
              <b>stdin: </b>
              {JSON.stringify(s.input)}
              {"\n"}
              <b>expected: </b>
              {JSON.stringify(s.expectedOutput)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
