import Link from "next/link";
import { listProblems } from "@/lib/problems";
import { readClientId } from "@/lib/client-id";

export const dynamic = "force-dynamic";

export default async function Home() {
  const problems = await listProblems(await readClientId());
  return (
    <main className="container">
      <section className="hero">
        <h1>Problems</h1>
        <p>
          Write a solution in C++, C or Python and submit it. Every submission is compiled and run in an
          isolated Linux sandbox, and you watch each test case finish live.
        </p>
      </section>
      {problems.length === 0 ? (
        <p className="empty">No problems yet. Run <code>npm run seed</code> or upload one.</p>
      ) : (
        <table className="problems">
          <thead>
            <tr>
              <th aria-label="Solved" />
              <th>Title</th>
              <th>Difficulty</th>
              <th>Acceptance</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((p, i) => (
              <tr key={p.slug}>
                <td className="status">{p.solved ? "✓" : ""}</td>
                <td>
                  <Link href={`/problems/${p.slug}`}>
                    {i + 1}. {p.title}
                  </Link>
                </td>
                <td className={`diff-${p.difficulty}`}>{cap(p.difficulty)}</td>
                <td>{p.submits ? `${((100 * p.accepted) / p.submits).toFixed(1)}%` : "–"}</td>
                <td>
                  {p.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
