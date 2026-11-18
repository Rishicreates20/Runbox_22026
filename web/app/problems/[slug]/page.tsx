import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LANGUAGES, ProblemSlug, getProblem, getSamples } from "@codeplus/shared";
import { sql } from "@/lib/db";
import Workspace from "@/components/Workspace";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const s = ProblemSlug.safeParse(slug);
  if (!s.success) return null;
  const problem = await getProblem(sql, s.data);
  if (!problem) return null;
  return { problem, samples: await getSamples(sql, problem.id) };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await load((await params).slug);
  return data ? { title: data.problem.title, description: data.problem.statement.slice(0, 160) } : {};
}

export default async function ProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await load((await params).slug);
  if (!data) notFound();
  const { problem, samples } = data;

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
      slug={problem.slug}
      description={description}
      starterCode={problem.starter_code}
      samples={samples.map((s) => ({ input: s.input, displayInput: s.display_input }))}
    />
  );
}
