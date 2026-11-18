import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { ClientId } from "@codeplus/shared";

export const CLIENT_COOKIE = "cp_client";

/** Anonymous per-browser id; there are no accounts yet. */
export async function readClientId(): Promise<ClientId | null> {
  const v = (await cookies()).get(CLIENT_COOKIE)?.value;
  const r = ClientId.safeParse(v);
  return r.success ? r.data : null;
}

/** Reads the id, creating and setting the cookie if needed (route handlers only). */
export async function ensureClientId(): Promise<ClientId> {
  const existing = await readClientId();
  if (existing) return existing;
  const id = ClientId.parse(randomBytes(18).toString("base64url"));
  (await cookies()).set(CLIENT_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}
