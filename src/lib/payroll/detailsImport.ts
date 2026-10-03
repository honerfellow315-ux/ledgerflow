/**
 * Browser-side parser for the "Employee details" import: reads a file in the
 * All Payroll Format layout and returns, per person, the detail fields it holds.
 * Nothing here touches the server. Template placeholder rows / cells
 * ("Employee Name", "RTW Share Code", "Expiry", "Sia Number", "email",
 * "NI Number", or any cell that just repeats its own column header) are ignored.
 */
import { toIsoDate, toText, type Cell, type Matrix } from "./excel";
import { CONTRACT_STATUSES, type StaffDetailField, type StaffDetails } from "./types";

export interface StaffDetailsRowInput extends StaffDetails {
  name: string;
  ni: string;
}

export interface StaffDetailsParse {
  rows: StaffDetailsRowInput[];
  /** Rows skipped because they are template placeholders or have no name. */
  skippedRows: number;
  /** Values that could not be read (e.g. a date in an unknown format), by report column. */
  invalid: Record<string, number>;
  /** False when no header row with "Employee Name" + "NI Number" was found. */
  found: boolean;
}

export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** normalised header -> where its value goes */
export const HEADER_TO_FIELD: Record<string, StaffDetailField | "name" | "ni"> = {
  employeename: "name",
  ninumber: "ni",
  dob: "dob",
  gender: "gender",
  rtwsharecode: "rtwShareCode",
  sharecodeexpiry: "shareCodeExpiry",
  address: "address",
  town: "town",
  postcode: "postCode",
  uniform: "uniform",
  accountholdername: "accountHolderName",
  accountnumber: "accountNumber",
  sortcode: "sortCode",
  employmentstartdate: "employmentStartDate",
  startdate: "employmentStartDate",
  enddate: "employmentEndDate",
  status: "contractStatus",
  email: "email",
  immigrationstatus: "immigrationStatus",
  hoursofworkallowed: "hoursAllowed",
  sianumber: "siaNumber",
  sialicencenumber: "siaNumber",
  licencesector: "serviceType",
  role: "role",
  servicestype: "serviceType",
  servicetype: "serviceType",
};

export const PLACEHOLDERS = new Set(
  ["Employee Name", "RTW Share Code", "Expiry", "Sia Number", "email", "NI Number"].map(squash),
);

export const DATE_FIELDS = new Set<StaffDetailField>([
  "dob",
  "shareCodeExpiry",
  "employmentStartDate",
  "employmentEndDate",
]);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Accepts what toIsoDate accepts, plus "5 Jan 2024" / "5-Jan-2024" / "5/Jan/2024". */
export function readDate(cell: Cell | undefined): string {
  const iso = toIsoDate(cell);
  if (iso) return iso;
  if (typeof cell !== "string") return "";
  const m = /^(\d{1,2})[\s/.-]+([A-Za-z]{3,9})[\s/.-]+(\d{4})$/.exec(cell.trim());
  if (!m) return "";
  const mi = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
  if (mi < 0) return "";
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

export const validIso = (iso: string) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso);

export function parseStaffDetails(matrix: Matrix): StaffDetailsParse {
  // 1) find the header row
  let headerRow = -1;
  let cols = new Map<number, StaffDetailField | "name" | "ni">();
  for (let r = 0; r < Math.min(matrix.length, 40); r++) {
    const found = new Map<number, StaffDetailField | "name" | "ni">();
    (matrix[r] ?? []).forEach((cell, c) => {
      const target = HEADER_TO_FIELD[squash(toText(cell))];
      if (target) found.set(c, target);
    });
    const targets = new Set(found.values());
    if (targets.has("name") && targets.has("ni") && found.size >= 4) {
      headerRow = r;
      cols = found;
      break;
    }
  }
  if (headerRow < 0) return { rows: [], skippedRows: 0, invalid: {}, found: false };

  const headerText = new Map<number, string>();
  (matrix[headerRow] ?? []).forEach((cell, c) => headerText.set(c, squash(toText(cell))));

  // 2) read the rows under it
  const rows: StaffDetailsRowInput[] = [];
  const invalid: Record<string, number> = {};
  let skippedRows = 0;
  for (const row of matrix.slice(headerRow + 1)) {
    if (!row || row.every((c) => toText(c) === "")) continue;
    const out: StaffDetailsRowInput = { name: "", ni: "" };
    for (const [c, target] of cols) {
      const cell = row[c];
      const text = toText(cell);
      if (!text) continue;
      const key = squash(text);
      // template filler: a known placeholder, or a cell that just repeats its header
      if (PLACEHOLDERS.has(key) || key === headerText.get(c)) {
        if (target === "name") out.name = "";
        continue;
      }
      if (target === "name") out.name = text;
      else if (target === "ni") out.ni = text;
      else if (DATE_FIELDS.has(target)) {
        const iso = readDate(cell);
        if (validIso(iso)) out[target] = iso;
        else invalid[target] = (invalid[target] ?? 0) + 1;
      } else if (target === "contractStatus") {
        const status = CONTRACT_STATUSES.find((s) => squash(s) === key);
        if (status) out.contractStatus = status;
        else invalid[target] = (invalid[target] ?? 0) + 1;
      } else out[target] = text;
    }
    if (!out.name) {
      skippedRows++;
      continue;
    }
    rows.push(out);
  }
  return { rows, skippedRows, invalid, found: true };
}