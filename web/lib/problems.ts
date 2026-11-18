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
    GROUP BY p.id ORDER BY p.id`;
}
