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
import { normName, normNi } from "./calc";
import { CONTRACT_STATUSES, type StaffDetailField, type StaffDetails } from "./types";

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
}

export interface PayrollImportParse {
  rows: PayrollImportRow[];
  /** Template filler / nameless rows that were ignored. */
  skippedRows: number;
  /** Same person (NI, else name) listed again in the file — only the first row is used. */
  duplicates: string[];
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

type LineCol = "units" | "bankHoliday" | "entitlement" | "comment" | "rate";

const LINE_HEADERS: Record<string, LineCol> = {
  unitshours: "units",
  units: "units",
  workinghours: "units",
  hours: "units",
  bankholidayhours: "bankHoliday",
  bankholiday: "bankHoliday",
  holidayentitlement: "entitlement",
  comment: "comment",
  comments: "comment",
  rate: "rate",
  hourlyrate: "rate",
  payrate: "rate",
};

const NUMBER_LABEL: Record<"units" | "bankHoliday" | "entitlement" | "rate", string> = {
  units: "Units (Hours)",
  bankHoliday: "Bank Holiday Hours",
  entitlement: "Holiday Entitlement",
  rate: "Rate",
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
  if (headerRow < 0) return { rows: [], skippedRows: 0, duplicates: [], invalid: {}, found: false };

  const headerText = new Map<number, string>();
  (matrix[headerRow] ?? []).forEach((cell, c) => headerText.set(c, squash(toText(cell))));

  const rows: PayrollImportRow[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const invalid: Record<string, number> = {};
  const bad = (k: string) => (invalid[k] = (invalid[k] ?? 0) + 1);
  let skippedRows = 0;

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
        case "rate": {
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
      skippedRows++;
      continue;
    }
    const key = normNi(out.ni) || `n:${normName(out.name)}`;
    if (seen.has(key)) {
      if (duplicates.length < 8) duplicates.push(out.name);
      continue;
    }
    seen.add(key);
    rows.push(out);
  }
  return { rows, skippedRows, duplicates, invalid, found: true };
}