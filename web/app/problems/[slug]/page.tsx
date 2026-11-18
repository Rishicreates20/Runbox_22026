import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { LANGUAGES, ProblemSlug, getPaper, getProblem, getProblemNav, getSamples } from "@codeplus/shared";
import { sql } from "@/lib/db";
import Workspace from "@/components/Workspace";
import ExamBar from "@/components/ExamBar";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const s = ProblemSlug.safeParse(slug);
  if (!s.success) return null;
  const problem = await getProblem(sql, s.data);
  if (!problem) return null;
  const [samples, nav, paper] = await Promise.all([
    getSamples(sql, problem.id),
    getProblemNav(sql, problem),
    problem.paper_id ? getPaper(sql, problem.paper_id) : null,
  ]);
  return { problem, samples, nav, paper };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await load((await params).slug);
  return data ? { title: data.problem.title, description: data.problem.statement.slice(0, 160) } : {};
}

export default async function ProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await load((await params).slug);
  if (!data) notFound();
  const { problem, samples, nav, paper } = data;
  const workspaceNav = {
    prev: nav.prev && { href: `/problems/${nav.prev.slug}`, title: nav.prev.title },
    next: nav.next && { href: `/problems/${nav.next.slug}`, title: nav.next.title },
    label: paper ? `Q${nav.index} of ${nav.total}` : `${nav.index} / ${nav.total}`,
  };

  if (paper) {
    // A mock-paper question: its examples are already in the statement text,
    // which came from a document, so line breaks are kept as written.
    const description = (
      <article className="statement">
        <h1>
          Q{problem.paper_ordinal}. {problem.title}
        </h1>
        <div className="meta">
          <span className="tag">{paper.paper.title}</span>
        </div>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{problem.statement}</ReactMarkdown>
        <h3>How this question is checked</h3>
        <p className="hint">
          {samples.length > 0
            ? `${samples.length} example${samples.length > 1 ? "s were" : " was"} found in the question. Run checks your output against ${samples.length > 1 ? "them" : "it"} (they're loaded in the Testcase tab), and Submit runs all of them and records the verdict.`
            : "No sample output was found in this question, so there is nothing to check automatically. Type an input in the Testcase tab and use Run to see your program's output. Submit is off."}{" "}
          Limits: C/C++ {problem.limits.timeMs.cpp} ms, Python {problem.limits.timeMs.python} ms, {problem.limits.memoryMb} MB.
        </p>
      </article>
    );
    return (
      <>
        <ExamBar
          paperId={paper.paper.id}
          title={paper.paper.title}
          durationMin={paper.paper.duration_min}
          questions={paper.questions.map((q) => ({ slug: q.slug, title: q.title }))}
          current={problem.slug}
        />
        <Workspace
          key={problem.slug}
          className="with-exam-bar"
          slug={problem.slug}
          description={description}
          starterCode={problem.starter_code}
          samples={samples.map((s) => ({ input: s.input, displayInput: s.display_input }))}
          nav={workspaceNav}
          canSubmit={samples.length > 0}
        />
      </>
    );
  }

  // The statement is rendered on the server (SEO, no editor JS needed to read
  // it). Raw HTML in the markdown is not rendered.
  const description = (
    <article className="statement">
      <h1>{problem.title}</h1>
      <div className="meta">
        <span className={`badge diff-${problem.difficulty}`}>{problem.difficulty}</span>
        {problem.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{problem.statement}</ReactMarkdown>
      <h3>Examples</h3>
      {samples.map((s, i) => (
        <div key={s.ordinal}>
          <strong>Example {i + 1}</strong>
          <div className="example">
            <b>Input: </b>
            {s.display_input}
            {"\n"}
            <b>Output: </b>
            {s.expected_output.trimEnd()}
            {s.explanation ? (
              <>
                {"\n"}
                <b>Explanation: </b>
                {s.explanation}
              </>
            ) : null}
          </div>
        </div>
      ))}
      <h3>Limits</h3>
      <p className="hint">
        Time: {LANGUAGES.map((l) => `${l === "cpp" ? "C++" : l === "c" ? "C" : "Python"} ${problem.limits.timeMs[l]} ms`).join(", ")}
        . Memory: {problem.limits.memoryMb} MB.
      </p>
    </article>
  );

  return (
    <Workspace
      key={problem.slug}
      slug={problem.slug}
      nav={workspaceNav}
      description={description}
      starterCode={problem.starter_code}
      samples={samples.map((s) => ({ input: s.input, displayInput: s.display_input }))}
    />
  );
}
