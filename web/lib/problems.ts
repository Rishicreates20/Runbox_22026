import "server-only";
import { sql } from "./db";

export interface ProblemListItem {
  slug: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  submits: number;
  accepted: number;
  solved: boolean;
}

export async function listProblems(clientId: string | null): Promise<ProblemListItem[]> {
  return sql<ProblemListItem[]>`
    SELECT p.slug, p.title, p.difficulty, p.tags,
      count(s.id) FILTER (WHERE s.mode = 'submit' AND s.status = 'done')::int AS submits,
      count(s.id) FILTER (WHERE s.mode = 'submit' AND s.verdict = 'AC')::int AS accepted,
      coalesce(bool_or(s.mode = 'submit' AND s.verdict = 'AC' AND s.client_id = ${clientId ?? ""}), false) AS solved
    FROM problems p LEFT JOIN submissions s ON s.problem_id = p.id
    WHERE p.paper_id IS NULL
    GROUP BY p.id ORDER BY p.id`;
}

export interface PaperListItem {
  id: string;
  title: string;
  source: string;
  duration_min: number;
  created_at: Date;
  questions: number;
  solved: number;
}

/** Papers imported from this browser, newest first. */
export async function listPapers(clientId: string | null): Promise<PaperListItem[]> {
  if (!clientId) return [];
  return sql<PaperListItem[]>`
    SELECT pa.id, pa.title, pa.source, pa.duration_min, pa.created_at,
      (SELECT count(*)::int FROM problems p WHERE p.paper_id = pa.id) AS questions,
      (SELECT count(DISTINCT s.problem_id)::int FROM submissions s JOIN problems p ON p.id = s.problem_id
        WHERE p.paper_id = pa.id AND s.client_id = ${clientId} AND s.mode = 'submit' AND s.verdict = 'AC') AS solved
    FROM papers pa WHERE pa.client_id = ${clientId}
    ORDER BY pa.created_at DESC LIMIT 50`;
}

export type QuestionStatus = "solved" | "tried" | "ran" | "none";

/** Per-question progress of this browser on a paper. */
export async function paperProgress(paperId: string, clientId: string | null): Promise<Record<string, { status: QuestionStatus; verdict: string | null }>> {
  if (!clientId) return {};
  const rows = await sql<{ slug: string; solved: boolean; submitted: boolean; ran: boolean; last_verdict: string | null }[]>`
    SELECT p.slug,
      coalesce(bool_or(s.mode = 'submit' AND s.verdict = 'AC'), false) AS solved,
      coalesce(bool_or(s.mode = 'submit'), false) AS submitted,
      coalesce(bool_or(s.mode = 'run'), false) AS ran,
      (array_agg(s.verdict ORDER BY s.created_at DESC) FILTER (WHERE s.mode = 'submit' AND s.verdict IS NOT NULL))[1] AS last_verdict
    FROM problems p JOIN submissions s ON s.problem_id = p.id AND s.client_id = ${clientId}
    WHERE p.paper_id = ${paperId}
    GROUP BY p.slug`;
  return Object.fromEntries(
    rows.map((r) => [r.slug, { status: r.solved ? "solved" : r.submitted ? "tried" : r.ran ? "ran" : "none", verdict: r.last_verdict }]),
  );
}
