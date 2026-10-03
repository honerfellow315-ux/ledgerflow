/**
 * Payroll sheet import ("All Payroll Format" Excel -> one payroll company x one month).
 *
 * Browser side: parsePayrollSheet() reads the sample layout
 *   Employee Name | Units (Hours) | Bank Holiday Hours | Holiday Entitlement | Comment | Rate | ... personal / banking / contract / SIA columns
 * and returns one row per person. Total Hours, Amount and Age columns are ignored:
 * the app always recomputes them (Total = Units + Bank Holiday, Amount = Rate x Total).
 *
 * Template filler rows ("Employee Name", "NI Number", ...) are skipped, exactly like the
 * Employee-details import does. Shared by the browser and the server (types + cleanDetail).
 *
 * How the ESS sheet really works (and what this parser does about it):
 *  - A person can span several rows: the extra rows have NO name (e.g. 14.00/h on the name row,
 *    70.5 h at 12.71 on the row below). Nameless rows are merged into the row above them.
 *  - The same person (NI) can be listed twice (an old P45 row + the active row). The row that
 *    carries pay is used, not blindly the first one.
 *  - Guards on a fixed monthly pay have Rate 0 and a typed Amount: that Amount is kept as a fixed amount.
 *  - Holiday Entitlement hours are paid at 12.71 (Amount = Rate x Hours + Holiday x 12.71).
 *  - After merging, the app's amount is compared with the file's Amount column and any
 *    difference is reported (mismatches) so nothing is silently different from the sheet.
 */
import { toNumber, toText, type Cell, type Matrix } from "./excel";
import {
  DATE_FIELDS,
  HEADER_TO_FIELD,
  PLACEHOLDERS,
  readDate,
  squash,
  validIso,
} from "./detailsImport";
import { normName, normNi, round2 } from "./calc";
import { lineTotals } from "./sheetCalc";
import {
  CONTRACT_STATUSES,
  STAFF_DETAIL_FIELDS,
  type StaffDetailField,
  type StaffDetails,
} from "./types";

/** The sheet pays Holiday Entitlement hours at this flat rate (Amount = Rate x Hours + Holiday x 12.71). */
export const HOLIDAY_PAY_RATE = 12.71;

/* ------------------------------ shared types ------------------------------ */

/** One person's line from the file. `null` = that cell was empty in the file. */
export interface PayrollImportRow extends StaffDetails {
  name: string;
  ni: string;
  unitsHours: number | null;
  bankHolidayHours: number | null;
  holidayEntitlement: number | null;
  comment: string;
  rate: number | null;
  /** The file's own Amount cell (only used for the fixed-pay rule and the cross-check). */
  amount: number | null;
  /** Fixed monthly pay (Rate 0 + typed Amount, or several rows at different rates). null = hourly. */
  fixedAmount: number | null;
  /** Rate the holiday entitlement hours are paid at (null = none to pay). */
  holidayRate: number | null;
}

export interface PayrollImportParse {
  rows: PayrollImportRow[];
  /** Template filler / nameless rows that were ignored. */
  skippedRows: number;
  /** Same person (NI, else name) listed again in the file — only one row is used (the one with pay). */
  duplicates: string[];
  /** Nameless rows (second rate / extra hours of the person above) that were merged into that person. */
  mergedRows: number;
  /** People whose amount in the app would differ from the file's Amount column ("Name: file X, app Y"). */
  mismatches: string[];
  /** Values that could not be read (bad date, negative hours ...), by column. */
  invalid: Record<string, number>;
  /** False when no header row with "Employee Name" + "Units (Hours)" was found. */
  found: boolean;
}

export type PayrollImportMatch = "matched" | "new" | "notFound" | "ambiguous" | "niConflict";
export type PayrollImportLineAction = "add" | "update" | "unchanged" | "skip" | "none";

export interface PayrollImportRowResult {
  name: string;
  match: PayrollImportMatch;
  line: PayrollImportLineAction;
  /** Detail fields on the staff record that get filled (counted, never shown). */
  fills: number;
  unitsHours: number;
  bankHolidayHours: number;
  totalHours: number;
  rate: number;
  amount: number;
}

export interface PayrollImportResult {
  rows: PayrollImportRowResult[];
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  /** Staff records created. */
  created: number;
  /** People who get empty detail fields filled / the number of fields. */
  filledStaff: number;
  filledFields: number;
  /** Rows (that will be written) that end up with rate 0. */
  noRate: number;
  /** Hours and amount of the lines that will be added / updated (compare with the Excel totals). */
  writtenHours: number;
  writtenAmount: number;
}

/* ------------------------------ detail cleaning ------------------------------ */

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The value a file cell may be written as, or "" when it is not usable. */
export function cleanDetail(field: StaffDetailField, raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (DATE_FIELDS.has(field)) return ISO_DATE.test(v) ? v : "";
  if (field === "contractStatus") return CONTRACT_STATUSES.find((c) => c === v) ?? "";
  return v;
}

/* ------------------------------ parser ------------------------------ */

type LineCol = "units" | "bankHoliday" | "entitlement" | "comment" | "rate" | "amount";

const LINE_HEADERS: Record<string, LineCol> = {
  unitshours: "units",
  units: "units",
  workinghours: "units",
  hours: "units",
  bankholidayhours: "bankHoliday",
  bankholiday: "bankHoliday",
  bh: "bankHoliday",
  holidayentitlement: "entitlement",
  comment: "comment",
  comments: "comment",
  rate: "rate",
  hourlyrate: "rate",
  payrate: "rate",
  amount: "amount",
};

const NUMBER_LABEL: Record<"units" | "bankHoliday" | "entitlement" | "rate" | "amount", string> = {
  units: "Units (Hours)",
  bankHoliday: "Bank Holiday Hours",
  entitlement: "Holiday Entitlement",
  rate: "Rate",
  amount: "Amount",
};

const NAME_HEADERS = new Set(["employeename", "name", "staffname", "employee"]);

type Target = StaffDetailField | "name" | "ni" | LineCol;

const MAX_HEADER_SCAN = 40;

function headerMap(row: readonly Cell[] | undefined): Map<number, Target> {
  const found = new Map<number, Target>();
  (row ?? []).forEach((cell, c) => {
    const key = squash(toText(cell));
    if (!key) return;
    if (NAME_HEADERS.has(key)) found.set(c, "name");
    else if (LINE_HEADERS[key]) found.set(c, LINE_HEADERS[key]!);
    else if (HEADER_TO_FIELD[key]) found.set(c, HEADER_TO_FIELD[key]!);
  });
  return found;
}

/* ------------------------- merging rows of one person ------------------------- */

type LineValues = Pick<
  PayrollImportRow,
  | "unitsHours"
  | "bankHolidayHours"
  | "holidayEntitlement"
  | "comment"
  | "rate"
  | "amount"
  | "fixedAmount"
  | "holidayRate"
>;

const num = (v: number | null | undefined): number => (typeof v === "number" ? v : 0);
const sumOrNull = (vals: (number | null)[]): number | null =>
  vals.some((v) => v !== null) ? round2(vals.reduce<number>((a, v) => a + num(v), 0)) : null;

/** Hours + holiday + fixed pay: does this line pay anything? */
const hasPay = (l: LineValues) =>
  num(l.unitsHours) > 0 ||
  num(l.bankHolidayHours) > 0 ||
  num(l.holidayEntitlement) > 0 ||
  num(l.fixedAmount) > 0;

/**
 * One person's rows (the named row + any nameless rows under it) -> ONE line.
 *  - hours / holiday are added up;
 *  - the rate is the rate of the row(s) that carry the hours (the name row may hold an unused rate);
 *  - hours at two different rates -> a fixed amount = the sum of each row's rate x hours;
 *  - Rate 0 / empty + no hours + a typed Amount -> that Amount is the fixed monthly pay;
 *  - holiday entitlement is paid at HOLIDAY_PAY_RATE.
 */
function combineParts(parts: readonly LineValues[]): LineValues {
  const units = sumOrNull(parts.map((p) => p.unitsHours));
  const bh = sumOrNull(parts.map((p) => p.bankHolidayHours));
  const entitlement = sumOrNull(parts.map((p) => p.holidayEntitlement));
  const comment = parts.map((p) => p.comment).find((c) => c) ?? "";
  const fileAmount = sumOrNull(parts.map((p) => p.amount));

  const workParts = parts.filter((p) => num(p.unitsHours) + num(p.bankHolidayHours) > 0);
  const workRates = [...new Set(workParts.map((p) => p.rate ?? 0))];
  const firstRate = parts.find((p) => p.rate !== null)?.rate ?? null;
  const totalHours = round2(num(units) + num(bh));
  const holidayRate = num(entitlement) > 0 ? HOLIDAY_PAY_RATE : null;

  let rate: number | null = workParts.length > 0 ? (workParts[0]!.rate ?? firstRate) : firstRate;
  let fixedAmount: number | null = null;

  if (workRates.length > 1) {
    // hours at different rates: keep the exact money, show the rate that has most hours
    const pay = workParts.reduce(
      (a, p) => a + round2(num(p.rate) * (num(p.unitsHours) + num(p.bankHolidayHours))),
      0,
    );
    fixedAmount = round2(pay + num(entitlement) * HOLIDAY_PAY_RATE);
    rate = [...workParts].sort(
      (a, b) =>
        num(b.unitsHours) + num(b.bankHolidayHours) - (num(a.unitsHours) + num(a.bankHolidayHours)),
    )[0]!.rate;
  } else if (totalHours === 0 && num(entitlement) === 0 && !(num(rate) > 0) && num(fileAmount) > 0) {
    // fixed-pay guard: Rate 0 and a typed Amount
    fixedAmount = round2(num(fileAmount));
  }
  return {
    unitsHours: units,
    bankHolidayHours: bh,
    holidayEntitlement: entitlement,
    comment,
    rate,
    amount: fileAmount,
    fixedAmount,
    holidayRate: fixedAmount !== null ? null : holidayRate,
  };
}

const appAmount = (l: LineValues): number =>
  lineTotals({
    unitsHours: num(l.unitsHours),
    bankHolidayHours: num(l.bankHolidayHours),
    holidayEntitlement: num(l.holidayEntitlement),
    rate: num(l.rate),
    fixedAmount: l.fixedAmount,
    holidayRate: l.holidayRate,
  }).amount;

interface Candidate {
  row: PayrollImportRow;
  parts: LineValues[];
}

const lineOf = (r: PayrollImportRow): LineValues => ({
  unitsHours: r.unitsHours,
  bankHolidayHours: r.bankHolidayHours,
  holidayEntitlement: r.holidayEntitlement,
  comment: r.comment,
  rate: r.rate,
  amount: r.amount,
  fixedAmount: null,
  holidayRate: null,
});

const hasAnyLineCell = (r: PayrollImportRow) =>
  r.unitsHours !== null ||
  r.bankHolidayHours !== null ||
  r.holidayEntitlement !== null ||
  r.rate !== null ||
  r.amount !== null ||
  r.comment !== "";

export function parsePayrollSheet(matrix: Matrix): PayrollImportParse {
  let headerRow = -1;
  let cols = new Map<number, Target>();
  for (let r = 0; r < Math.min(matrix.length, MAX_HEADER_SCAN); r++) {
    const found = headerMap(matrix[r]);
    const targets = new Set(found.values());
    if (targets.has("name") && targets.has("units")) {
      headerRow = r;
      cols = found;
      break;
    }
  }
  if (headerRow < 0)
    return {
      rows: [],
      skippedRows: 0,
      duplicates: [],
      mergedRows: 0,
      mismatches: [],
      invalid: {},
      found: false,
    };
  const hasAmountCol = [...cols.values()].includes("amount");

  const headerText = new Map<number, string>();
  (matrix[headerRow] ?? []).forEach((cell, c) => headerText.set(c, squash(toText(cell))));

  const candidates: Candidate[] = [];
  const invalid: Record<string, number> = {};
  const bad = (k: string) => (invalid[k] = (invalid[k] ?? 0) + 1);
  let skippedRows = 0;
  let mergedRows = 0;
  let last: Candidate | null = null;

  for (const row of matrix.slice(headerRow + 1)) {
    if (!row || row.every((c) => toText(c) === "")) continue;
    const out: PayrollImportRow = {
      name: "",
      ni: "",
      unitsHours: null,
      bankHolidayHours: null,
      holidayEntitlement: null,
      comment: "",
      rate: null,
      amount: null,
      fixedAmount: null,
      holidayRate: null,
    };
    for (const [c, target] of cols) {
      const cell = row[c];
      const text = toText(cell);
      if (!text) continue;
      const key = squash(text);
      // template filler: a known placeholder, or a cell that just repeats its own header
      if (PLACEHOLDERS.has(key) || key === headerText.get(c)) {
        if (target === "name") out.name = "";
        continue;
      }
      switch (target) {
        case "name":
          out.name = text;
          break;
        case "ni":
          out.ni = text;
          break;
        case "units":
        case "bankHoliday":
        case "entitlement":
        case "rate":
        case "amount": {
          const n = typeof cell === "number" ? cell : toNumber(cell);
          const unreadable =
            typeof cell === "string" && Number.isNaN(Number(text.replace(/[£,\s]/g, "")));
          if (!Number.isFinite(n) || n < 0 || unreadable) {
            bad(NUMBER_LABEL[target]);
            break;
          }
          if (target === "units") out.unitsHours = n;
          else if (target === "bankHoliday") out.bankHolidayHours = n;
          else if (target === "entitlement") out.holidayEntitlement = n;
          else if (target === "amount") out.amount = n;
          else out.rate = n;
          break;
        }
        case "comment":
          out.comment = text.slice(0, 200);
          break;
        default: {
          const field = target as StaffDetailField;
          if (DATE_FIELDS.has(field)) {
            const iso = readDate(cell);
            if (validIso(iso)) out[field] = iso;
            else bad(field);
          } else if (field === "contractStatus") {
            const status = CONTRACT_STATUSES.find((s) => squash(s) === key);
            if (status) out.contractStatus = status;
            else bad(field);
          } else out[field] = text;
        }
      }
    }
    if (!out.name) {
      // a nameless row under a person = that person's extra hours / second rate
      if (last && hasAnyLineCell(out)) {
        last.parts.push(lineOf(out));
        mergedRows++;
      } else skippedRows++;
      continue;
    }
    last = { row: out, parts: [lineOf(out)] };
    candidates.push(last);
  }

  // one line per person; the same person twice -> keep the row that carries pay
  const rows: PayrollImportRow[] = [];
  const index = new Map<string, number>();
  const duplicates: string[] = [];
  for (const cand of candidates) {
    const line = combineParts(cand.parts);
    const merged: PayrollImportRow = { ...cand.row, ...line };
    const key = normNi(merged.ni) || `n:${normName(merged.name)}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, rows.length);
      rows.push(merged);
      continue;
    }
    if (duplicates.length < 8) duplicates.push(merged.name);
    const kept = rows[at]!;
    if (!hasPay(kept) && hasPay(merged)) {
      // the earlier row was an empty / P45 copy: take this row's pay, keep any details already read
      const next: PayrollImportRow = { ...merged };
      for (const f of STAFF_DETAIL_FIELDS) {
        const keep = kept[f];
        if (keep) next[f] = keep;
      }
      if (kept.ni) next.ni = kept.ni;
      rows[at] = next;
    } else {
      // keep the first row, but fill details it is missing
      for (const f of STAFF_DETAIL_FIELDS) {
        if (!kept[f] && merged[f]) kept[f] = merged[f];
      }
      if (!kept.ni && merged.ni) kept.ni = merged.ni;
    }
  }

  // cross-check against the file's own Amount column
  const mismatches: string[] = [];
  if (hasAmountCol) {
    for (const r of rows) {
      const file = round2(num(r.amount));
      const app = appAmount(r);
      if (Math.abs(file - app) > 0.01 && mismatches.length < 12)
        mismatches.push(`${r.name}: file £${file.toFixed(2)}, app £${app.toFixed(2)}`);
    }
  }
  return { rows, skippedRows, duplicates, mergedRows, mismatches, invalid, found: true };
}
