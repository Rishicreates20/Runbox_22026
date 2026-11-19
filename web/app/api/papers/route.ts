/**
 * POST /api/papers: saves a reviewed mock paper ({title, source, durationMin,
 * intro, questions[]}) and returns {id}. GET lists this browser's papers.
 */
import { NextResponse, type NextRequest } from "next/server";
import { PaperCreate, createPaper } from "@codeplus/shared";
import { sql } from "@/lib/db";
import { ensureClientId, readClientId } from "@/lib/client-id";
import { listPapers } from "@/lib/problems";
import { overLimit } from "@/lib/rate-limit";
import { BodyTooLarge, readJson } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await readJson(req, 8 * 1024 * 1024);
  } catch (e) {
    if (e instanceof BodyTooLarge) return NextResponse.json({ error: "paper too large" }, { status: 413 });
    throw e;
  }
  const parsed = PaperCreate.safeParse(body ?? null);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${i.path.join(".") || "paper"}: ${i.message}`, issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const clientId = await ensureClientId();
  if (await overLimit(`paper:c:${clientId}`, 10)) {
    return NextResponse.json({ error: "Too many papers at once. Wait a minute and try again." }, { status: 429 });
  }
  const id = await createPaper(sql, parsed.data, clientId);
  return NextResponse.json({ id }, { status: 201 });
}

export async function GET() {
  return NextResponse.json({ papers: await listPapers(await readClientId()) });
}
