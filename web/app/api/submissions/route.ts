import { NextResponse, type NextRequest } from "next/server";
import { ProblemSlug, SubmissionRequest, enqueueSubmission } from "@codeplus/shared";
import { sql } from "@/lib/db";
import { redis } from "@/lib/redis";
import { overLimit } from "@/lib/rate-limit";
import { ensureClientId, readClientId } from "@/lib/client-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_PER_MINUTE = 20;

/** POST /api/submissions: validate, record, enqueue. Returns {id}. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = SubmissionRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid submission", issues: parsed.error.issues }, { status: 400 });
  }
  const clientId = await ensureClientId();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if ((await overLimit(`c:${clientId}`, LIMIT_PER_MINUTE)) || (await overLimit(`ip:${ip}`, LIMIT_PER_MINUTE))) {
    return NextResponse.json({ error: "Too many submissions. Wait a minute and try again." }, { status: 429 });
  }
  const r = await enqueueSubmission(sql, redis, parsed.data, clientId);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ id: r.id }, { status: 202 });
}

/** GET /api/submissions?problem=slug: this browser's submissions for a problem. */
export async function GET(req: NextRequest) {
  const slug = ProblemSlug.safeParse(req.nextUrl.searchParams.get("problem"));
  if (!slug.success) return NextResponse.json({ error: "problem is required" }, { status: 400 });
  const clientId = await readClientId();
  if (!clientId) return NextResponse.json({ submissions: [] });
  const rows = await sql`
    SELECT s.id, s.language, s.code, s.status, s.verdict, s.passed, s.total, s.time_ms, s.memory_kb, s.created_at
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE p.slug = ${slug.data} AND s.client_id = ${clientId} AND s.mode = 'submit'
    ORDER BY s.created_at DESC LIMIT 50`;
  return NextResponse.json({ submissions: rows });
}
