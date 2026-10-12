/**
 * Invoice drafts: types and rules shared by the screen and the server.
 *
 * The money here uses the very same functions as the real invoice screen
 * (hoursInvoiceAmount, vatAmount, amountIncVat from lib/ledger/calc), and the server
 * recalculates everything from the database when it creates an invoice. So a draft can
 * never disagree with the invoice it turns into, whatever the browser sends.
 */
import { amountIncVat, hoursInvoiceAmount, round2, vatAmount } from "@/lib/ledger/calc";
import type { Invoice } from "@/lib/ledger/types";

export interface SiteHours {
  site: string;
  shifts: number;
  hours: number;
}

export interface Draft {
  /** The client's id (one draft per client per month). */
  id: string;
  clientId: string;
  client: string;
  month: string;
  /** The client names exactly as they appear in the shift export (one client can have several). */
  shiftNames: string[];
  shifts: number;
  hours: number;
  /** Hours paid through payroll, from the Hours screen entry (0 = none). */
  payrollHours: number;
  rate: number | null;
  payrollRate: number | null;
  vatRate: number;
  /** Hours typed into the Hours screen for this client and month (null = nothing entered). */
  hoursEntry: number | null;
  clientStatus: string;
  duplicateShifts: number;
  outsideMonthShifts: number;
  /** The invoice this month already became (null = not invoiced yet). */
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export type DraftState = "ready" | "check" | "done";

export interface DraftIssue {
  text: string;
  /** hard = the invoice cannot be created until it is fixed; soft = can be created after a deliberate OK. */
  kind: "hard" | "soft";
}

/** Normalises a client name for matching: lower case, letters and digits only. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const h2 = (n: number) => Number(n.toFixed(2));

export function draftTotals(
  d: Pick<Draft, "hours" | "payrollHours" | "rate" | "payrollRate" | "vatRate" | "shifts">,
) {
  const hours = round2(d.hours);
  const rate = d.rate ?? 0;
  const payrollRate = d.payrollRate ?? 0;
  const split = d.payrollHours > 0 && payrollRate > 0;
  const payrollHours = split ? Math.min(round2(d.payrollHours), hours) : 0;
  const exVat = hoursInvoiceAmount({ hours, rate, payrollHours, payrollRate });
  const payrollValue = split ? round2(payrollHours * payrollRate) : 0;
  // Same rule as the invoice screen's payroll split: payroll hours carry no VAT.
  const asInvoice = {
    amountExVat: exVat,
    vatIncluded: true,
    vatRate: d.vatRate,
    vatMode: split ? "remaining" : "full",
    vatPaidBefore: split ? payrollValue : undefined,
  } as Invoice;
  return {
    hours,
    payrollHours,
    normalHours: round2(hours - payrollHours),
    exVat,
    payrollValue,
    /** Rounded so the two lines always add up to the ex-VAT total to the penny. */
    normalValue: round2(exVat - payrollValue),
    vat: vatAmount(asInvoice),
    total: amountIncVat(asInvoice),
    vatMode: (split ? "remaining" : "full") as "full" | "remaining",
    shifts: d.shifts,
  };
}

export function draftIssues(d: Draft): DraftIssue[] {
  const out: DraftIssue[] = [];
  if (d.rate === null || d.rate <= 0)
    out.push({ kind: "hard", text: "No rate set for this client" });
  if (d.hours <= 0) out.push({ kind: "hard", text: "No hours this month" });
  if (d.payrollHours > 0 && (d.payrollRate ?? 0) <= 0) {
    out.push({
      kind: "hard",
      text: "Payroll hours have no payroll rate (set it on the Hours screen)",
    });
  }
  if (d.payrollHours > d.hours + 0.001)
    out.push({ kind: "hard", text: "Payroll hours are more than shift hours" });
  if (d.hoursEntry !== null && Math.abs(d.hoursEntry - d.hours) > 0.001) {
    const diff = round2(d.hours - d.hoursEntry);
    out.push({
      kind: "soft",
      text: `Shifts differ from the Hours screen by ${diff > 0 ? "+" : ""}${h2(diff)} h`,
    });
  }
  if (d.duplicateShifts > 0) {
    out.push({
      kind: "soft",
      text: `${d.duplicateShifts} shift${d.duplicateShifts === 1 ? "" : "s"} look like exact duplicates`,
    });
  }
  if (d.outsideMonthShifts > 0) {
    out.push({
      kind: "soft",
      text: `${d.outsideMonthShifts} shift${d.outsideMonthShifts === 1 ? " is" : "s are"} dated outside this month`,
    });
  }
  if (d.clientStatus !== "active") out.push({ kind: "soft", text: `Client is ${d.clientStatus}` });
  return out;
}

export function draftState(d: Draft): { state: DraftState; text: string; issues: DraftIssue[] } {
  if (d.invoiceId) {
    return {
      state: "done",
      text: d.invoiceNumber ? `Invoiced (${d.invoiceNumber})` : "Already invoiced",
      issues: [],
    };
  }
  const issues = draftIssues(d);
  if (issues.length === 0) return { state: "ready", text: "Ready", issues };
  return { state: "check", text: issues[0]?.text ?? "Needs a look", issues };
}

/** Only drafts with no hard problem can be created, and soft ones only on a deliberate OK. */
export const canCreateDraft = (issues: DraftIssue[]) => issues.every((i) => i.kind === "soft");

/** The description the invoice gets (it can be edited afterwards on the Invoices screen). */
export function draftDescription(monthLabel: string): string {
  return `Security services, ${monthLabel}`;
}

/** A shift-export client name that could not be matched to exactly one client. */
export interface UnmatchedName {
  name: string;
  shifts: number;
  hours: number;
  /** none = no client has this name; several = more than one client has it. */
  reason: "none" | "several";
}
