/**
 * Shared (client + server) types for the salary sheet. Mirrors the
 * payroll_* / salary_* tables in drizzle/schema.ts, with nulls dropped.
 */

/** Code of a shift company ("RSS", "ESS", or any company added later). */
export type ShiftSource = string;
/** RSS and ESS have their own columns on staff / salary lines; every other code lives in extIds / extra. */
export const BUILT_IN_SHIFTS = ["RSS", "ESS"] as const;
export const isBuiltInShift = (code: string): boolean =>
  (BUILT_IN_SHIFTS as readonly string[]).includes(code);

/** A company that supplies raw shift exports (managed by the user, RSS and ESS are seeded). */
export interface ShiftCompany {
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

/** What one non-RSS/ESS shift company contributed to a salary line. */
export type ExtraEarnings = Record<string, { amount: number; hours: number }>;
export type CheckStatus = "" | "Reviewed" | "Verified";
export type PeriodStatus = "draft" | "reviewed" | "verified" | "closed";
export type PayStatus = "Current" | "OverPaid" | "Paid in Full";

/** Allowed values of a staff member's contract status (the report's "Status" column). */
export const CONTRACT_STATUSES = ["Active", "P45", "Need P45"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/**
 * The personal / banking / contract / SIA fields of a staff member (the columns
 * of the "All Payroll Format" report). All optional: an empty value is simply
 * absent. Dates are yyyy-mm-dd text. Age is never stored — it is computed from dob.
 * These are sensitive and only ever sent to users with the "staff" permission.
 */
export const STAFF_DETAIL_FIELDS = [
  "dob",
  "gender",
  "rtwShareCode",
  "shareCodeExpiry",
  "address",
  "town",
  "postCode",
  "uniform",
  "accountHolderName",
  "accountNumber",
  "sortCode",
  "employmentStartDate",
  "employmentEndDate",
  "contractStatus",
  "email",
  "immigrationStatus",
  "hoursAllowed",
  "siaNumber",
  "role",
  "serviceType",
] as const;
export type StaffDetailField = (typeof STAFF_DETAIL_FIELDS)[number];
export type StaffDetails = { [K in StaffDetailField]?: string };

export interface Staff extends StaffDetails {
  id: string;
  rssId: string;
  essId: string;
  /** The person's ID inside every other shift company: { code: id }. */
  extIds: Record<string, string>;
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
  /** Earnings from every other shift company: { code: { amount, hours } }. */
  extra: ExtraEarnings;
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

/** One parsed line of a raw shift export (any shift company). */
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
  /** Imported shift count per shift company code. */
  shiftCounts: Record<string, number>;
}

/** One person's line of the "Employee details" import preview / result. */
export interface StaffDetailsImportRow {
  /** Name as written in the file (never NI / bank values). */
  name: string;
  status: "matched" | "notFound" | "ambiguous" | "niConflict";
  /** Detail fields that were empty on the staff record and get filled from the file. */
  fills: StaffDetailField[];
}

export interface StaffDetailsImportResult {
  rows: StaffDetailsImportRow[];
}

/** One shift company's line in the "Check data" report. */
export interface ImportCheckSummary {
  source: string;
  shifts: number;
  people: number;
  hours: number;
  amount: number;
}

export interface ImportCheckIssue {
  level: "error" | "warn";
  /** Stable key, used as the list key. */
  code: string;
  title: string;
  count: number;
  hint: string;
  examples: string[];
}

/** Result of the month's data checks (read-only). */
export interface ImportCheckReport {
  summary: ImportCheckSummary[];
  issues: ImportCheckIssue[];
}
