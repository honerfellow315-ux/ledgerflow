import { parseBankMatrix, parseUkDate, parseMoney, type Matrix, type Cell } from "./parse";
import { wordXmlToBlocks } from "../timesheets/readWord";
import type { PdfPiece } from "../timesheets/readPdf";

/** Retain the horizontal table cells. Flattening a bank PDF to plain text loses empty debit/credit cells. */
export function bankPageToMatrix(pieces: PdfPiece[]): Matrix {
  // Some accessible bank PDFs repeat every cell label at 0.05pt. These are
  // metadata, not visible transactions; including them duplicates table headers.
  const groups: PdfPiece[][] = [];
  for (const item of [...pieces]
    .filter((p) => p.str.trim() && p.h >= 1)
    .sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = groups.at(-1);
    if (!last || Math.abs(item.y - last[0]!.y) > 2) groups.push([item]);
    else last.push(item);
  }
  const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  let columns: { x: number; end: number; text: string }[] | null = null;
  const body: { y: number; row: Cell[] }[] = [];
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
    if (!parseBankMatrix([candidate]).problems.length) {
      if (columns && columns.map((c) => key(c.text)).join("|") !== candidate.map(key).join("|"))
        throw new Error("The PDF changes its bank columns. Upload CSV/Excel instead.");
      columns = cells;
      continue;
    }
    if (!columns) continue;
    if (
      /^(?:\(?(?:continued|end of)|lloyds bank plc|transaction types|page \d)/i.test(
        cells[0]?.text ?? "",
      )
    )
      break;
    const row: Cell[] = Array.from({ length: columns.length }, () => null);
    for (const p of group) {
      let col = 0;
      for (let i = 1; i < columns.length; i++) if (p.x >= columns[i]!.x - 4) col = i;
      // Amounts are right aligned. Use their right edge rather than their left
      // edge, which moves into an adjacent column when an amount is large.
      const amount = parseMoney(p.str);
      if (amount !== null && Number.isFinite(amount)) {
        const numeric = columns
          .map((c, i) => ({ c, i }))
          .filter(({ c }) =>
            /money|credit|debit|paid|amount|balance|value|deposit|withdrawal/i.test(c.text),
          );
        const nearest = numeric.sort(
          (a, b) => Math.abs(a.c.end - (p.x + p.w)) - Math.abs(b.c.end - (p.x + p.w)),
        )[0];
        if (nearest && Math.abs(nearest.c.end - (p.x + p.w)) < 16) col = nearest.i;
      }
      row[col] = `${row[col] ?? ""} ${p.str}`.trim();
    }
    body.push({ y: group[0]!.y, row });
  }
  if (!columns)
    throw new Error(
      "No supported bank table was found on this PDF page. Upload a typed bank table or CSV/Excel.",
    );
  const dateCol = columns.findIndex((c) =>
    /^(date|transactiondate|postingdate|bookingdate)$/.test(key(c.text)),
  );
  const moneyCols = columns.flatMap((c, i) =>
    /money|credit|debit|paid|amount|value|deposit|withdrawal/i.test(c.text) ? [i] : [],
  );
  const textCols = columns.flatMap((c, i) =>
    /description|details|reference|narrative|memo/i.test(c.text) ? [i] : [],
  );
  // Retain any transaction with money even if its date is unreadable; the
  // normal validator must reject it rather than silently dropping payment data.
  const transactions = body.filter(
    ({ row }) => parseUkDate(row[dateCol] ?? null) || moneyCols.some((i) => row[i] !== null),
  );
  const fragments = new Map(
    transactions.map((t) => [
      t,
      new Map(
        textCols.map((i) => [
          i,
          t.row[i] ? [{ y: t.y, text: String(t.row[i]) }] : ([] as { y: number; text: string }[]),
        ]),
      ),
    ]),
  );
  for (const line of body) {
    if (transactions.includes(line)) continue;
    const text = textCols
      .map((i) => String(line.row[i] ?? ""))
      .join(" ")
      .trim();
    if (!text || line.row[dateCol]) continue;
    const nearest = [...transactions].sort(
      (a, b) => Math.abs(a.y - line.y) - Math.abs(b.y - line.y),
    )[0];
    if (!nearest || Math.abs(nearest.y - line.y) > 18) continue;
    for (const i of textCols)
      if (line.row[i])
        fragments
          .get(nearest)
          ?.get(i)
          ?.push({ y: line.y, text: String(line.row[i]) });
  }
  for (const t of transactions)
    for (const i of textCols) {
      t.row[i] =
        fragments
          .get(t)
          ?.get(i)
          ?.sort((a, b) => b.y - a.y)
          .map((f) => f.text)
          .join(" ") || null;
    }
  return [columns.map((c) => c.text), ...transactions.map((t) => t.row)];
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
          `Page ${pageNo} is a scan or has no text. Use the Read photo / scanned PDF with AI button. Nothing was uploaded.`,
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
