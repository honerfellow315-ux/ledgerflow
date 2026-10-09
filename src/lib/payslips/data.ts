/**
 * Payslips — UI only (sample people, nothing is saved or sent).
 * The money comes from the same lineTotals() the Payroll sheet uses, so the
 * payslip can never disagree with the sheet. Phase B swaps buildRun() for real lines.
 */
import { lineTotals } from "@/lib/payroll/sheetCalc";

export interface PayslipRow {
  id: string;
  name: string;
  ni: string;
  company: string;
  month: string;
  unitsHours: number;
  bankHolidayHours: number;
  holidayEntitlement: number;
  rate: number;
  holidayRate: number | null;
  fixedAmount: number | null;
}

export interface EarningLine {
  label: string;
  hours: number | null;
  rate: number | null;
  amount: number;
}

export const COMPANIES = ["Alpha Security Ltd", "Beacon Facilities Ltd", "Crest Event Staffing"];

export function monthOptions(count = 4): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function payslipTotals(p: PayslipRow) {
  return lineTotals({
    unitsHours: p.unitsHours,
    bankHolidayHours: p.bankHolidayHours,
    holidayEntitlement: p.holidayEntitlement,
    rate: p.rate,
    holidayRate: p.holidayRate,
    fixedAmount: p.fixedAmount,
  });
}

/** The lines printed on the payslip. They add up to the same total as the sheet. */
export function earningLines(p: PayslipRow): EarningLine[] {
  if (p.fixedAmount !== null) {
    return [{ label: "Fixed monthly pay", hours: null, rate: null, amount: r2(p.fixedAmount) }];
  }
  const out: EarningLine[] = [];
  if (p.unitsHours > 0)
    out.push({ label: "Hours worked", hours: p.unitsHours, rate: p.rate, amount: r2(p.unitsHours * p.rate) });
  if (p.bankHolidayHours > 0)
    out.push({ label: "Bank holiday hours", hours: p.bankHolidayHours, rate: p.rate, amount: r2(p.bankHolidayHours * p.rate) });
  if (p.holidayRate !== null && p.holidayEntitlement > 0)
    out.push({ label: "Holiday pay", hours: p.holidayEntitlement, rate: p.holidayRate, amount: r2(p.holidayEntitlement * p.holidayRate) });
  return out;
}

/** Why a payslip should be looked at before it is given out (null = ready). */
export function payslipIssue(p: PayslipRow): string | null {
  if (!p.ni.trim()) return "No NI number";
  if (payslipTotals(p).amount === 0) return "No pay this month";
  return null;
}

interface Base {
  name: string;
  ni: string;
  companies: string[];
  hours: number;
  bh: number;
  hol: number;
  rate: number;
  holidayRate?: number;
  fixed?: number;
}

const BASE: Base[] = [
  { name: "Daniel Okafor", ni: "QQ123456A", companies: [COMPANIES[0]!, COMPANIES[1]!], hours: 138, bh: 8, hol: 12, rate: 10.5, holidayRate: 12.71 },
  { name: "Priya Nair", ni: "QQ234567B", companies: [COMPANIES[0]!], hours: 96, bh: 0, hol: 0, rate: 10 },
  { name: "Marcus Bell", ni: "QQ345678C", companies: [COMPANIES[0]!, COMPANIES[2]!], hours: 84, bh: 8, hol: 6, rate: 10.5, holidayRate: 12.71 },
  { name: "Hannah Clarke", ni: "QQ456789D", companies: [COMPANIES[1]!], hours: 160, bh: 0, hol: 0, rate: 10.5 },
  { name: "Tom Reilly", ni: "QQ567890A", companies: [COMPANIES[1]!, COMPANIES[2]!], hours: 66, bh: 0, hol: 0, rate: 10.5 },
  { name: "Aisha Rahman", ni: "QQ678901B", companies: [COMPANIES[2]!], hours: 0, bh: 0, hol: 0, rate: 0, fixed: 1850 },
  { name: "Sam Doyle", ni: "QQ789012C", companies: [COMPANIES[0]!, COMPANIES[1]!], hours: 0, bh: 0, hol: 0, rate: 10 },
  { name: "Tara Quinn", ni: "", companies: [COMPANIES[2]!], hours: 72, bh: 0, hol: 0, rate: 10 },
  { name: "Lewis Grant", ni: "QQ890123D", companies: [COMPANIES[0]!], hours: 120, bh: 8, hol: 0, rate: 11 },
];

export function buildRun(company: string, month: string): PayslipRow[] {
  const bump = (Number(month.slice(-2)) % 3) * 4;
  return BASE.filter((b) => b.companies.includes(company)).map((b, i) => ({
    id: `${company}-${month}-${i}`,
    name: b.name,
    ni: b.ni,
    company,
    month,
    unitsHours: b.hours > 0 ? b.hours + bump : 0,
    bankHolidayHours: b.bh,
    holidayEntitlement: b.hol,
    rate: b.rate,
    holidayRate: b.holidayRate ?? null,
    fixedAmount: b.fixed ?? null,
  }));
}