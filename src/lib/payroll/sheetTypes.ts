/**
 * Shared (client + server) types for the Payroll sheet ("All Payroll Format").
 * One sheet = one payroll company x one month; one line = one staff member.
 * A person is ONE staff record and may be on the sheets of several companies.
 */
import type { PeriodStatus, Staff } from "./types";

/** Payroll company incl. the fields only the payroll sheet uses. */
export interface PayrollSheetCompany {
  id: string;
  name: string;
  orderIndex: number;
  active: boolean;
  /** Default hourly rate for staff who have no rate of their own. */
  defaultRate: number;
  address?: string;
  notes?: string;
  /** Active staff attached to this company. */
  staffCount: number;
}

/** A person's membership of one payroll company. */
export interface CompanyStaffLink {
  id: string;
  companyId: string;
  staffId: string;
  active: boolean;
  /** null = use the company's default rate */
  rate: number | null;
  startDate?: string;
  endDate?: string;
}

export interface PayrollSheetInfo {
  id: string;
  companyId: string;
  /** yyyy-mm */
  month: string;
  status: PeriodStatus;
  notes?: string;
}

export interface PayrollLine {
  id: string;
  sheetId: string;
  staffId: string;
  unitsHours: number;
  bankHolidayHours: number;
  /** Information only — not part of Total Hours (matches the Excel formula). */
  holidayEntitlement: number;
  comment: string;
  rate: number;
}

/**
 * Staff as the payroll sheet receives them. Without the "staff" permission only the
 * non-sensitive fields are present (no NI, DOB, address, bank details, e-mail ...).
 */
export type PayrollSheetStaff = Staff;

export interface PayrollSheetData {
  sheet: PayrollSheetInfo;
  company: PayrollSheetCompany;
  lines: PayrollLine[];
  staff: PayrollSheetStaff[];
  links: CompanyStaffLink[];
  /** false when the viewer lacks the "staff" permission (personal/banking columns hidden) */
  canSeeStaffDetails: boolean;
}

/** Suggestions for the Comment dropdown (same list as the report's Excel dropdown). */
export const PAYROLL_COMMENTS = [
  "Account Change",
  "Address Change",
  "Request for P45",
  "Holiday entitlement",
  "New Staff",
  "SIA SUSPENDED",
  "VISA ISSUE",
  "Reinstate",
] as const;

export interface PushToSalaryResult {
  month: string;
  createdPeriod: boolean;
  updated: number;
  skipped: number;
}
