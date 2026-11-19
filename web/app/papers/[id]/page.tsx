import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { z } from "zod";
import { VERDICT_LABEL, getPaper, type Verdict } from "@codeplus/shared";
import { sql } from "@/lib/db";
import { readClientId } from "@/lib/client-id";
import { paperProgress } from "@/lib/problems";
import PaperControls from "./PaperControls";

export const dynamic = "force-dynamic";

async function load(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return getPaper(sql, id);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await load((await params).id);
  return data ? { title: data.paper.title } : {};
}

export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const data = await load((await params).id);
  if (!data) notFound();
  const { paper, questions } = data;
  const progress = await paperProgress(paper.id, await readClientId());
  const checkable = questions.filter((q) => q.examples > 0).length;
  const solved = questions.filter((q) => progress[q.slug]?.status === "solved").length;
  let host: string | null = null;
  if (/^https?:\/\//.test(paper.source)) {
    try {
      host = new URL(paper.source).hostname;
    } catch {
      // Not a parseable URL after all: show it as plain text below.
    }
  }
  // The intro often starts with the paper's own title; don't show it twice.
  const intro = paper.intro.replace(/^\s*(?:#+\s*)?(.*)\n?/, (line, first: string) =>
    first.replace(/[*_]/g, "").trim() === paper.title.trim() ? "" : line,
  ).trim();

  return (
    <main className="container paper">
      <p className="hint">
        <Link href="/practice">← Mock papers</Link>
      </p>
      <h1>{paper.title}</h1>
      <div className="paper-meta">
        <span>
          {questions.length} question{questions.length === 1 ? "" : "s"}
        </span>
        <span>{paper.duration_min} minutes</span>
        <span>
          From{" "}
          {host ? (
            <a href={paper.source} target="_blank" rel="noopener noreferrer nofollow">
              {host}
            </a>
          ) : (
            paper.source
          )}
        </span>
      </div>

      {intro && (
        <div className="statement paper-intro">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{intro}</ReactMarkdown>
        </div>
      )}

      <PaperControls
        paperId={paper.id}
        durationMin={paper.duration_min}
        firstSlug={questions[0]?.slug ?? ""}
        score={{ solved, checkable }}
      />

      <table className="problems paper-questions">
        <thead>
          <tr>
            <th>#</th>
            <th>Question</th>
            <th>Checking</th>
            <th>Your result</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q) => {
            const p = progress[q.slug];
            return (
              <tr key={q.slug}>
                <td className="hint">Q{q.paper_ordinal}</td>
                <td>
                  <Link href={`/problems/${q.slug}`}>{q.title}</Link>
                </td>
                <td className="hint">
                  {q.examples > 0 ? `${q.examples} example${q.examples > 1 ? "s" : ""}` : "Run only (no sample output)"}
                </td>
                <td>
                  {!p || p.status === "none" ? (
                    <span className="hint">Not attempted</span>
                  ) : p.status === "solved" ? (
                    <span className="v-AC">✓ Accepted</span>
                  ) : p.status === "tried" ? (
                    <span className={`v-${p.verdict ?? "WA"}`}>{p.verdict ? VERDICT_LABEL[p.verdict as Verdict] : "Submitted"}</span>
                  ) : (
                    <span className="hint">Ran code</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
