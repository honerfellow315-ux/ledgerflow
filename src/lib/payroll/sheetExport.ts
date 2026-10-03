/**
 * Excel export of a payroll sheet in the "All Payroll Format" layout:
 * summary block, "(Company) PAY ROLL" title, grouped headers (EMPLOYMENT / PERSONAL /
 * BANKING / CONTRACT STATUS / SIA), live formulas (Total Hours, Amount, Age) with cached
 * values, and the same dropdown lists as the original workbook. One tab per month.
 */
import { formatMonthLabel } from "./calc";
import { lineTotals, sumLines } from "./sheetCalc";
import {
  COMMENT_OPTIONS,
  GENDER_OPTIONS,
  HOURS_ALLOWED_OPTIONS,
  IMMIGRATION_OPTIONS,
  ROLE_OPTIONS,
  SERVICE_OPTIONS,
  ageFromDob,
} from "./staffFields";
import { CONTRACT_STATUSES } from "./types";
import type { PayrollLine, PayrollSheetStaff } from "./sheetTypes";

export interface ExportMonth {
  month: string;
  rows: { line: PayrollLine; staff: PayrollSheetStaff }[];
}

const HEAD = [
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

const GROUPS: { label: string; from: number; to: number }[] = [
  { label: "EMPLOYMENT", from: 2, to: 8 },
  { label: "PERSONAL", from: 9, to: 18 },
  { label: "BANKING", from: 19, to: 21 },
  { label: "CONTRACT STATUS", from: 22, to: 27 },
  { label: "SIA", from: 28, to: 30 },
];

const FIRST = 9;
const list = (xs: readonly string[]) => `"${xs.join(",")}"`;

const isoToDate = (iso: string | undefined): Date | null => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
};

/** Excel sheet names: max 31 chars, none of  : \ / ? * [ ] */
const tabName = (s: string, used: Set<string>): string => {
  const base = s.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${i++}`;
  used.add(name.toLowerCase());
  return name;
};

/** Builds the workbook (no browser APIs, so it can be tested on its own). */
export async function buildPayrollWorkbook(
  companyName: string,
  months: readonly ExportMonth[],
  withStaffDetails: boolean,
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();

  for (const m of months) {
    const ws = wb.addWorksheet(tabName(formatMonthLabel(m.month), used), {
      views: [{ state: "frozen", xSplit: 1, ySplit: 8 }],
    });
    const rows = [...m.rows].sort((a, b) => a.staff.name.localeCompare(b.staff.name));
    const last = FIRST + Math.max(rows.length, 1) - 1;
    const totals = sumLines(rows.map((r) => r.line));

    // summary block
    ws.mergeCells("A1:A2");
    ws.getCell("A1").value = "Total Working hours";
    ws.mergeCells("B1:B2");
    ws.getCell("B1").value = { formula: `SUM(E${FIRST}:E${last})`, result: totals.totalHours };
    ws.mergeCells("A3:A4");
    ws.getCell("A3").value = "Total Amount";
    ws.mergeCells("B3:B4");
    ws.getCell("B3").value = { formula: `SUM(H${FIRST}:H${last})`, result: totals.amount };
    ws.getCell("B3").numFmt = "£#,##0.00";
    ws.mergeCells("H2:J4");
    ws.getCell("H2").value = `${companyName} PAY ROLL`;
    ws.getCell("H2").font = { bold: true, size: 16 };
    ws.getCell("H2").alignment = { horizontal: "center", vertical: "middle" };
    for (const a of ["A1", "A3"]) ws.getCell(a).font = { bold: true };
    for (const a of ["A1", "B1", "A3", "B3"])
      ws.getCell(a).alignment = {
        vertical: "middle",
        horizontal: a.startsWith("A") ? "left" : "right",
      };

    // group headers (row 7)
    for (const g of GROUPS) {
      ws.mergeCells(7, g.from, 7, g.to);
      const c = ws.getCell(7, g.from);
      c.value = g.label;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.alignment = { horizontal: "center" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
    }
    // column headers (row 8)
    const head = ws.getRow(8);
    HEAD.forEach((h, i) => {
      const c = head.getCell(i + 1);
      c.value = h;
      c.font = { bold: true };
      c.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF6" } };
      c.border = { bottom: { style: "thin" } };
    });
    head.height = 32;

    rows.forEach(({ line, staff }, i) => {
      const r = FIRST + i;
      const t = lineTotals(line);
      const d = withStaffDetails;
      const dob = d ? isoToDate(staff.dob) : null;
      const age = d ? ageFromDob(staff.dob) : "";
      const row = ws.getRow(r);
      row.getCell(1).value = staff.name;
      row.getCell(2).value = line.unitsHours;
      row.getCell(3).value = line.bankHolidayHours;
      row.getCell(4).value = line.holidayEntitlement || null;
      row.getCell(5).value = { formula: `C${r}+B${r}`, result: t.totalHours };
      row.getCell(6).value = line.comment || null;
      row.getCell(7).value = line.rate;
      row.getCell(8).value = { formula: `G${r}*E${r}`, result: t.amount };
      row.getCell(9).value = dob;
      row.getCell(10).value = dob
        ? { formula: `IF(I${r}="","",DATEDIF(I${r},TODAY(),"Y"))`, result: age === "" ? "" : age }
        : null;
      row.getCell(11).value = staff.gender ?? null;
      if (d) {
        row.getCell(12).value = staff.rtwShareCode ?? null;
        row.getCell(13).value = isoToDate(staff.shareCodeExpiry);
        row.getCell(14).value = staff.ni || null;
        row.getCell(15).value = staff.address ?? null;
        row.getCell(16).value = staff.town ?? null;
        row.getCell(17).value = staff.postCode ?? null;
        row.getCell(18).value = staff.uniform ?? null;
        row.getCell(19).value = staff.accountHolderName ?? null;
        // kept as text so leading zeros in account numbers / sort codes survive
        row.getCell(20).value = staff.accountNumber ?? null;
        row.getCell(21).value = staff.sortCode ?? null;
        row.getCell(22).value = isoToDate(staff.employmentStartDate);
        row.getCell(23).value = isoToDate(staff.employmentEndDate);
        row.getCell(25).value = staff.email ?? null;
        row.getCell(26).value = staff.immigrationStatus ?? null;
        row.getCell(28).value = staff.siaNumber ?? null;
      }
      row.getCell(24).value = staff.contractStatus ?? null;
      row.getCell(27).value = staff.hoursAllowed ?? null;
      row.getCell(29).value = staff.role ?? null;
      row.getCell(30).value = staff.serviceType ?? null;

      for (const c of [2, 3, 4, 5]) row.getCell(c).numFmt = "0.00";
      row.getCell(7).numFmt = "£#,##0.00";
      row.getCell(8).numFmt = "£#,##0.00";
      for (const c of [9, 13, 22, 23]) row.getCell(c).numFmt = "dd/mm/yyyy";
      for (const c of [20, 21]) row.getCell(c).numFmt = "@";
    });

    // dropdowns, same lists as the original workbook
    const dv = (col: string, formula: string) => {
      for (let r = FIRST; r <= Math.max(last, FIRST + 200); r++) {
        ws.getCell(`${col}${r}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [formula],
        };
      }
    };
    dv("F", list(COMMENT_OPTIONS));
    dv("K", list(GENDER_OPTIONS));
    dv("X", list(CONTRACT_STATUSES));
    dv("Z", list(IMMIGRATION_OPTIONS));
    dv("AA", list(HOURS_ALLOWED_OPTIONS));
    dv("AC", list(ROLE_OPTIONS));
    dv("AD", list(SERVICE_OPTIONS));

    const widths: Record<number, number> = {
      1: 30,
      2: 11,
      3: 12,
      4: 12,
      5: 11,
      6: 20,
      7: 10,
      8: 12,
      9: 12,
      10: 6,
      11: 9,
      12: 16,
      13: 14,
      14: 15,
      15: 30,
      16: 14,
      17: 11,
      18: 9,
      19: 22,
      20: 14,
      21: 10,
      22: 14,
      23: 12,
      24: 11,
      25: 28,
      26: 24,
      27: 18,
      28: 18,
      29: 15,
      30: 18,
      31: 18,
    };
    for (const [c, w] of Object.entries(widths)) ws.getColumn(Number(c)).width = w;
    ws.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8, column: HEAD.length } };
  }

  return wb;
}

export async function exportPayrollWorkbook(
  companyName: string,
  months: readonly ExportMonth[],
  withStaffDetails: boolean,
): Promise<void> {
  const wb = await buildPayrollWorkbook(companyName, months, withStaffDetails);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const first = months[0];
  a.download = `${companyName} Payroll${first ? ` ${formatMonthLabel(first.month)}` : ""}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
