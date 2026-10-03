/**
 * Payroll sheet arithmetic — the single place the "All Payroll Format" Excel formulas live.
 *
 *   Total Hours = Units (Hours) + Bank Holiday Hours          (E = C + B)
 *   Amount      = Rate x Total Hours                           (H = G x E)
 *   Age         = whole years from DOB                         (J = DATEDIF)
 *
 * Holiday Entitlement is information only and is NOT part of Total Hours, exactly as in the sheet.
 * Everything is rounded to 2 decimals so float noise never shows (597.37 not 597.3700000001).
 */
import { normNi, round2, isValidNi } from "./calc";
import { shareCodeState } from "./staffFields";
import type { PayrollLine, PayrollSheetStaff } from "./sheetTypes";

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export interface LineTotals {
  totalHours: number;
  amount: number;
}

export function lineTotals(
  l: Pick<PayrollLine, "unitsHours" | "bankHolidayHours" | "rate">,
): LineTotals {
  const totalHours = round2(n(l.unitsHours) + n(l.bankHolidayHours));
  return { totalHours, amount: round2(n(l.rate) * totalHours) };
}

export interface SheetTotals {
  lines: number;
  unitsHours: number;
  bankHolidayHours: number;
  totalHours: number;
  amount: number;
}

export function sumLines(lines: readonly PayrollLine[]): SheetTotals {
  let unitsHours = 0;
  let bankHolidayHours = 0;
  let amount = 0;
  for (const l of lines) {
    unitsHours += n(l.unitsHours);
    bankHolidayHours += n(l.bankHolidayHours);
    amount += lineTotals(l).amount;
  }
  return {
    lines: lines.length,
    unitsHours: round2(unitsHours),
    bankHolidayHours: round2(bankHolidayHours),
    totalHours: round2(unitsHours + bankHolidayHours),
    amount: round2(amount),
  };
}

/** "20 Hours/Week" -> 20 ; "10 Hours/Week" -> 10 ; "No Work Allow" -> 0 ; "Standard" / "" -> null (no limit). */
export function weeklyLimit(hoursAllowed: string | undefined): number | null {
  const v = (hoursAllowed ?? "").trim();
  if (!v || /^standard$/i.test(v)) return null;
  if (/no work/i.test(v)) return 0;
  const m = /(\d+(?:\.\d+)?)\s*hours?\s*\/\s*week/i.exec(v);
  return m ? Number(m[1]) : null;
}

/** Monthly ceiling of a weekly limit (weeks in the month = days / 7). */
export function monthlyLimit(weekly: number, month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return weekly * 4.35;
  const days = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return round2((weekly * days) / 7);
}

export type Severity = "error" | "warn";
export interface LineWarning {
  severity: Severity;
  text: string;
}

/**
 * Cheap, local warnings for one line. Personal/banking checks only run when the viewer
 * is allowed to see staff details (otherwise those fields are simply absent).
 */
export function lineWarnings(
  line: PayrollLine,
  staff: PayrollSheetStaff | undefined,
  month: string,
  canSeeDetails: boolean,
): LineWarning[] {
  const out: LineWarning[] = [];
  if (!staff) return out;
  const { totalHours } = lineTotals(line);

  if (line.rate <= 0 && totalHours > 0) out.push({ severity: "error", text: "Rate is 0" });
  if (staff.contractStatus === "P45" && totalHours > 0)
    out.push({ severity: "warn", text: "Has hours but contract status is P45" });
  if (!staff.active && totalHours > 0)
    out.push({ severity: "warn", text: "Staff record is inactive but has hours" });

  const weekly = weeklyLimit(staff.hoursAllowed);
  if (weekly !== null && totalHours > 0) {
    if (weekly === 0) out.push({ severity: "error", text: "Not allowed to work (No Work Allow)" });
    else {
      const max = monthlyLimit(weekly, month);
      if (totalHours > max)
        out.push({
          severity: "warn",
          text: `${totalHours}h is over the ${weekly}h/week limit (~${max}h for the month)`,
        });
    }
  }

  if (canSeeDetails) {
    if (staff.ni && !isValidNi(staff.ni))
      out.push({ severity: "warn", text: "NI number looks invalid" });
    if (!staff.ni && totalHours > 0) out.push({ severity: "warn", text: "NI number missing" });
    const sc = (staff.sortCode ?? "").replace(/\D/g, "");
    if (staff.sortCode && sc.length !== 6)
      out.push({ severity: "warn", text: "Sort code is not 6 digits" });
    const ac = (staff.accountNumber ?? "").replace(/\D/g, "");
    if (staff.accountNumber && ac.length !== 8)
      out.push({ severity: "warn", text: "Account number is not 8 digits" });
    const sh = shareCodeState(staff);
    if (sh === "expired") out.push({ severity: "error", text: "Right-to-work share code expired" });
    if (sh === "soon") out.push({ severity: "warn", text: "Share code expires soon" });
    if (staff.role === "Front Line" && !staff.siaNumber)
      out.push({ severity: "warn", text: "Front line but no SIA number" });
  }
  return out;
}

/** NI numbers that appear on more than one staff record (compared ignoring spaces/case). */
export function duplicateNis(staff: readonly PayrollSheetStaff[]): Set<string> {
  const seen = new Map<string, number>();
  for (const s of staff) {
    const k = normNi(s.ni);
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, c]) => c > 1).map(([k]) => k));
}

/** Tab-separated snippet to paste into the Salary Sheet "payroll amounts" import (NI, Name, Hours, Amount). */
export function salaryPasteSnippet(
  rows: readonly { staff: PayrollSheetStaff; line: PayrollLine }[],
): string {
  const head = ["NI Number", "Employee Name", "Total Hours", "Amount"].join("\t");
  const body = rows
    .map(({ staff, line }) => {
      const t = lineTotals(line);
      return [staff.ni ?? "", staff.name, t.totalHours.toFixed(2), t.amount.toFixed(2)].join("\t");
    })
    .join("\n");
  return `${head}\n${body}`;
}
