/**
 * Shared (client + server) types for the salary sheet. Mirrors the
 * payroll_* / salary_* tables in drizzle/schema.ts, with nulls dropped.
 */

export type ShiftSource = "RSS" | "ESS";
export type CheckStatus = "" | "Reviewed" | "Verified";
export type PeriodStatus = "draft" | "reviewed" | "verified" | "closed";
export type PayStatus = "Current" | "OverPaid" | "Paid in Full";

export interface Staff {
  id: string;
  rssId: string;
  essId: string;
  ni: string;
  name: string;
  tag: string;
  accountDetail: string;
  area: string;
  notes?: string;
  active: boolean;
}

export interface PayrollCompany {
  id: string;
  name: string;
  orderIndex: number;
  active: boolean;
}

export interface SalaryPeriod {
  id: string;
  /** yyyy-mm */
  month: string;
  status: PeriodStatus;
  notes?: string;
}

export interface SalaryEntry {
  id: string;
  periodId: string;
  staffId: string;
  rssAmount: number;
  rssHours: number;
  essAmount: number;
  essHours: number;
  /** -OverPaid / +Remaining carried from the previous month. */
  carryForward: number;
  taxDeduction: number;
  deduction: number;
  deductionNote?: string;
  checkStatus: CheckStatus;
  /** The sheet's free-text "Client" column (e.g. "pay back"). */
  flag: string;
  /** { payrollCompanyId: amount } */
  payroll: Record<string, number>;
}

export interface SalaryPayment {
  id: string;
  entryId: string;
  /** yyyy-mm-dd */
  date: string;
  amount: number;
  method: string;
  reference: string;
  notes?: string;
}

/** One parsed line of a raw shift export (RSS / ESS). */
export interface ShiftRowInput {
  employeeId: string;
  employeeName: string;
  ni: string;
  date: string;
  clientName: string;
  siteName: string;
  hours: number;
  rate: number;
  amount: number;
  expenses: number;
  penalty: number;
  accountDetail: string;
  tag: string;
}

/** One parsed line of an existing Excel "Salary Sheet". */
export interface MasterRowInput {
  rssId: string;
  essId: string;
  ni: string;
  tag: string;
  name: string;
  rssAmount: number;
  rssHours: number;
  essAmount: number;
  essHours: number;
  carryForward: number;
  checkStatus: CheckStatus;
  /** keyed by the payroll company's NAME as written in the file header */
  payroll: Record<string, number>;
  taxDeduction: number;
  /** P1..Pn */
  payments: number[];
  deduction: number;
  accountDetail: string;
  flag: string;
  area: string;
}

export interface PeriodSheet {
  period: SalaryPeriod;
  entries: SalaryEntry[];
  payments: SalaryPayment[];
  staff: Staff[];
  companies: PayrollCompany[];
  /** Shifts in the raw import that couldn't be matched to anyone. */
  unmatchedShifts: number;
  shiftCounts: { RSS: number; ESS: number };
}
