import type { Metadata } from "next";
import Link from "next/link";
import { readClientId } from "@/lib/client-id";
import { listPapers } from "@/lib/problems";
import Importer from "./Importer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mock papers" };

export default async function PracticePage() {
  const papers = await listPapers(await readClientId());
  return (
    <main className="container practice">
      <section className="hero">
        <h1>Practise a mock paper</h1>
        <p>
          Bring your own paper: upload a PDF, Word or PowerPoint file, paste the questions, or give a link. Codeplus finds
          each question, and you solve them in order against the clock, with the editor, Run and Submit.
        </p>
      </section>

      <Importer />

      <h2 className="section-title">Your papers</h2>
      {papers.length === 0 ? (
        <p className="empty">Papers you import appear here, so you can come back to them or retake them.</p>
      ) : (
        <table className="problems">
          <thead>
            <tr>
              <th>Paper</th>
              <th>Questions</th>
              <th>Time</th>
              <th>Accepted</th>
              <th>Imported</th>
            </tr>
          </thead>
          <tbody>
            {papers.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/papers/${p.id}`}>{p.title}</Link>
                </td>
                <td>{p.questions}</td>
                <td>{p.duration_min} min</td>
                <td>{p.solved ? <span className="v-AC">{p.solved}</span> : "–"}</td>
                <td className="hint">{new Date(p.created_at).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
