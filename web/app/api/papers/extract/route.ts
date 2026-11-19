/**
 * POST /api/papers/extract: reads a mock paper and returns its text.
 *
 *   multipart/form-data  file=<pdf|docx|pptx|txt|md>
 *   application/json     {"url": "https://…"}  or  {"text": "…"}
 *
 * Response: {text, title, source, kind}. Nothing is stored; the browser
 * splits the text into questions (live, so the user can fix the split) and
 * then POSTs the result to /api/papers.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MAX_PAPER_FILE_BYTES } from "@codeplus/shared";
import { ExtractError, extractBytes, extractUrl } from "@/lib/extract";
import { ensureClientId } from "@/lib/client-id";
import { overLimit } from "@/lib/rate-limit";
import { BodyTooLarge, readForm, readJson } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JsonBody = z.union([
  z.strictObject({ url: z.string().min(1).max(2000) }),
  z.strictObject({ text: z.string().min(1).max(500_000) }),
]);

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const clientId = await ensureClientId();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if ((await overLimit(`extract:c:${clientId}`, 15)) || (await overLimit(`extract:ip:${ip}`, 30))) {
    return fail("Too many imports. Wait a minute and try again.", 429);
  }
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.startsWith("multipart/form-data")) {
      const form = await readForm(req, MAX_PAPER_FILE_BYTES + 64 * 1024);
      const file = form.get("file");
      if (!(file instanceof File)) return fail("No file was uploaded.");
      if (file.size > MAX_PAPER_FILE_BYTES) return fail("The file is larger than 15 MB.", 413);
      const r = await extractBytes(Buffer.from(await file.arrayBuffer()), file.name, file.type);
      return NextResponse.json({ ...r, source: file.name || "uploaded file" });
    }
    const parsed = JsonBody.safeParse((await readJson(req, 4 * 1024 * 1024)) ?? null);
    if (!parsed.success) return fail("Send a file, {\"url\": …} or {\"text\": …}.");
    if ("url" in parsed.data) return NextResponse.json(await extractUrl(parsed.data.url));
    return NextResponse.json({ text: parsed.data.text, title: "", kind: "text", source: "pasted text" });
  } catch (e) {
    if (e instanceof ExtractError) return fail(e.message, 422);
    if (e instanceof BodyTooLarge) return fail("The file is larger than 15 MB.", 413);
    console.error("paper extract failed", e);
    return fail("Something went wrong reading that document.", 500);
  }
}
