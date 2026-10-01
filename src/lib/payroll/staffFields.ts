/**
 * Small shared helpers for the staff detail fields ("All Payroll Format"):
 * the dropdown suggestions of the report, age from DOB, and the cheap
 * warnings shown on the Staff page. Pure functions — no server access.
 */
import type { Staff, StaffDetailField } from "./types";

/** Suggestions for the free-text fields (same lists as the report's Excel dropdowns). */
export const GENDER_OPTIONS = ["Male", "Female"] as const;
export const COMMENT_OPTIONS = [
  "Account Change",
  "Address Change",
  "Request for P45",
  "Holiday entitlement",
  "New Staff",
  "SIA SUSPENDED",
  "VISA ISSUE",
  "Reinstate",
] as const;
export const IMMIGRATION_OPTIONS = [
  "British",
  "EU- Stettlement",
  "EU- Pre Stettlement",
  "Student- study Completed",
  "Spouse/Partner",
  "Dependent",
  "Student Route",
  "Graduate Route",
  "leave to remain",
  "Refugee",
  "ARC",
  "Fee Wiver",
  "Skill Worker",
] as const;
export const HOURS_ALLOWED_OPTIONS = [
  "Standard",
  "20 Hours/Week",
  "10 Hours/Week",
  "No Work Allow",
] as const;
export const ROLE_OPTIONS = ["Front Line", "Non Fornt Line", "N/A"] as const;
export const SERVICE_OPTIONS = [
  "Door Supervisor",
  "Security Guarding",
  "Close Protection",
  "Key Holding",
  "CCTV",
  "N/A",
] as const;

/** Share-code warning window, in days. */
export const SHARE_CODE_WARN_DAYS = 60;

const isIso = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Parses yyyy-mm-dd as a UTC date (so time zones can't shift the day). */
function isoToUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const todayUtc = (): number => {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
};

/** Whole years between a yyyy-mm-dd DOB and today; "" when there is no valid DOB. */
export function ageFromDob(dob: string | undefined, now: Date = new Date()): number | "" {
  if (!isIso(dob)) return "";
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return "";
  let age = now.getFullYear() - y;
  const beforeBirthday = now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : "";
}

/** Days from today to the share-code expiry (negative = already passed); null if not set. */
export function daysToShareCodeExpiry(staff: {
  shareCodeExpiry?: string | undefined;
}): number | null {
  if (!isIso(staff.shareCodeExpiry)) return null;
  return Math.round((isoToUtc(staff.shareCodeExpiry) - todayUtc()) / 86_400_000);
}

export type ShareCodeState = "expired" | "soon" | "ok" | "none";

export function shareCodeState(staff: { shareCodeExpiry?: string | undefined }): ShareCodeState {
  const days = daysToShareCodeExpiry(staff);
  if (days === null) return "none";
  if (days < 0) return "expired";
  if (days <= SHARE_CODE_WARN_DAYS) return "soon";
  return "ok";
}

/** Active staff whose contract is still running (not already on a P45). */
export const isWorking = (s: Staff): boolean => s.active && s.contractStatus !== "P45";

/** yyyy-mm-dd -> dd/mm/yyyy for display ("" stays ""). */
export function displayDate(iso: string | undefined): string {
  if (!isIso(iso)) return iso ?? "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Report column names, for previews. */
export const STAFF_FIELD_LABEL: Record<StaffDetailField, string> = {
  dob: "DOB",
  gender: "Gender",
  rtwShareCode: "RTW share code",
  shareCodeExpiry: "Share code expiry",
  address: "Address",
  town: "Town",
  postCode: "Post code",
  uniform: "Uniform",
  accountHolderName: "Account holder name",
  accountNumber: "Account number",
  sortCode: "Sort code",
  employmentStartDate: "Employment start date",
  employmentEndDate: "End date",
  contractStatus: "Status",
  email: "Email",
  immigrationStatus: "Immigration status",
  hoursAllowed: "Hours of work allowed",
  siaNumber: "SIA number",
  role: "Role",
  serviceType: "Services type",
};
