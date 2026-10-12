/**
 * Payslips: types and arithmetic for the screens and the printed payslip.
 * The money comes from the same lineTotals() the Payroll sheet uses, so the
 * payslip can never disagree with the sheet. The real lines come from
 * src/lib/actions/payslips.ts.
 */
import { lineTotals } from "@/lib/payroll/sheetCalc";

export interface PayslipRow {
  id: string;
  name: string;
  ni: string;
  company: string;
  /** The company's address for the payslip header ("" when none is set). */
  companyAddress: string;
  month: string;
  unitsHours: number;
  bankHolidayHours: number;
  holidayEntitlement: number;
  rate: number;
  holidayRate: number | null;
  uniformCost?: number;
  fixedAmount: number | null;
}

export interface EarningLine {
  label: string;
  hours: number | null;
  rate: number | null;
  amount: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function payslipTotals(p: PayslipRow) {
  return lineTotals({
    unitsHours: p.unitsHours,
    bankHolidayHours: p.bankHolidayHours,
    holidayEntitlement: p.holidayEntitlement,
    rate: p.rate,
    holidayRate: p.holidayRate,
    uniformCost: p.uniformCost ?? 0,
    fixedAmount: p.fixedAmount,
  });
}

/**
 * The lines printed on the payslip. They add up to EXACTLY the same total as the sheet:
 * each amount is taken from a rounded running total, so two separately rounded lines can
 * never end up a penny away from the sheet's figure.
 */
export function earningLines(p: PayslipRow): EarningLine[] {
  const uniform: EarningLine[] =
    (p.uniformCost ?? 0) > 0
      ? [{ label: "Uniform cost", hours: null, rate: null, amount: r2(p.uniformCost!) }]
      : [];
  return [...baseEarningLines({ ...p, uniformCost: 0 }), ...uniform];
}

function baseEarningLines(p: PayslipRow): EarningLine[] {
  if (p.fixedAmount !== null) {
    return [{ label: "Fixed monthly pay", hours: null, rate: null, amount: r2(p.fixedAmount) }];
  }
  const out: EarningLine[] = [];
  const workedPay = r2(p.unitsHours * p.rate);
  // Same order as the sheet: round the total hours first, then multiply by the rate.
  const withBankHoliday = r2(payslipTotals(p).totalHours * p.rate);
  if (p.unitsHours > 0)
    out.push({ label: "Hours worked", hours: p.unitsHours, rate: p.rate, amount: workedPay });
  if (p.bankHolidayHours > 0)
    out.push({
      label: "Bank holiday hours",
      hours: p.bankHolidayHours,
      rate: p.rate,
      amount: r2(withBankHoliday - workedPay),
    });
  if (p.holidayRate !== null && p.holidayEntitlement > 0) {
    const total = payslipTotals(p).amount;
    out.push({
      label: "Holiday pay",
      hours: p.holidayEntitlement,
      rate: p.holidayRate,
      amount: r2(total - withBankHoliday),
    });
  }
  return out;
}

/** Why a payslip should be looked at before it is given out (null = ready). */
export function payslipIssue(p: PayslipRow): string | null {
  if (!p.ni.trim()) return "No NI number";
  if (payslipTotals(p).amount === 0) return "No pay this month";
  if (p.fixedAmount === null && p.rate <= 0 && payslipTotals(p).totalHours > 0) return "Rate is 0";
  return null;
}
