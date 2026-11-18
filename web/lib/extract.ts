import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { MAX_PAPER_FILE_BYTES } from "@codeplus/shared";

/**
 * Turns an uploaded document or a web page into Markdown-ish text for the
 * mock-paper splitter. DOCX and HTML keep their structure (headings, lists,
 * code blocks, tables) through Turndown; PDF and PPTX give plain text lines.
 */

export interface Extracted {
  text: string;
  /** Title found in the document itself, if any. */
  title: string;
  kind: "pdf" | "docx" | "pptx" | "html" | "text";
}

export class ExtractError extends Error {}

/* ------------------------------ HTML ------------------------------------ */

async function htmlToMarkdown(html: string, wholeDocument: boolean): Promise<{ md: string; title: string }> {
  const [{ default: TurndownService }, gfm, domino] = await Promise.all([
    import("turndown"),
    import("turndown-plugin-gfm"),
    import("@mixmark-io/domino"),
  ]);
  const doc = domino.createDocument(html, true);
  for (const el of Array.from(doc.querySelectorAll("script,style,noscript,iframe,svg,canvas,form,button,img,video,audio,object,embed"))) {
    el.remove();
  }
  let root: Element = doc.body ?? doc.documentElement;
  let title = (doc.querySelector("title")?.textContent ?? "").trim();
  if (wholeDocument) {
    // Web pages: keep the main content, drop navigation chrome.
    for (const el of Array.from(doc.querySelectorAll("nav,header,footer,aside,[role=navigation],[role=banner],[aria-hidden=true]"))) {
      el.remove();
    }
    root = doc.querySelector("article") ?? doc.querySelector("main,[role=main]") ?? root;
    const h1 = root.querySelector("h1")?.textContent?.trim();
    if (h1) title = h1;
  }
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.use(gfm.gfm);
  const md = td.turndown(root as unknown as HTMLElement);
  return { md: md.replace(/\n{3,}/g, "\n\n").trim(), title: title.replace(/\s+/g, " ").slice(0, 120) };
}

/* ------------------------------ files ----------------------------------- */

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

async function pptxText(buf: Buffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  // Slide order comes from presentation.xml's sldIdLst, resolved via rels.
  const pres = (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  const rels = (await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")) ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target.set(id, "ppt/" + t.replace(/^\/?ppt\//, "").replace(/^\.\//, ""));
  }
  let order = Array.from(pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g))
    .map((m) => target.get(m[1]))
    .filter((p): p is string => Boolean(p && zip.file(p)));
  if (order.length === 0) {
    order = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  }
  const slides: string[] = [];
  for (const path of order.slice(0, 500)) {
    const xml = await zip.file(path)!.async("string");
    const paras = Array.from(xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)).map((p) =>
      Array.from(p[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g))
        .map((t) => (t[0].startsWith("<a:br") ? "\n" : decodeXml(t[1])))
        .join(""),
    );
    const text = paras.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text) slides.push(text);
  }
  // Separators let the splitter fall back to one question per slide.
  return slides.join("\n\n---\n\n");
}

async function pdfText(buf: Buffer): Promise<{ text: string; title: string }> {
  const { extractText, getDocumentProxy, getMeta } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  let title = "";
  try {
    const meta = await getMeta(pdf);
    title = String((meta.info as Record<string, unknown>)?.Title ?? "");
  } catch {}
  return { text: (text as string[]).map((t) => t.trim()).join("\n\n"), title };
}

function looksBinary(buf: Buffer): boolean {
  const head = buf.subarray(0, 4096);
  return head.includes(0);
}

/** Detects the format from the bytes (not the name) and extracts text. */
export async function extractBytes(buf: Buffer, name = "", contentType = ""): Promise<Extracted> {
  if (buf.length > MAX_PAPER_FILE_BYTES) throw new ExtractError("The file is larger than 15 MB.");
  const lower = name.toLowerCase();
  try {
    if (buf.subarray(0, 5).toString("latin1") === "%PDF-") {
      const { text, title } = await pdfText(buf);
      if (!text.trim())
        throw new ExtractError("This PDF has no text layer (it's probably scanned images). Paste the questions as text instead.");
      return { text, title, kind: "pdf" };
    }
    if (buf.subarray(0, 4).toString("latin1") === "PK\u0003\u0004") {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(buf);
      if (zip.file("word/document.xml")) {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.convertToHtml(
          { buffer: buf },
          { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
        );
        const { md } = await htmlToMarkdown(value, false);
        return { text: md, title: "", kind: "docx" };
      }
      if (zip.file("ppt/presentation.xml")) return { text: await pptxText(buf), title: "", kind: "pptx" };
      throw new ExtractError("That zip file isn't a Word or PowerPoint document.");
    }
    if (/\.(doc|ppt)$/.test(lower) || buf.subarray(0, 4).toString("hex") === "d0cf11e0") {
      throw new ExtractError("Old .doc/.ppt files aren't supported. Save it as .docx or .pptx (or PDF) and upload that.");
    }
    if (looksBinary(buf)) throw new ExtractError("Unsupported file. Upload a PDF, .docx, .pptx or a text file.");
    const text = buf.toString("utf8");
    if (/html/.test(contentType) || /^\s*(<!doctype html|<html)/i.test(text.slice(0, 500)) || /\.html?$/.test(lower)) {
      const { md, title } = await htmlToMarkdown(text, true);
      return { text: md, title, kind: "html" };
    }
    return { text, title: "", kind: "text" };
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    console.error("extract failed", e);
    throw new ExtractError("Couldn't read that document. Is the file damaged or password-protected?");
  }
}

/* ------------------------------ links ----------------------------------- */

const blocked = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  blocked.addSubnet(a, p, "ipv6");
}

function isPrivate(address: string, family: number): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1], "ipv4");
  return blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * DNS lookup that refuses private, loopback and link-local addresses, so a
 * pasted link can't make the server read its own network (SSRF). Checking at
 * connect time also covers redirects and DNS rebinding.
 */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as (e: Error) => void)(err);
    const list = addresses as dns.LookupAddress[];
    const allowPrivate = process.env.PAPER_FETCH_ALLOW_PRIVATE === "1";
    if (!allowPrivate && list.some((a) => isPrivate(a.address, a.family))) {
      return (callback as (e: Error) => void)(new ExtractError("That link points to a private network address."));
    }
    if ((options as dns.LookupOptions).all) (callback as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    else (callback as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
  });
};

/** Rewrites share links of common document hosts to a direct download. */
export function directDownloadUrl(u: URL): URL {
  const doc = /^\/document\/d\/([\w-]+)/.exec(u.pathname);
  const slides = /^\/presentation\/d\/([\w-]+)/.exec(u.pathname);
  const file = /^\/file\/d\/([\w-]+)/.exec(u.pathname);
  if (u.hostname === "docs.google.com" && doc) return new URL(`https://docs.google.com/document/d/${doc[1]}/export?format=docx`);
  if (u.hostname === "docs.google.com" && slides)
    return new URL(`https://docs.google.com/presentation/d/${slides[1]}/export/pptx`);
  if (u.hostname === "drive.google.com" && file) return new URL(`https://drive.google.com/uc?export=download&id=${file[1]}`);
  if ((u.hostname === "www.dropbox.com" || u.hostname === "dropbox.com") && u.searchParams.has("dl")) {
    const d = new URL(u);
    d.searchParams.set("dl", "1");
    return d;
  }
  return u;
}

function get(url: URL, redirectsLeft: number): Promise<{ body: Buffer; contentType: string; finalUrl: URL }> {
  return new Promise((resolve, reject) => {
    // Node skips `lookup` for IP literals, so check those here (every hop).
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const family = net.isIP(host);
    if (family && process.env.PAPER_FETCH_ALLOW_PRIVATE !== "1" && isPrivate(host, family)) {
      return reject(new ExtractError("That link points to a private network address."));
    }
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(
      url,
      {
        lookup: safeLookup,
        timeout: 20_000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; CodeplusPaperImport/1.0)",
          Accept: "text/html,application/pdf,application/vnd.openxmlformats-officedocument.*,text/plain;q=0.9,*/*;q=0.5",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new ExtractError("The link redirected too many times."));
          let next: URL;
          try {
            next = new URL(res.headers.location, url);
          } catch {
            return reject(new ExtractError("The link redirected to an invalid address."));
          }
          if (!/^https?:$/.test(next.protocol)) return reject(new ExtractError("The link redirected to a non-web address."));
          return get(next, redirectsLeft - 1).then(resolve, reject);
        }
        if (status === 401 || status === 403)
          return res.resume(), reject(new ExtractError("That page needs a sign-in. Share it publicly (\"anyone with the link\"), or download it and upload the file."));
        if (status < 200 || status >= 300) return res.resume(), reject(new ExtractError(`The link returned HTTP ${status}.`));
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_PAPER_FILE_BYTES) {
            req.destroy();
            reject(new ExtractError("The linked document is larger than 15 MB."));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ body: Buffer.concat(chunks), contentType: String(res.headers["content-type"] ?? ""), finalUrl: url }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new ExtractError("The link took too long to respond.")));
    req.on("error", (e) => reject(e instanceof ExtractError ? e : new ExtractError(`Couldn't open the link (${(e as NodeJS.ErrnoException).code ?? e.message}).`)));
  });
}

export async function extractUrl(raw: string): Promise<Extracted & { source: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ExtractError("That isn't a valid link.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new ExtractError("Only http:// and https:// links are supported.");
  if (url.username || url.password) throw new ExtractError("Links with a username or password aren't supported.");
  const { body, contentType, finalUrl } = await get(directDownloadUrl(url), 5);
  if (/accounts\.google\.com|login|signin/i.test(finalUrl.hostname + finalUrl.pathname) && /html/.test(contentType)) {
    throw new ExtractError("That document isn't public. Share it as \"anyone with the link\", or download it and upload the file.");
  }
  const name = decodeURIComponent(finalUrl.pathname.split("/").pop() ?? "");
  const r = await extractBytes(body, name, contentType);
  return { ...r, source: url.toString() };
}
