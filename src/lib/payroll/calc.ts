/**
 * Salary sheet arithmetic — the single place the Excel formulas live.
 *
 *   Total Hours    = RSS hours + ESS hours
 *   Total Amount   = RSS amount + ESS amount + carry-forward (-OverPaid/+Remaining)
 *   Total Payroll  = sum(payroll company amounts) - tax deduction
 *   Total Cash     = sum(P1..Pn)
 *   Outstanding    = Total Amount - Total Payroll - Total Cash - Deduction
 *   Pay status     = Current (>0) | OverPaid (<0) | Paid in Full (=0)
 *
 * Everything is rounded to 2 decimals BEFORE the status compare — Excel
 * compared AD=0 exactly, so 0.0000001 of float noise showed the wrong status.
 */
import type { PayStatus, PayrollCompany, SalaryEntry, SalaryPayment, Staff } from "./types";

/**
 * Whether a shift's payable expenses are added to, and its penalty taken off,
 * the amount that feeds a person's RSS/ESS total. The Excel sheet only ever
 * summed the AMOUNT column (hours x guard rate), so this is OFF to match it.
 * Flip to `true` if expenses / penalties should flow into salary.
 */
export const INCLUDE_EXPENSES_AND_PENALTY = false;

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

export interface ComputedEntry {
  totalHours: number;
  totalAmount: number;
  payrollTotal: number;
  cashPaid: number;
  outstanding: number;
  payStatus: PayStatus;
}

export function payStatusOf(outstanding: number): PayStatus {
  const o = round2(outstanding);
  if (o > 0) return "Current";
  if (o < 0) return "OverPaid";
  return "Paid in Full";
}

export function computeEntry(
  entry: SalaryEntry,
  payments: readonly SalaryPayment[],
): ComputedEntry {
  const totalHours = round2(num(entry.rssHours) + num(entry.essHours));
  const totalAmount = round2(num(entry.rssAmount) + num(entry.essAmount) + num(entry.carryForward));
  // Every company amount counts, including one archived later, so archiving a
  // column can never silently change somebody's balance.
  const grossPayroll = Object.values(entry.payroll ?? {}).reduce((s, v) => s + num(v), 0);
  const payrollTotal = round2(grossPayroll - num(entry.taxDeduction));
  const cashPaid = round2(payments.reduce((s, p) => s + num(p.amount), 0));
  const outstanding = round2(totalAmount - payrollTotal - cashPaid - num(entry.deduction));
  return {
    totalHours,
    totalAmount,
    payrollTotal,
    cashPaid,
    outstanding,
    payStatus: payStatusOf(outstanding),
  };
}

export interface SheetRow {
  staff: Staff;
  entry: SalaryEntry;
  payments: SalaryPayment[];
  computed: ComputedEntry;
}

/** Joins entries with their staff + payments and computes every line. Lines
 * whose staff record is missing are dropped (can't happen via the FK). */
export function buildRows(
  entries: readonly SalaryEntry[],
  staff: readonly Staff[],
  payments: readonly SalaryPayment[],
  // kept so callers can pass the active columns; amounts of every company count
  _companies?: readonly PayrollCompany[],
): SheetRow[] {
  void _companies;
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const paymentsByEntry = new Map<string, SalaryPayment[]>();
  for (const p of payments) {
    const list = paymentsByEntry.get(p.entryId);
    if (list) list.push(p);
    else paymentsByEntry.set(p.entryId, [p]);
  }
  const rows: SheetRow[] = [];
  for (const entry of entries) {
    const s = staffById.get(entry.staffId);
    if (!s) continue;
    const pays = (paymentsByEntry.get(entry.id) ?? []).sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    rows.push({ staff: s, entry, payments: pays, computed: computeEntry(entry, pays) });
  }
  return rows;
}

export interface SheetTotals {
  lines: number;
  rssAmount: number;
  rssHours: number;
  essAmount: number;
  essHours: number;
  carryForward: number;
  totalHours: number;
  totalAmount: number;
  payrollTotal: number;
  taxDeduction: number;
  cashPaid: number;
  deduction: number;
  outstanding: number;
  byCompany: Record<string, number>;
}

export function sumRows(rows: readonly SheetRow[]): SheetTotals {
  const t: SheetTotals = {
    lines: rows.length,
    rssAmount: 0,
    rssHours: 0,
    essAmount: 0,
    essHours: 0,
    carryForward: 0,
    totalHours: 0,
    totalAmount: 0,
    payrollTotal: 0,
    taxDeduction: 0,
    cashPaid: 0,
    deduction: 0,
    outstanding: 0,
    byCompany: {},
  };
  for (const r of rows) {
    const e = r.entry;
    t.rssAmount += num(e.rssAmount);
    t.rssHours += num(e.rssHours);
    t.essAmount += num(e.essAmount);
    t.essHours += num(e.essHours);
    t.carryForward += num(e.carryForward);
    t.taxDeduction += num(e.taxDeduction);
    t.deduction += num(e.deduction);
    t.totalHours += r.computed.totalHours;
    t.totalAmount += r.computed.totalAmount;
    t.payrollTotal += r.computed.payrollTotal;
    t.cashPaid += r.computed.cashPaid;
    t.outstanding += r.computed.outstanding;
    for (const [id, v] of Object.entries(e.payroll ?? {})) {
      t.byCompany[id] = (t.byCompany[id] ?? 0) + num(v);
    }
  }
  for (const k of Object.keys(t) as (keyof SheetTotals)[]) {
    const v = t[k];
    if (typeof v === "number") (t[k] as number) = round2(v);
  }
  for (const id of Object.keys(t.byCompany)) t.byCompany[id] = round2(t.byCompany[id] ?? 0);
  return t;
}

/* ------------------------------ text helpers ------------------------------ */

/** "AB 12 34 56 C" / "ab123456c" / "AB-123456-C" all compare equal. */
export const normNi = (s: string | null | undefined): string =>
  (s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * UK National Insurance number: 2 letters + 6 digits + a suffix letter A-D.
 * The first letter can't be D, F, I, Q, U or V; the second can't be D, F, I,
 * O, Q, U or V; and the prefixes BG, GB, KN, NK, NT, TN, ZZ are never issued.
 * (Temporary "TN" numbers and a missing suffix are NOT accepted here.)
 */
const NI_PATTERN = /^(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/;

export function isValidNi(s: string | null | undefined): boolean {
  return NI_PATTERN.test(normNi(s));
}

/**
 * Canonical way to STORE and SHOW an NI number: "ry865871d" -> "RY 86 58 71 D"
 * (the spaced style the Excel salary sheet already uses). Anything that isn't a
 * valid NI is returned trimmed + upper-cased and otherwise untouched, so a
 * typo is never silently "fixed" into a different number.
 */
export function formatNi(s: string | null | undefined): string {
  const n = normNi(s);
  if (!NI_PATTERN.test(n)) return (s ?? "").trim().toUpperCase();
  return `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
}

/** Case/space/punctuation-insensitive name key. */
export const normName = (s: string | null | undefined): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "MUHAMMAD UMAIR (Leeds)" -> "muhammad umair"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-09" -> "September 2026" (falls back to the input if malformed). */
export function formatMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const name = MONTHS[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : month;
}

/** yyyy-mm for the current month. */
export const currentMonth = (): string => new Date().toISOString().slice(0, 7);
