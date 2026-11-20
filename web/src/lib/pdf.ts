/**
 * Reads the text out of a PDF in the browser (no server). Uses unpdf, a
 * build of Mozilla's pdf.js that runs without a separate worker file.
 */

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 300;

export class PdfError extends Error {}

export interface PdfText {
  text: string;
  /** The title in the PDF's metadata, if it has one. */
  title: string;
  pages: number;
}

export async function readPdf(file: File, onPage?: (done: number, total: number) => void): Promise<PdfText> {
  if (file.size > MAX_PDF_BYTES) throw new PdfError('The PDF is larger than 15 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new PdfError(`${file.name} isn't a PDF. Upload a .pdf file, or paste the questions as text.`);
  }
  // Loaded on demand: pdf.js is large and only this page needs it.
  const { getDocumentProxy, getMeta } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/password/i.test(msg)) throw new PdfError('This PDF is password-protected. Remove the password and upload it again.');
    throw new PdfError("This PDF couldn't be read. It may be damaged.");
  }
  const total = Math.min(pdf.numPages, MAX_PAGES);
  const pages: string[] = [];
  for (let n = 1; n <= total; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(pageText(content.items as PdfItem[]));
    onPage?.(n, total);
  }
  let title = '';
  try {
    const meta = await getMeta(pdf);
    title = String((meta.info as Record<string, unknown>)?.Title ?? '').trim();
  } catch {
    /* no metadata */
  }
  const text = cleanPdfText(pages);
  if (!text.trim()) {
    throw new PdfError("This PDF has no text in it (it's probably scanned pages). Paste the questions as text instead.");
  }
  return { text, title, pages: total };
}

interface PdfItem {
  str?: string;
  transform?: number[];
  height?: number;
  hasEOL?: boolean;
}

/**
 * Joins a page's text items like pdf.js does, but marks superscripts: a
 * smaller item raised above the one before it ("10" then a raised "6")
 * becomes "10^6" instead of "106".
 */
function pageText(items: PdfItem[]): string {
  let out = '';
  let prev: { y: number; h: number } | null = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform?.[5] ?? 0;
    const h = it.height || Math.abs(it.transform?.[3] ?? 0);
    const sup = prev && it.str.trim() && h > 0 && h < prev.h * 0.9 && y > prev.y + prev.h * 0.2 && y < prev.y + prev.h;
    if (sup && /[0-9A-Za-z)]$/.test(out)) out += '^';
    out += it.str;
    if (it.hasEOL) out += '\n';
    // Keep the baseline of normal text, so a run of superscript items is measured against it.
    if (!sup && it.str.trim()) prev = { y, h };
    if (it.hasEOL) prev = null;
  }
  return out;
}

/**
 * Tidies text pulled from a PDF:
 * - drops running headers/footers (a short line repeated on many pages,
 *   ignoring page numbers), which otherwise land mid-question;
 * - turns Wingdings bullets, which come out as a lone "l", into "- ";
 * - re-joins sentences the PDF wrapped onto a new line.
 */
export function cleanPdfText(pages: string[]): string {
  const norm = (l: string) => l.trim().replace(/\d+/g, '#');
  // Only the first and last lines of a page can be a running header or
  // footer. Section labels like "Input Format" or "Sample Input 1" repeat on
  // every page of a paper too, and must stay.
  const EDGE = 2;
  const LABEL = /^\s*(?:\*\*)?\s*(?:sample|example|input|output|constraints?|explanation|test\s*case|note)\b/i;
  const edges = (lines: string[]) => {
    const idx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
    return new Set([...idx.slice(0, EDGE), ...idx.slice(-EDGE)]);
  };
  const seen = new Map<string, number>();
  for (const page of pages) {
    const lines = page.split('\n');
    for (const key of new Set([...edges(lines)].map((i) => norm(lines[i])))) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const minRepeats = Math.max(3, Math.ceil(pages.length / 2));
  const bulletL = /^l\s+(?=[A-Z0-9(])/;
  const all = pages.join('\n').split('\n');
  const lBullets = all.filter((l) => bulletL.test(l.trim())).length >= 3;
  return pages
    .map((page) => {
      const lines = page.split('\n');
      const edge = edges(lines);
      return lines
        .filter((l, i) => {
          const k = norm(l);
          return !(edge.has(i) && k.length <= 100 && !LABEL.test(l) && (seen.get(k) ?? 0) >= minRepeats);
        })
        .map((l) => (lBullets ? l.replace(/^(\s*)l\s+(?=[A-Z0-9(])/, '$1- ').replace(/^(\s*)[•▪◦●]\s*/, '$1- ') : l))
        .reduce<string[]>((acc, l) => {
          const last = acc[acc.length - 1];
          if (last !== undefined && last.trim().length > 50 && !/[.:;!?]$/.test(last.trim()) && /^[a-z(]/.test(l.trim())) {
            acc[acc.length - 1] = `${last.trimEnd()} ${l.trim()}`;
          } else {
            // A heading after a bullet list ends the list.
            if (last !== undefined && /^\s*- /.test(last) && l.trim() && !/^\s*- /.test(l)) acc.push('');
            acc.push(l);
          }
          return acc;
        }, [])
        .join('\n')
        .trim();
    })
    .filter(Boolean)
    .join('\n\n');
}
