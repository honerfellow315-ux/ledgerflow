/**
 * Overdue follow-ups: types and small rules shared by the screen and the server.
 * No emails are sent: this is where you note every chase and keep track of promises to pay.
 * The overdue amounts come from src/lib/server/followUps.ts, which uses the same invoice maths
 * as the Statements screen (buildInvoiceViews + applyClientCredit), so the two always agree.
 */

export interface OverdueInvoice {
  id: string;
  number: string;
  dueDate: string;
  /** What is still owed after payments, credit notes and carried-forward credit. */
  outstanding: number;
  daysLate: number;
}

export interface Contact {
  id: string;
  at: string;
  method: string;
  note: string;
  by: string;
}

export type FollowState = "overdue" | "today" | "later" | "none";

/** One row of the list. */
export interface OverdueClient {
  id: string;
  client: string;
  overdue: number;
  invoiceCount: number;
  oldest: number;
  nextFollowUp: string | null;
  promisedDate: string | null;
  /** The promised date has passed and the money is still overdue. */
  promiseMissed: boolean;
  state: FollowState;
  contactCount: number;
  lastContact: { method: string; at: string; note: string } | null;
}

export interface ClientFollowUp {
  id: string;
  client: string;
  invoices: OverdueInvoice[];
  contacts: Contact[];
  /** How many contacts exist in all (the list shows the latest 100). */
  contactCount: number;
}

export const METHODS = ["Phone call", "WhatsApp", "Email", "In person", "Other"];

export const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "1 to 30 days", min: 1, max: 30 },
  { label: "31 to 60 days", min: 31, max: 60 },
  { label: "61 to 90 days", min: 61, max: 90 },
  { label: "Over 90 days", min: 91, max: Infinity },
];

export function followState(next: string | null, today: string): FollowState {
  if (!next) return "none";
  if (next < today) return "overdue";
  if (next === today) return "today";
  return "later";
}

export function dayIso(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const ageTone = (days: number): "warn" | "bad" => (days > 60 ? "bad" : "warn");
