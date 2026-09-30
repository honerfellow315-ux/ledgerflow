/**
 * Browser-side spreadsheet reading + the two parsers behind the Import dialog
 * (raw shift export, existing Excel "Salary Sheet"). Nothing here touches the
 * server; parsed rows are sent in chunks afterwards.
 *
 * exceljs is loaded on demand so it never weighs down the normal app bundle.
 */
import { round2 } from "./calc";
import type { CheckStatus, MasterRowInput, ShiftRowInput } from "./types";

export type Cell = string | number | null;
export type Matrix = Cell[][];

/* ------------------------------ cell helpers ------------------------------ */

export function toText(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return "";
  return typeof cell === "number" ? String(cell) : cell.trim();
}

export function toNumber(cell: Cell | undefined): number {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : 0;
  if (typeof cell !== "string") return 0;
  const t = cell.trim();
  if (!t) return 0;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[£,\s()-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd (UK-style day first, like the exports). */
function parseDateText(t: string): string {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }
  return "";
}

/** Excel serial date (days since 1899-12-30) -> yyyy-mm-dd. */
function serialToIso(n: number): string {
  if (n < 20000 || n > 80000) return "";
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function toIsoDate(cell: Cell | undefined): string {
  if (typeof cell === "number") return serialToIso(cell);
  return typeof cell === "string" ? parseDateText(cell.trim()) : "";
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+/-]+/g, " ")
    .trim();

/* ------------------------------ file reading ------------------------------ */

function parseCsv(text: string): Matrix {
  const rows: Matrix = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  const pushField = () => {
    row.push(field === "" ? null : field);
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") pushField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushField();
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    pushField();
    rows.push(row);
  }
  return rows;
}

// exceljs cell value -> plain Cell (dates -> yyyy-mm-dd, formulas -> cached result).
// Quirk: exceljs omits a formula's cached `result` when it is 0, so such cells
// read as null. Harmless for inputs (null is treated as 0 everywhere) — it only
// means a line whose Excel "Outstanding" is exactly 0 is skipped by the
// cross-check.
function plain(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) {
    // time-only cells come back as 1899-12-30; we never need them
    if (v.getUTCFullYear() < 1950) return null;
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return plain(o["result"]);
    if (Array.isArray(o["richText"])) {
      return (o["richText"] as { text?: string }[]).map((t) => t.text ?? "").join("");
    }
    if (typeof o["text"] === "string") return o["text"];
    if ("error" in o) return null;
  }
  return null;
}

export interface SheetMatrix {
  name: string;
  matrix: Matrix;
}

export async function readFileToSheets(file: File): Promise<{ sheets: SheetMatrix[] }> {
  if (/\.csv$/i.test(file.name)) {
    return { sheets: [{ name: file.name, matrix: parseCsv(await file.text()) }] };
  }
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error(
      "Please choose an .xlsx or .csv file (older .xls files need re-saving as .xlsx).",
    );
  }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sheets: SheetMatrix[] = [];
  wb.eachSheet((ws) => {
    const matrix: Matrix = [];
    const cols = ws.columnCount;
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const cells: Cell[] = [];
      for (let c = 1; c <= cols; c++) cells.push(plain(row.getCell(c).value));
      matrix[r - 1] = cells;
    });
    // eachRow skips rows beyond the last used one but leaves holes before it
    for (let i = 0; i < matrix.length; i++) if (!matrix[i]) matrix[i] = [];
    sheets.push({ name: ws.name, matrix });
  });
  return { sheets };
}

/* ------------------------------ generic table ------------------------------ */

export interface TableParse {
  headers: string[];
  rows: Cell[][];
}

const isEmptyRow = (r: Cell[]) => r.every((c) => toText(c) === "");

/** First row with at least two text cells (within the first 15) is the header. */
export function parseTable(matrix: Matrix): TableParse {
  let h = -1;
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const texts = (matrix[i] ?? []).filter((c) => typeof c === "string" && c.trim() !== "");
    if (texts.length >= 2) {
      h = i;
      break;
    }
  }
  if (h < 0) return { headers: [], rows: [] };
  const headers = (matrix[h] ?? []).map((c) => toText(c));
  const rows = matrix.slice(h + 1).filter((r) => !isEmptyRow(r));
  return { headers, rows };
}

/* ------------------------------ 1) shift export ------------------------------ */

export interface ShiftParse {
  rows: ShiftRowInput[];
  warnings: string[];
  totals: { hours: number; amount: number };
  /** yyyy-mm -> number of shifts dated in that month */
  months: Record<string, number>;
  /** rows that had data but no employee */
  skipped: number;
}

const SHIFT_COLS = {
  employeeId: ["employee id"],
  employeeName: ["employee name"],
  ni: ["ni number", "ni", "national insurance"],
  date: ["date"],
  clientName: ["client name"],
  siteName: ["site name"],
  hours: ["hours"],
  rate: ["guard rate"],
  amount: ["amount"],
  expenses: ["payable expenses"],
  penalty: ["penalty"],
  accountDetail: ["payment details"],
  tag: ["guard tags"],
} as const;

function findHeaderRow(matrix: Matrix, needles: string[]): number {
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const cells = (matrix[i] ?? []).map((c) => norm(toText(c)));
    if (needles.every((n) => cells.includes(n))) return i;
  }
  return -1;
}

export function parseShiftExport(matrix: Matrix): ShiftParse {
  const empty: ShiftParse = {
    rows: [],
    warnings: [],
    totals: { hours: 0, amount: 0 },
    months: {},
    skipped: 0,
  };
  const h = findHeaderRow(matrix, ["employee id", "hours"]);
  if (h < 0) {
    return {
      ...empty,
      warnings: ["This doesn't look like a shift export — no EMPLOYEE ID / HOURS columns found."],
    };
  }
  const header = (matrix[h] ?? []).map((c) => norm(toText(c)));
  const col = (names: readonly string[]) => header.findIndex((x) => names.includes(x));
  const idx = {
    employeeId: col(SHIFT_COLS.employeeId),
    employeeName: col(SHIFT_COLS.employeeName),
    ni: col(SHIFT_COLS.ni),
    date: col(SHIFT_COLS.date),
    clientName: col(SHIFT_COLS.clientName),
    siteName: col(SHIFT_COLS.siteName),
    hours: col(SHIFT_COLS.hours),
    rate: col(SHIFT_COLS.rate),
    amount: col(SHIFT_COLS.amount),
    expenses: col(SHIFT_COLS.expenses),
    penalty: col(SHIFT_COLS.penalty),
    accountDetail: col(SHIFT_COLS.accountDetail),
    tag: col(SHIFT_COLS.tag),
  };
  const warnings: string[] = [];
  if (idx.amount < 0 && idx.rate < 0) {
    warnings.push("No AMOUNT or GUARD RATE column found — amounts can't be worked out.");
  }
  const get = (r: Cell[], i: number): Cell => (i >= 0 ? (r[i] ?? null) : null);

  const rows: ShiftRowInput[] = [];
  const months: Record<string, number> = {};
  const seen = new Map<string, number>();
  let skipped = 0;
  let hours = 0;
  let amount = 0;
  let noDate = 0;

  for (const r of matrix.slice(h + 1)) {
    if (isEmptyRow(r)) continue;
    const employeeId = toText(get(r, idx.employeeId)).replace(/\.0+$/, "");
    const employeeName = toText(get(r, idx.employeeName));
    if (!employeeId && !employeeName) {
      skipped++;
      continue;
    }
    const h2 = round2(toNumber(get(r, idx.hours)));
    const rate = round2(toNumber(get(r, idx.rate)));
    const amountCell = get(r, idx.amount);
    const amt = round2(
      typeof amountCell === "number" || toText(amountCell) !== ""
        ? toNumber(amountCell)
        : h2 * rate,
    );
    const date = toIsoDate(get(r, idx.date));
    if (date) {
      const m = date.slice(0, 7);
      months[m] = (months[m] ?? 0) + 1;
    } else noDate++;

    const row: ShiftRowInput = {
      employeeId,
      employeeName,
      // sheet exports prefix some text cells with an apostrophe
      ni: toText(get(r, idx.ni)).replace(/^'/, ""),
      date,
      clientName: toText(get(r, idx.clientName)),
      siteName: toText(get(r, idx.siteName)),
      hours: h2,
      rate,
      amount: amt,
      expenses: round2(toNumber(get(r, idx.expenses))),
      penalty: round2(toNumber(get(r, idx.penalty))),
      accountDetail: toText(get(r, idx.accountDetail)).replace(/^'/, ""),
      tag: toText(get(r, idx.tag)),
    };
    rows.push(row);
    hours += h2;
    amount += amt;
    const key = [employeeId || employeeName, date, row.siteName, h2, amt].join("|");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  const dupes = [...seen.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
  if (dupes > 0) {
    warnings.push(
      `${dupes} shift${dupes === 1 ? "" : "s"} look like exact duplicates (same person, date, site, hours and amount). They are still counted — check the export if that's not right.`,
    );
  }
  if (noDate > 0) warnings.push(`${noDate} shifts have no readable date.`);

  return {
    rows,
    warnings,
    totals: { hours: round2(hours), amount: round2(amount) },
    months,
    skipped,
  };
}

/* ------------------------------ 2) master sheet ------------------------------ */

export interface MasterParseRow extends MasterRowInput {
  /** The Outstanding the Excel file itself showed (for the cross-check). */
  fileOutstanding: number | null;
}

export interface MasterParse {
  rows: MasterParseRow[];
  warnings: string[];
  /** payroll company names found in the header */
  payrollCompanies: string[];
  /** how many P1..Pn cash-payment columns the file has */
  maxPayments: number;
}

const asCheck = (t: string): CheckStatus => {
  const v = t.trim().toLowerCase();
  return v === "verified" ? "Verified" : v === "reviewed" ? "Reviewed" : "";
};

export function parseMasterSheet(matrix: Matrix): MasterParse {
  const h = findHeaderRow(matrix, ["total amount", "outstanding", "name"]);
  if (h < 0) {
    return {
      rows: [],
      payrollCompanies: [],
      maxPayments: 0,
      warnings: [
        "This doesn't look like your Salary Sheet — no Name / Total Amount / Outstanding headers found.",
      ],
    };
  }
  const header = (matrix[h] ?? []).map((c) => norm(toText(c)));
  const exact = (name: string) => header.indexOf(name);
  const all = (name: string) => header.flatMap((x, i) => (x === name ? [i] : []));

  const amountCols = all("amount");
  const hoursCols = all("hours");
  const iRssAmount = amountCols[0] ?? -1;
  const iEssAmount = amountCols[1] ?? -1;
  const iRssHours = hoursCols[0] ?? -1;
  const iEssHours = hoursCols[1] ?? -1;
  const iCheck = exact("check status");
  const iTax = exact("tax deduction");
  const iTotalPayroll = exact("total payroll");
  const iCashTotal = exact("total cash paid");

  const warnings: string[] = [];
  if (iRssAmount < 0 || iEssAmount < 0)
    warnings.push("Couldn't find both RSS and ESS Amount columns.");
  if (iCheck < 0 || iTax < 0)
    warnings.push("Couldn't find the payroll columns (between Check status and Tax Deduction).");

  // Payroll companies = every column between "Check status" and "Tax Deduction"
  const companyCols: { i: number; name: string }[] = [];
  const rawHeader = (matrix[h] ?? []).map((c) => toText(c));
  if (iCheck >= 0 && iTax > iCheck) {
    for (let i = iCheck + 1; i < iTax; i++) {
      const name = rawHeader[i] ?? "";
      if (name) companyCols.push({ i, name });
    }
  }
  // Cash payments = P1, P2, ... between "Total Payroll" and "Total Cash Paid"
  const payCols: number[] = [];
  header.forEach((x, i) => {
    if (
      /^p\d+$/.test(x) &&
      (iTotalPayroll < 0 || i > iTotalPayroll) &&
      (iCashTotal < 0 || i < iCashTotal)
    ) {
      payCols.push(i);
    }
  });

  const idx = {
    rssId: exact("rss id"),
    essId: exact("ess id"),
    ni: exact("ni"),
    tag: exact("tag"),
    name: exact("name"),
    carry: header.findIndex((x) => x.includes("overpaid")),
    deduction: exact("deduction"),
    outstanding: exact("outstanding"),
    account: exact("account detail"),
    flag: exact("client"),
    area: exact("area"),
  };
  const get = (r: Cell[], i: number): Cell => (i >= 0 ? (r[i] ?? null) : null);
  const idText = (c: Cell) => {
    const t = toText(c).replace(/\.0+$/, "");
    return t === "0" ? "" : t;
  };

  const rows: MasterParseRow[] = [];
  for (const r of matrix.slice(h + 1)) {
    if (isEmptyRow(r)) continue;
    const name = toText(get(r, idx.name));
    if (!name) continue;
    const payroll: Record<string, number> = {};
    for (const c of companyCols) {
      const v = toNumber(r[c.i] ?? null);
      if (v !== 0) payroll[c.name] = v;
    }
    const outCell = get(r, idx.outstanding);
    rows.push({
      rssId: idText(get(r, idx.rssId)),
      essId: idText(get(r, idx.essId)),
      ni: toText(get(r, idx.ni)),
      tag: toText(get(r, idx.tag)),
      name,
      rssAmount: toNumber(get(r, iRssAmount)),
      rssHours: toNumber(get(r, iRssHours)),
      essAmount: toNumber(get(r, iEssAmount)),
      essHours: toNumber(get(r, iEssHours)),
      carryForward: toNumber(get(r, idx.carry)),
      checkStatus: asCheck(toText(get(r, iCheck))),
      payroll,
      taxDeduction: toNumber(get(r, iTax)),
      payments: payCols.map((i) => toNumber(r[i] ?? null)),
      deduction: toNumber(get(r, idx.deduction)),
      accountDetail: toText(get(r, idx.account)),
      flag: toText(get(r, idx.flag)),
      area: toText(get(r, idx.area)),
      fileOutstanding: typeof outCell === "number" ? outCell : null,
    });
  }
  if (rows.length === 0) warnings.push("No staff rows found under the headers.");
  return {
    rows,
    warnings,
    payrollCompanies: companyCols.map((c) => c.name),
    maxPayments: payCols.length,
  };
}
