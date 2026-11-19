/**
 * GET /api/execution/{submissionId}: Server-Sent Events stream of a
 * submission's execution events. Contract: docs/asyncapi.yaml.
 *
 * - Every event carries `id:` = its Redis stream entry id (monotonic). On
 *   reconnect the browser sends Last-Event-ID and we replay only the gap from
 *   the stream before switching to live pub/sub delivery.
 * - Live delivery comes through the process-wide PSUBSCRIBE hub. We register
 *   the listener *before* reading the log, buffer what arrives meanwhile, and
 *   drop anything at or below the last id already sent, so nothing is lost or
 *   duplicated in the gap between replay and live.
 * - `: heartbeat` every 15 s keeps proxies and firewalls from idling the
 *   connection out; `X-Accel-Buffering: no` stops nginx buffering it.
 * - A client whose socket stays full (no drain) for 5 s is disconnected.
 * - The stream ends after the terminal "completed" event.
 */
import type { NextRequest } from "next/server";
import { ExecEvent, SubmissionId, keys } from "@codeplus/shared";
import { redis, subscribe, subscriberReady } from "@/lib/redis";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const SLOW_CLIENT_MS = 5_000;
const RETRY_MS = 2_000;
const STREAM_ID = /^\d+-\d+$/;

function cmpId(a: string, b: string): number {
  const [am, as] = a.split("-").map(BigInt);
  const [bm, bs] = b.split("-").map(BigInt);
  return am === bm ? (as === bs ? 0 : as < bs ? -1 : 1) : am < bm ? -1 : 1;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ submissionId: string }> }) {
  const parsed = SubmissionId.safeParse((await ctx.params).submissionId);
  if (!parsed.success) return new Response("bad submission id", { status: 400 });
  const id = parsed.data;

  const header = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("lastEventId") ?? "";
  const resumeFrom = STREAM_ID.test(header) ? header : "0-0";

  // The event log expires an hour after the last event. For older finished
  // submissions, fall back to the stored result.
  const logExists = (await redis.exists(keys.events(id))) === 1;
  let stored: ExecEvent | null = null;
  let gone = false;
  if (!logExists) {
    const [row] = await sql<{ status: string; result: ExecEvent | null }[]>`
      SELECT status, result FROM submissions WHERE id = ${id}`;
    if (!row) return new Response("submission not found", { status: 404 });
    stored = row.result;
    // Still queued or running (e.g. it waited in the queue past the log's
    // TTL): follow it live instead of declaring it expired.
    gone = !stored && row.status === "done";
  }

  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        let closed = false;
        let lastSent = resumeFrom;
        let replaying = true;
        const pending: { id: string; event: ExecEvent }[] = [];
        let fullSince = 0;

        const close = () => {
          if (closed) return;
          closed = true;
          cleanup();
          try {
            controller.close();
          } catch {}
        };
        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(enc.encode(chunk));
          } catch {
            close();
          }
        };
        const send = (eid: string, event: ExecEvent) => {
          if (closed || cmpId(eid, lastSent) <= 0) return;
          lastSent = eid;
          write(`id: ${eid}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if (event.type === "completed") close();
        };

        write(`retry: ${RETRY_MS}\n\n`);

        if (stored || gone) {
          // Finished long ago (or never produced events): one synthetic event.
          if (stored) write(`id: ${stored.at}-0\nevent: ${stored.type}\ndata: ${JSON.stringify(stored)}\n\n`);
          else write(`event: expired\ndata: {}\n\n`);
          close();
          return;
        }

        const unsubscribe = subscribe(id, (raw) => {
          try {
            const msg = JSON.parse(raw) as { id: string; event: unknown };
            const event = ExecEvent.parse(msg.event);
            if (replaying) pending.push({ id: msg.id, event });
            else send(msg.id, event);
          } catch (e) {
            console.error("bad execution event", e);
          }
        });
        const timer = setInterval(() => {
          // Backpressure: desiredSize <= 0 means the client isn't draining.
          if ((controller.desiredSize ?? 1) <= 0) {
            fullSince ||= Date.now();
            if (Date.now() - fullSince > SLOW_CLIENT_MS) close();
          } else fullSince = 0;
        }, 1_000);
        const heartbeat = setInterval(() => write(": heartbeat\n\n"), HEARTBEAT_MS);
        const onAbort = () => close();
        req.signal.addEventListener("abort", onAbort);
        cleanup = () => {
          unsubscribe();
          clearInterval(timer);
          clearInterval(heartbeat);
          req.signal.removeEventListener("abort", onAbort);
        };

        // Replay everything after Last-Event-ID from the durable log.
        try {
          await subscriberReady();
          const entries = (await redis.xrange(keys.events(id), `(${resumeFrom}`, "+")) as [string, string[]][];
          for (const [eid, fields] of entries) send(eid, ExecEvent.parse(JSON.parse(fields[1])));
        } catch (e) {
          console.error("replay failed", e);
          close();
          return;
        }
        replaying = false;
        for (const p of pending.splice(0)) send(p.id, p.event);
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: 64 }, // queued chunks before we consider the client slow
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
