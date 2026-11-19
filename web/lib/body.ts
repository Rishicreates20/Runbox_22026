import "server-only";

/** Thrown when a request body is larger than the route allows. */
export class BodyTooLarge extends Error {}

/**
 * Reads a request body into memory, but stops as soon as it passes `max`
 * bytes. `req.json()`/`req.formData()` buffer everything first, and a chunked
 * request has no Content-Length to check up front, so every route that
 * accepts a body from the public reads it through here.
 */
export async function readBody(req: Request, max: number): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) throw new BodyTooLarge();
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** JSON body with a size cap. Returns `undefined` for malformed JSON. */
export async function readJson(req: Request, max: number): Promise<unknown> {
  const buf = await readBody(req, max);
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** multipart/form-data body with a size cap. */
export async function readForm(req: Request, max: number): Promise<FormData> {
  const buf = await readBody(req, max);
  return new Request("http://local/", { method: "POST", headers: { "content-type": req.headers.get("content-type") ?? "" }, body: new Uint8Array(buf) }).formData();
}
