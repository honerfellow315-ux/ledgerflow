import { parseBankMatrix, type Matrix, type Cell } from "./parse";
import { wordXmlToBlocks } from "../timesheets/readWord";
import type { PdfPiece } from "../timesheets/readPdf";

/** Retain the horizontal table cells. Flattening a bank PDF to plain text loses empty debit/credit cells. */
export function bankPageToMatrix(pieces: PdfPiece[]): Matrix {
  const groups: PdfPiece[][] = [];
  for (const item of [...pieces]
    .filter((p) => p.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = groups.at(-1);
    if (!last || Math.abs(item.y - last[0]!.y) > 2) groups.push([item]);
    else last.push(item);
  }
  let anchors: number[] | null = null;
  let headers: string[] = [];
  const matrix: Matrix = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);
    const cells: { x: number; end: number; text: string }[] = [];
    for (const p of group) {
      const last = cells.at(-1);
      if (last && p.x - last.end < 10) {
        last.text += ` ${p.str.trim()}`;
        last.end = p.x + p.w;
      } else cells.push({ x: p.x, end: p.x + p.w, text: p.str.trim() });
    }
    const candidate = cells.map((c) => c.text);
    // Use the same header recognition as CSV/Excel, without inventing a bank layout.
    if (!parseBankMatrix([candidate]).problems.length) {
      anchors = cells.map((c) => c.x);
      headers = candidate;
      if (!matrix.length) matrix.push(headers);
      else if (matrix[0]!.join("|") !== headers.join("|"))
        throw new Error("The PDF changes its bank columns. Upload CSV/Excel instead.");
      continue;
    }
    if (!anchors) continue;
    const row: Cell[] = Array.from({ length: anchors.length }, () => null);
    for (const p of group) {
      let col = 0;
      for (let i = 1; i < anchors.length; i++) if (p.x >= anchors[i]! - 4) col = i;
      row[col] = `${row[col] ?? ""} ${p.str}`.trim();
    }
    matrix.push(row);
  }
  if (!anchors)
    throw new Error(
      "No supported bank table was found on this PDF page. Use a typed table with Date, Description and Paid in/Credit or Amount, or upload CSV/Excel.",
    );
  return matrix;
}

export async function bankPdfToMatrix(buf: ArrayBuffer): Promise<Matrix> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  const matrix: Matrix = [];
  try {
    if (doc.numPages > 30)
      throw new Error("The PDF has more than 30 pages. Split it before uploading.");
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const pieces: PdfPiece[] = [];
      for (const item of content.items)
        if ("str" in item)
          pieces.push({
            str: item.str,
            x: item.transform[4] ?? 0,
            y: item.transform[5] ?? 0,
            w: item.width,
            h: item.height,
          });
      if (!pieces.some((p) => p.str.trim()))
        throw new Error(
          `Page ${pageNo} is a scan or has no text. Photo/scanned reading needs the later AI step. Nothing was uploaded.`,
        );
      const pageMatrix = bankPageToMatrix(pieces);
      if (matrix.length && matrix[0]!.join("|") !== pageMatrix[0]!.join("|"))
        throw new Error("Bank columns change between PDF pages. Use CSV/Excel instead.");
      matrix.push(...(matrix.length ? pageMatrix.slice(1) : pageMatrix));
    }
    return matrix;
  } finally {
    await doc.destroy();
  }
}

export async function bankWordToMatrix(buf: ArrayBuffer): Promise<Matrix> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("This is not a Word (.docx) document.");
  const blocks = wordXmlToBlocks(await file.async("string"), (xml) =>
    new DOMParser().parseFromString(xml, "application/xml"),
  );
  const tables = blocks.filter(
    (b) => b.kind === "table" && !parseBankMatrix(b.rows).problems.length,
  );
  if (tables.length !== 1 || tables[0]?.kind !== "table")
    throw new Error(
      "Use a Word document with one bank table containing Date, Description and Paid in/Credit or Amount. Multiple or unreadable tables are not imported.",
    );
  return tables[0].rows;
}
