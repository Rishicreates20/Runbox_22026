import "server-only";
import { Redis } from "ioredis";
import { keys } from "@codeplus/shared";

const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

type Listener = (raw: string) => void;
interface Hub {
  sub: Redis;
  /** Resolves once Redis has acknowledged the PSUBSCRIBE. */
  ready: Promise<unknown>;
  listeners: Map<string, Set<Listener>>;
}
const g = globalThis as unknown as { __codeplusRedis?: Redis; __codeplusHub?: Hub };

/** Command connection (queue, event log, rate limits). */
export const redis = g.__codeplusRedis ?? (g.__codeplusRedis = new Redis(url, { maxRetriesPerRequest: 3 }));

/**
 * Every SSE client in this process shares ONE subscriber connection with a
 * single PSUBSCRIBE on codeplus:exec:*; messages are fanned out from an
 * in-memory registry keyed by submission id. Redis therefore sees one
 * connection per web node, not one per browser.
 */
function hub(): Hub {
  if (g.__codeplusHub) return g.__codeplusHub;
  const sub = new Redis(url);
  const listeners = new Map<string, Set<Listener>>();
  const prefix = keys.channel("");
  const ready = sub.psubscribe(keys.channelPattern).catch((e) => console.error("psubscribe failed", e));
  sub.on("pmessage", (_pattern: string, channel: string, message: string) => {
    const set = listeners.get(channel.slice(prefix.length));
    if (set) for (const fn of set) fn(message);
  });
  return (g.__codeplusHub = { sub, ready, listeners });
}

/**
 * Waits until the shared subscriber is really receiving. Only the first SSE
 * request after a process starts ever waits; callers replay the log after
 * this, so no event can fall between the replay and the live feed.
 */
export function subscriberReady(): Promise<unknown> {
  return hub().ready;
}

export function subscribe(submissionId: string, fn: Listener): () => void {
  const { listeners } = hub();
  let set = listeners.get(submissionId);
  if (!set) listeners.set(submissionId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(submissionId);
  };
}
