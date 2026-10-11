/**
 * Typed PDF -> lines of text (browser only). A PDF stores loose pieces of text with
 * positions, not rows, so the pieces are put back into lines by their height on the page.
 * The library is loaded on demand: nobody who only uploads Excel ever downloads it.
 *
 * A scanned PDF or a photo saved as PDF has no typed text; that is reported, and is read in
 * the photo phase (Phase D).
 */

export interface PdfPiece {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pure: pieces of one page -> lines, top to bottom, each line left to right. */
export function piecesToLines(pieces: PdfPiece[]): string[] {
  const items = pieces.filter((p) => p.str.trim() !== "");
  if (items.length === 0) return [];
  const heights = items
    .map((p) => p.h)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)]! : 10;
  const tol = Math.max(2, median * 0.5);
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const groups: PdfPiece[][] = [];
  let lineY = Number.POSITIVE_INFINITY;
  for (const it of items) {
    if (groups.length === 0 || Math.abs(it.y - lineY) > tol) {
      groups.push([it]);
      lineY = it.y;
    } else {
      groups[groups.length - 1]!.push(it);
    }
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let out = "";
    let prevEnd = 0;
    g.forEach((p, i) => {
      const gap = p.x - prevEnd;
      const needsSpace =
        i > 0 && gap > Math.max(1, median * 0.2) && !out.endsWith(" ") && !p.str.startsWith(" ");
      out += (needsSpace ? " " : "") + p.str;
      prevEnd = p.x + p.w;
    });
    return out.replace(/\s+/g, " ").trim();
  });
}

const MAX_PAGES = 30;

export async function pdfToLines(buf: ArrayBuffer): Promise<{ lines: string[]; chars: number }> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  // pdf.js takes ownership of the bytes it is given, so hand it a copy.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  const lines: string[] = [];
  let chars = 0;
  try {
    if (doc.numPages > MAX_PAGES)
      throw new Error(`The PDF has more than ${MAX_PAGES} pages. Split it before uploading.`);
    const pages = doc.numPages;
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pieces: PdfPiece[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        chars += item.str.trim().length;
        pieces.push({
          str: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          w: item.width,
          h: item.height,
        });
      }
      lines.push(...piecesToLines(pieces));
    }
  } finally {
    await doc.destroy();
  }
  return { lines, chars };
}
