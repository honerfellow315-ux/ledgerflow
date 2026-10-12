/**
 * Word (.docx) -> the same grid the Excel reader makes (browser only).
 * A .docx is a zip file; the text of the page is in word/document.xml. Paragraphs above the
 * table give the name and NI number, the table gives the shifts, paragraphs below give the
 * total. A document with no table falls back to reading its lines, like a typed PDF.
 */
import { linesToMatrix, topRows, totalRows } from "./textRows";
import type { TsCell, TsMatrix } from "./parseMatrix";

export type WordBlock = { kind: "p"; text: string } | { kind: "table"; rows: string[][] };

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Child elements, by index (a NodeList has no forEach in every environment). */
function kids(node: Node): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes.item(i);
    if (c && c.nodeType === 1) out.push(c as Element);
  }
  return out;
}

function textOf(node: Node): string {
  let out = "";
  for (const el of kids(node)) {
    const name = el.localName;
    if (name === "t") out += el.textContent ?? "";
    else if (name === "tab" || name === "br" || name === "cr") out += " ";
    else out += textOf(el);
  }
  return out;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Pure: document.xml -> paragraphs and tables in reading order. */
export function wordXmlToBlocks(xml: string, parse: (xml: string) => Document): WordBlock[] {
  const doc = parse(xml);
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) return [];
  const blocks: WordBlock[] = [];
  for (const el of kids(body)) {
    if (el.localName === "p") {
      const text = clean(textOf(el));
      if (text) blocks.push({ kind: "p", text });
    } else if (el.localName === "tbl") {
      const rows: string[][] = [];
      for (const r of kids(el)) {
        if (r.localName !== "tr") continue;
        rows.push(
          kids(r)
            .filter((c) => c.localName === "tc")
            .map((c) => clean(textOf(c))),
        );
      }
      blocks.push({ kind: "table", rows });
    }
  }
  return blocks;
}

const isHeaderRow = (cells: string[]) => {
  const t = cells.join(" ");
  return /\bdate\b/i.test(t) && /\bstart\b/i.test(t) && /\b(?:end|finish)\b/i.test(t);
};

const asCells = (cells: string[]): TsCell[] => cells.map((c) => (c === "" ? null : c));

/** Pure: blocks -> grid, or null when there is no timesheet table. */
export function blocksToMatrix(blocks: WordBlock[]): TsMatrix | null {
  const main = blocks.findIndex((b) => b.kind === "table" && b.rows.some(isHeaderRow));
  if (main < 0) {
    const lines = blocks.flatMap((b) =>
      b.kind === "p" ? [b.text] : b.rows.map((r) => r.filter(Boolean).join(" ")),
    );
    return linesToMatrix(lines);
  }
  const before = blocks.slice(0, main);
  const after = blocks.slice(main + 1);
  const out: TsMatrix = [];
  out.push(
    ...topRows(
      before.flatMap((b) =>
        b.kind === "p" ? [b.text] : b.rows.map((r) => r.filter(Boolean).join(" ")),
      ),
    ),
  );
  for (const b of before) {
    // A small table above the main one (Name | value, NI | value): keep its cells as they are.
    if (b.kind === "table") for (const r of b.rows) out.push(asCells(r), []);
  }
  const t = blocks[main];
  if (t && t.kind === "table") for (const r of t.rows) out.push(asCells(r));
  out.push(...totalRows(after.flatMap((b) => (b.kind === "p" ? [b.text] : []))));
  return out;
}

export async function wordToMatrix(buf: ArrayBuffer): Promise<TsMatrix | null> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("not a Word document");
  const xml = await file.async("string");
  const blocks = wordXmlToBlocks(xml, (x) => new DOMParser().parseFromString(x, "application/xml"));
  return blocksToMatrix(blocks);
}
