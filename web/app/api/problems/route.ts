import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ProblemIngest, upsertProblem } from "@codeplus/shared";
import { sql } from "@/lib/db";
import { listProblems } from "@/lib/problems";
import { readClientId } from "@/lib/client-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || !given) return false;
  const a = Buffer.from(token), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET() {
  return NextResponse.json({ problems: await listProblems(await readClientId()) });
}

/**
 * POST /api/problems: upload a problem (Zod-validated ProblemUpload).
 * ?dryRun=1 validates and returns the normalised test preview without
 * saving, and needs no token. Saving needs `Authorization: Bearer ADMIN_TOKEN`.
 */
export async function POST(req: NextRequest) {
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  if (!dryRun && !authorized(req)) return NextResponse.json({ error: "admin token required" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024 * 1024)
    return NextResponse.json({ error: "upload larger than 64 MB" }, { status: 413 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = ProblemIngest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid problem", issues: parsed.error.issues.slice(0, 50).map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 422 },
    );
  }
  const p = parsed.data;
  const preview = {
    slug: p.slug,
    problemType: p.problemType,
    tests: p.tests.length,
    samples: p.tests.filter((t) => t.sample).map((t) => ({ displayInput: t.displayInput, input: t.input.slice(0, 500), expectedOutput: t.expectedOutput.slice(0, 500) })),
  };
  if (dryRun) return NextResponse.json({ ok: true, saved: false, preview });
  const id = await upsertProblem(sql, p);
  return NextResponse.json({ ok: true, saved: true, id, preview }, { status: 201 });
}
