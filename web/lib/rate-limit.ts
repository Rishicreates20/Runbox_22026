import "server-only";
import { keys } from "@codeplus/shared";
import { redis } from "./redis";

/** Fixed one-minute window counter in Redis. True when over the limit. */
export async function overLimit(key: string, perMinute: number): Promise<boolean> {
  const k = keys.rate(key);
  const [[, n]] = (await redis.multi().incr(k).expire(k, 60, "NX").exec()) as [[null, number]];
  return n > perMinute;
}
