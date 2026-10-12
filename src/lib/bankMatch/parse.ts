/**
 * Reading a UK bank statement (CSV or Excel). Runs in the browser; only the small, already
 * read result goes to the server.
 *
 * UK banks name their columns differently, so the header row is found by name, not by position:
 *   date            Date, Transaction Date, Posting Date ...
 *   money in        Credit Amount, Paid in, Money in, Credit ...
 *   money out       Debit Amount, Paid out, Money out, Debit ...
 *   or one signed   Amount, Amount (GBP), Value  (positive = money in)
 *   bank text       Description, Details, Reference, Memo, Counter Party, Name, Type ... (all joined)
 * Only money IN is kept. Dates are read the UK way (day first). Nothing is guessed: if a row with
 * money has a date or amount that cannot be read, the WHOLE file is refused with the row number,
 * so a payment is never silently dropped.
 */
export type Cell = string | number | null;
export type Matrix = Cell[][];

export interface ParsedLine {
  lineNo: number;
  date: string;
  description: string;
  amount: number;
}

export interface ParsedStatement {
  fileName: string;
  fileHash: string;
  lines: ParsedLine[];
  skippedOut: number;
  problems: string[];
}

export const MAX_BANK_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_BANK_LINES = 5000;

const key = (v: Cell): string =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const DATE_H = new Set([
  "date",
  "transactiondate",
  "postingdate",
  "bookingdate",
  "processeddate",
  "datetime",
]);
const IN_H = new Set([
  "creditamount",
  "credit",
  "paidin",
  "moneyin",
  "paymentsin",
  "deposits",
  "deposit",
  "creditsgbp",
  "amountcredit",
]);
const OUT_H = new Set([
  "debitamount",
  "debit",
  "paidout",
  "moneyout",
  "paymentsout",
  "withdrawals",
  "withdrawal",
  "debitsgbp",
  "amountdebit",
]);
const AMOUNT_H = new Set(["amount", "amountgbp", "value", "transactionamount", "amountinpounds"]);
const TEXT_H = new Set([
  "description",
  "transactiondescription",
  "details",
  "narrative",
  "memo",
  "reference",
  "paymentreference",
  "counterparty",
  "name",
  "payee",
  "payer",
  "merchant",
  "notes",
  "transactiontype",
  "type",
  "fromto",
]);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function realDay(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** UK dates (day first) and ISO dates. Returns yyyy-mm-dd or null. */
export function parseUkDate(v: Cell): string | null {
  if (v === null) return null;
  if (typeof v === "number") return null; // a bare number is never a date here (Excel dates arrive as text)
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) return realDay(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T,].*)?$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return realDay(y, +m[2]!, +m[1]!);
  }
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -,]+(\d{2}|\d{4})(?:[ T,].*)?$/.exec(s);
  if (m) {
    const mon = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return mon > 0 ? realDay(y, mon, +m[1]!) : null;
  }
  return null;
}

/** "£1,234.56", "1234.56", "(50.00)", "-50" -> number. Blank -> null. Unreadable -> NaN. */
export function parseMoney(v: Cell): number | null {
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : Number.NaN;
  let s = v.trim();
  if (s === "") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/\bDR\b$/i.test(s)) neg = true;
  s = s.replace(/\b(CR|DR)\b$/i, "").replace(/[£,\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  const n = Math.round(Number(s) * 100) / 100;
  return neg ? -n : n;
}

interface Columns {
  date: number;
  inCol: number;
  outCol: number;
  amount: number;
  text: number[];
}

function findHeader(m: Matrix): { row: number; cols: Columns } | null {
  for (let r = 0; r < Math.min(m.length, 40); r++) {
    const cells = (m[r] ?? []).map(key);
    const date = cells.findIndex((c) => DATE_H.has(c));
    if (date < 0) continue;
    const inCol = cells.findIndex((c) => IN_H.has(c));
    const outCol = cells.findIndex((c) => OUT_H.has(c));
    const amount = cells.findIndex((c) => AMOUNT_H.has(c));
    if (inCol < 0 && amount < 0) continue;
    const text = cells.flatMap((c, i) => (TEXT_H.has(c) ? [i] : []));
    if (text.length === 0) continue;
    return { row: r, cols: { date, inCol, outCol, amount, text } };
  }
  return null;
}

export function parseBankMatrix(m: Matrix): {
  lines: ParsedLine[];
  skippedOut: number;
  problems: string[];
} {
  const head = findHeader(m);
  if (!head) {
    return {
      lines: [],
      skippedOut: 0,
      problems: [
        "No bank table found. The statement needs a header row with a Date column, a description (or reference) column, and Paid in / Credit (or a single Amount column).",
      ],
    };
  }
  const { cols } = head;
  const lines: ParsedLine[] = [];
  const problems: string[] = [];
  let skippedOut = 0;
  for (let r = head.row + 1; r < m.length; r++) {
    const row = m[r] ?? [];
    if (row.every((c) => c === null || String(c).trim() === "")) continue;
    // Some statements (e.g. the ESS sheet) paste the header row again at every month.
    // A repeated header is not a payment, so it is skipped instead of refusing the file.
    if (DATE_H.has(key(row[cols.date] ?? null))) continue;
    const rowNo = r + 1;
    let credit: number | null = null;
    let debit: number | null = null;
    if (cols.inCol >= 0) credit = parseMoney(row[cols.inCol] ?? null);
    if (cols.outCol >= 0) debit = parseMoney(row[cols.outCol] ?? null);
    let signed: number | null = null;
    if (cols.amount >= 0 && cols.inCol < 0) signed = parseMoney(row[cols.amount] ?? null);

    const moneyCells = [credit, debit, signed];
    if (moneyCells.some((x) => x !== null && Number.isNaN(x))) {
      problems.push(`Row ${rowNo}: the amount could not be read.`);
      continue;
    }
    const isIn = (credit ?? 0) > 0 || (signed ?? 0) > 0;
    const isOut = (debit ?? 0) !== 0 || (credit ?? 0) < 0 || (signed ?? 0) < 0;
    const amount = isIn ? (credit && credit > 0 ? credit : signed!) : 0;
    if (!isIn) {
      if (isOut) skippedOut++;
      continue; // no money in this row (balance rows, headings, zero lines)
    }
    const date = parseUkDate(row[cols.date] ?? null);
    if (!date) {
      problems.push(
        `Row ${rowNo}: the date "${String(row[cols.date] ?? "").trim() || "(empty)"}" could not be read. Dates must be day first, like 25/10/2026.`,
      );
      continue;
    }
    const seen = new Set<string>();
    const description = cols.text
      .map((i) => String(row[i] ?? "").trim())
      .filter((t) => t !== "" && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 300);
    lines.push({ lineNo: rowNo, date, description: description || "(no description)", amount });
  }
  if (lines.length > MAX_BANK_LINES) {
    problems.push(
      `This file has more than ${MAX_BANK_LINES} payments in. Split it by month and upload each part.`,
    );
  }
  return { lines, skippedOut, problems };
}

/* ------------------------------ files ------------------------------ */

function csvToMatrix(text: string): Matrix {
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  const delim =
    count("\t") > count(",") && count("\t") > count(";")
      ? "\t"
      : count(";") > count(",")
        ? ";"
        : ",";
  const rows: Matrix = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  const push = () => {
    row.push(field === "" ? null : field);
    field = "";
  };
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) push();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      push();
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    push();
    rows.push(row);
  }
  return rows;
}

function excelCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return excelCell(o["result"]);
    if (Array.isArray(o["richText"]))
      return (o["richText"] as { text?: string }[]).map((t) => t.text ?? "").join("");
    if (typeof o["text"] === "string") return o["text"];
  }
  return null;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function parseBankFile(file: File): Promise<ParsedStatement> {
  const out: ParsedStatement = {
    fileName: file.name,
    fileHash: "",
    lines: [],
    skippedOut: 0,
    problems: [],
  };
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.size === 0) return { ...out, problems: ["The file is empty."] };
  if (file.size > MAX_BANK_FILE_BYTES)
    return { ...out, problems: ["The file is bigger than 5 MB."] };
  const buf = await file.arrayBuffer();
  out.fileHash = await sha256Hex(buf);

  let matrix: Matrix;
  if (ext === "csv") {
    matrix = csvToMatrix(new TextDecoder("utf-8").decode(buf));
  } else if (ext === "xlsx") {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      if (!ws) return { ...out, problems: ["The Excel file has no sheets."] };
      matrix = [];
      const cols = ws.columnCount;
      ws.eachRow({ includeEmpty: true }, (row, r) => {
        const cells: Cell[] = [];
        for (let c = 1; c <= cols; c++) cells.push(excelCell(row.getCell(c).value));
        matrix[r - 1] = cells;
      });
      for (let i = 0; i < matrix.length; i++) if (!matrix[i]) matrix[i] = [];
    } catch {
      return {
        ...out,
        problems: [
          "This file could not be opened. Is it a damaged or password protected Excel file?",
        ],
      };
    }
  } else if (ext === "pdf" || ext === "docx") {
    try {
      const { bankPdfToMatrix, bankWordToMatrix } = await import("./readDocuments");
      matrix = ext === "pdf" ? await bankPdfToMatrix(buf) : await bankWordToMatrix(buf);
    } catch (error) {
      return {
        ...out,
        problems: [
          error instanceof Error
            ? error.message
            : "The document could not be read. Use CSV/Excel instead.",
        ],
      };
    }
  } else if (["png", "jpg", "jpeg", "webp", "heic"].includes(ext)) {
    return {
      ...out,
      problems: [
        "Use the Read photo / scanned PDF with AI button for photos, or upload CSV, Excel, a typed PDF or Word table here.",
      ],
    };
  } else if (ext === "xls") {
    return {
      ...out,
      problems: ["Old .xls files are not supported. Open it in Excel and save it as .xlsx or CSV."],
    };
  } else {
    return {
      ...out,
      problems: [
        "This file type is not supported. Use CSV, Excel (.xlsx), a typed PDF or Word (.docx) table.",
      ],
    };
  }
  const parsed = parseBankMatrix(matrix);
  return { ...out, ...parsed };
}
