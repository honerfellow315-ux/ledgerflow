/**
 * "All Payroll Format" export: the per-company payroll report for ONE payroll
 * company and ONE month, built in the browser with exceljs (same pattern as
 * export.ts). Same columns / order / group headers / header totals as the
 * report template.
 *
 * Amount = the company's amount from the salary sheet (a plain value).
 * Units (Hours) is this company's share of the payroll hours set on the Salary
 * Sheet (empty when none were set). Bank Holiday Hours, Holiday Entitlement and
 * Rate are left EMPTY on purpose; Total Hours
 * stays a formula (Units + Bank Holiday) so it works when hours are typed in Excel.
 */
import { formatNi, formatMonthLabel, round2 } from "./calc";
import {
  COMMENT_OPTIONS,
  HOURS_ALLOWED_OPTIONS,
  IMMIGRATION_OPTIONS,
  ageFromDob,
} from "./staffFields";
import { CONTRACT_STATUSES, type PayrollCompany, type Staff } from "./types";

export interface ReportRow {
  staff: Staff;
  /** This company's amount for the month (salary_entries.payroll[companyId]). */
  amount: number;
  /** Payroll hours that belong to this company (blank in the file when 0 / unknown). */
  hours?: number;
}

const HEADERS = [
  "Employee Name",
  "Units (Hours)",
  "Bank Holiday Hours",
  "Holiday Entitlement",
  "Total Hours",
  "Comment",
  "Rate",
  "Amount",
  "DOB",
  "Age",
  "Gender",
  "RTW Share Code",
  "Share code Expiry",
  "NI Number",
  "Address",
  "Town",
  "Post Code",
  "Uniform",
  "Account Holder Name",
  "Account Number",
  "Sort Code",
  "Employment Start Date",
  "End Date",
  "Status",
  "Email",
  "Immigration Status",
  "Hours of Work Allowed",
  "Sia Number",
  "Role",
  "Services Type",
  "Notes",
] as const;

// Column numbers (1-based) used below.
const C = {
  name: 1,
  units: 2,
  bankHol: 3,
  entitlement: 4,
  total: 5,
  comment: 6,
  rate: 7,
  amount: 8,
  dob: 9,
  age: 10,
  gender: 11,
  rtw: 12,
  expiry: 13,
  ni: 14,
  address: 15,
  town: 16,
  postCode: 17,
  uniform: 18,
  holder: 19,
  accountNo: 20,
  sortCode: 21,
  start: 22,
  end: 23,
  status: 24,
  email: 25,
  immigration: 26,
  hoursAllowed: 27,
  sia: 28,
  role: 29,
  service: 30,
  notes: 31,
} as const;

const WIDTHS: Record<number, number> = {
  [C.name]: 27.6,
  [C.units]: 14.6,
  [C.bankHol]: 18.7,
  [C.entitlement]: 19,
  [C.total]: 12,
  [C.comment]: 19.1,
  [C.rate]: 10,
  [C.amount]: 12,
  [C.dob]: 14,
  [C.age]: 10,
  [C.gender]: 13.9,
  [C.rtw]: 16.7,
  [C.expiry]: 18,
  [C.ni]: 16,
  [C.address]: 38.4,
  [C.town]: 14,
  [C.postCode]: 12,
  [C.uniform]: 10,
  [C.holder]: 25.4,
  [C.accountNo]: 20,
  [C.sortCode]: 16.9,
  [C.start]: 22.9,
  [C.end]: 14,
  [C.status]: 12,
  [C.email]: 25.3,
  [C.immigration]: 23.9,
  [C.hoursAllowed]: 21.7,
  [C.sia]: 20,
  [C.role]: 24.7,
  [C.service]: 36.1,
  [C.notes]: 32,
};

const BLUE = "FF1155CC";
const PURPLE = "FF674EA7";
const GREEN = "FF38761D";
const BROWN = "FF7F6000";
const SIA_BLUE = "FF6FA8DC";
const NOTES_ORANGE = "FFF6B26B";

/** Fill colour of the header cell of each column (row 8). */
function headerFill(c: number): string {
  if (c <= C.postCode) return BLUE;
  if (c === C.uniform) return PURPLE;
  if (c <= C.sortCode) return GREEN;
  if (c <= C.hoursAllowed) return BROWN;
  if (c <= C.service) return SIA_BLUE;
  return NOTES_ORANGE;
}

const FIRST_ROW = 9;
// The template sums rows 9..936; keep that so people can add rows underneath.
const SUM_TO_ROW = 936;

const MONEY_FMT = "[$£-809]#,##0.00";
const DOB_FMT = 'dd"-"mmm"-"yyyy';
const DATE_FMT = "[$-409]d/mmm/yyyy;@";

/** yyyy-mm-dd -> Date at UTC midnight (so Excel shows the same day everywhere); null if invalid. */
function isoToDate(iso: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

const safeFileName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "<Company> payroll - <Month YYYY>.xlsx" */
export const reportFileName = (company: string, month: string) =>
  `${safeFileName(company)} payroll - ${formatMonthLabel(month)}.xlsx`;

export async function exportPayrollReport(
  month: string,
  company: Pick<PayrollCompany, "id" | "name">,
  rows: readonly ReportRow[],
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  // make Excel recalculate Total Hours / Age / the header totals when the file opens
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet(formatMonthLabel(month).slice(0, 31), {
    views: [{ state: "frozen", xSplit: 1, ySplit: 8, zoomScale: 85, showGridLines: true }],
  });

  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const allThin = { top: thin, left: thin, bottom: thin, right: thin };
  const thick = { style: "thick" as const, color: { argb: "FF000000" } };
  const solid = (argb: string) => ({
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb },
  });
  const white = "FFFFFFFF";

  ws.columns = HEADERS.map((_, i) => ({ width: WIDTHS[i + 1] ?? 14 }));
  for (let r = 1; r <= 8; r++) ws.getRow(r).height = 12.75;

  const sorted = [...rows].sort((a, b) => a.staff.name.localeCompare(b.staff.name));
  const lastDataRow = FIRST_ROW + sorted.length - 1;
  const sumTo = Math.max(SUM_TO_ROW, lastDataRow);
  const totalAmount = round2(sorted.reduce((s, r) => s + r.amount, 0));

  /* ---- header block: totals (left) and the title (middle) ---- */
  const totalBox = (
    labelRow: number,
    label: string,
    formula: string,
    result: number,
    fmt?: string,
  ) => {
    ws.mergeCells(labelRow, 1, labelRow + 1, 1);
    ws.mergeCells(labelRow, 2, labelRow + 1, 2);
    const a = ws.getCell(labelRow, 1);
    const b = ws.getCell(labelRow, 2);
    a.value = label;
    b.value = { formula, result };
    if (fmt) b.numFmt = fmt;
    for (const cell of [a, b]) {
      cell.font = { name: "Arial", size: 11, bold: true, color: { argb: white } };
      cell.fill = solid("FF8E7CC3");
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = allThin;
    }
  };
  totalBox(1, "Total Working hours", `SUM(B${FIRST_ROW}:B${sumTo})`, 0);
  totalBox(3, "Total Amount ", `SUM(H${FIRST_ROW}:H${sumTo})`, totalAmount, MONEY_FMT);

  ws.mergeCells("H2:J4");
  const title = ws.getCell("H2");
  title.value = `${company.name} PAY ROLL`;
  title.font = { name: "Arial", size: 18, bold: true, color: { argb: white } };
  title.fill = solid("FF1C4587");
  title.alignment = { horizontal: "center", vertical: "middle" };
  for (let r = 2; r <= 4; r++)
    for (let c = 8; c <= 10; c++)
      ws.getCell(r, c).border = {
        ...(r === 2 ? { top: thick } : {}),
        ...(r === 4 ? { bottom: thick } : {}),
        ...(c === 8 ? { left: thick } : {}),
        ...(c === 10 ? { right: thick } : {}),
      };

  /* ---- group headers (row 7) ---- */
  const group = (from: number, to: number, label: string, fill: string, dark = false) => {
    if (to > from) ws.mergeCells(7, from, 7, to);
    for (let c = from; c <= to; c++) ws.getCell(7, c).fill = solid(fill);
    const cell = ws.getCell(7, from);
    cell.value = label;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: dark ? "FF000000" : white } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  };
  group(C.units, C.amount, "EMPLOYMENT", BLUE);
  group(C.dob, C.postCode, "PERSONAL", BLUE);
  ws.getCell(7, C.uniform).fill = solid(PURPLE);
  group(C.holder, C.sortCode, "BANKING", GREEN);
  group(C.start, C.hoursAllowed, "CONTRACT STATUS", BROWN);
  group(C.sia, C.service, "SIA ", SIA_BLUE, true);
  ws.getCell(7, C.name).fill = solid(BLUE);
  ws.getCell(7, C.notes).fill = solid(NOTES_ORANGE);

  /* ---- column headers (row 8) ---- */
  HEADERS.forEach((h, i) => {
    const c = i + 1;
    const cell = ws.getCell(8, c);
    cell.value = h;
    const fill = headerFill(c);
    const dark = fill === SIA_BLUE || fill === NOTES_ORANGE;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: dark ? "FF000000" : white } };
    cell.fill = solid(fill);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = allThin;
  });

  /* ---- data rows ---- */
  sorted.forEach((r, i) => {
    const n = FIRST_ROW + i;
    const s = r.staff;
    const set = (
      c: number,
      v: string | number | Date | null | { formula: string; result: string | number },
    ) => {
      const cell = ws.getCell(n, c);
      cell.value = v;
      return cell;
    };

    set(C.name, s.name);
    // Units = this company's share of the payroll hours decided on the Salary Sheet
    // (left empty when none were decided). Bank Holiday / Holiday Entitlement / Rate stay empty.
    if (r.hours && r.hours > 0) set(C.units, r.hours);
    set(C.total, { formula: `C${n}+B${n}`, result: 0 });
    set(C.amount, r.amount);

    const dob = isoToDate(s.dob);
    if (dob) set(C.dob, dob).numFmt = DOB_FMT;
    const age = ageFromDob(s.dob);
    set(C.age, {
      formula: `IF(I${n}="","",DATEDIF(I${n},TODAY(),"Y"))`,
      result: age,
    });
    if (s.gender) set(C.gender, s.gender);
    if (s.rtwShareCode) set(C.rtw, s.rtwShareCode);
    const expiry = isoToDate(s.shareCodeExpiry);
    if (expiry) set(C.expiry, expiry).numFmt = DATE_FMT;
    if (s.ni) set(C.ni, formatNi(s.ni));
    if (s.address) set(C.address, s.address);
    if (s.town) set(C.town, s.town);
    if (s.postCode) set(C.postCode, s.postCode);
    if (s.uniform) set(C.uniform, /^\d+(\.\d+)?$/.test(s.uniform) ? Number(s.uniform) : s.uniform);
    if (s.accountHolderName) set(C.holder, s.accountHolderName);
    // text, so leading zeros survive
    if (s.accountNumber) set(C.accountNo, s.accountNumber).numFmt = "@";
    if (s.sortCode) set(C.sortCode, s.sortCode).numFmt = "@";
    const start = isoToDate(s.employmentStartDate);
    if (start) set(C.start, start).numFmt = DATE_FMT;
    const end = isoToDate(s.employmentEndDate);
    if (end) set(C.end, end).numFmt = DATE_FMT;
    if (s.contractStatus) set(C.status, s.contractStatus);
    if (s.email) set(C.email, s.email);
    if (s.immigrationStatus) set(C.immigration, s.immigrationStatus);
    if (s.hoursAllowed) set(C.hoursAllowed, s.hoursAllowed);
    if (s.siaNumber) set(C.sia, s.siaNumber);
    if (s.role) set(C.role, s.role);
    if (s.serviceType) set(C.service, s.serviceType);
    if (s.notes) set(C.notes, s.notes);

    ws.getRow(n).height = 15;
    for (let c = 1; c <= HEADERS.length; c++) {
      const cell = ws.getCell(n, c);
      cell.border = allThin;
      cell.font = c === C.notes ? { name: "Arial", size: 10 } : { name: "Calibri", size: 11 };
      cell.alignment = {
        horizontal: c === C.name || c === C.address || c === C.notes ? "left" : "center",
        vertical: "middle",
      };
    }
    ws.getCell(n, C.rate).numFmt = MONEY_FMT;
    ws.getCell(n, C.amount).numFmt = MONEY_FMT;
    ws.getCell(n, C.ni).fill = solid("FF93C47D");

    // the report's dropdowns (typing something else is still allowed)
    const list = (c: number, items: readonly string[]) => {
      ws.getCell(n, c).dataValidation = {
        type: "list",
        allowBlank: true,
        showErrorMessage: false,
        formulae: [`"${items.join(",")}"`],
      };
    };
    list(C.comment, COMMENT_OPTIONS);
    list(C.status, CONTRACT_STATUSES);
    list(C.immigration, IMMIGRATION_OPTIONS);
    list(C.hoursAllowed, HOURS_ALLOWED_OPTIONS);
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFileName(company.name, month);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
