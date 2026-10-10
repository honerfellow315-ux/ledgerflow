/**
 * Bank Match — UI only (sample bank lines and invoices, nothing is saved).
 * Phase B swaps buildLines() / OPEN_INVOICES for the uploaded statement and the real open invoices.
 */
import { formatMoney, round2 } from "@/lib/ledger/calc";

export type LineStatus = "matched" | "review" | "none" | "confirmed" | "ignored";

export interface OpenInvoice {
  id: string;
  number: string;
  client: string;
  outstanding: number;
  dueDate: string;
}

export interface BankLine {
  id: string;
  date: string;
  description: string;
  /** Money in (a payment received). */
  amount: number;
  status: LineStatus;
  invoiceId: string | null;
  /** Why the system picked this invoice (or why it could not). */
  reason: string;
}

const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const OPEN_INVOICES: OpenInvoice[] = [
  { id: "i142", number: "INV-2026-0142", client: "Northgate Retail Ltd", outstanding: 4512, dueDate: day(5) },
  { id: "i139", number: "INV-2026-0139", client: "Marsh Lane Stores", outstanding: 2420, dueDate: day(-3) },
  { id: "i131", number: "INV-2026-0131", client: "Docklands Logistics", outstanding: 7296, dueDate: day(-12) },
  { id: "i144", number: "INV-2026-0144", client: "Riverside Offices", outstanding: 1830, dueDate: day(9) },
  { id: "i138", number: "INV-2026-0138", client: "Riverside Offices", outstanding: 1830, dueDate: day(-8) },
  { id: "i127", number: "INV-2026-0127", client: "Harbour Warehousing", outstanding: 3100, dueDate: day(-20) },
  { id: "i145", number: "INV-2026-0145", client: "Crest Events", outstanding: 1920, dueDate: day(14) },
  { id: "i136", number: "INV-2026-0136", client: "Northgate Retail Ltd", outstanding: 2250, dueDate: day(-15) },
];

export const invoiceById = (id: string | null): OpenInvoice | undefined =>
  id ? OPEN_INVOICES.find((i) => i.id === id) : undefined;

export function buildLines(): BankLine[] {
  const l = (
    id: string,
    offset: number,
    description: string,
    amount: number,
    status: LineStatus,
    invoiceId: string | null,
    reason: string,
  ): BankLine => ({ id, date: day(offset), description, amount, status, invoiceId, reason });
  return [
    l("b1", -1, "FASTER PAYMENT NORTHGATE RETAIL INV-2026-0142", 4512, "matched", "i142", "Invoice number is in the reference and the amount is exact."),
    l("b2", -1, "BACS MARSH LANE STORES 0139", 2420, "matched", "i139", "Client name and invoice number found, amount is exact."),
    l("b3", -2, "CHAPS DOCKLANDS LOGISTICS", 6000, "review", "i131", "Client name found, but the amount is less than the invoice."),
    l("b4", -2, "FP RIVERSIDE OFFICES LTD", 1830, "review", "i138", "Two Riverside invoices have exactly this amount. Pick the right one."),
    l("b5", -3, "CASH DEPOSIT", 300, "none", null, "Nothing in the reference points to a client."),
    l("b6", -3, "FASTER PAYMENT H WAREHOUSING 0127", 3100, "matched", "i127", "Invoice number found and the amount is exact."),
    l("b7", -4, "CREST EVENTS PAYMENT", 1920, "matched", "i145", "Client name found and the amount is exact."),
    l("b8", -5, "STANDING ORDER ACME", 150, "none", null, "No client or invoice looks like this."),
    l("b9", -6, "BACS NORTHGATE RETAIL", 900, "review", "i136", "Client name found, but no invoice has this amount."),
    l("b10", -7, "FP MARSH LANE STORES", 1100, "confirmed", null, "Matched by you earlier."),
  ];
}

export function compareAmount(amount: number, inv: OpenInvoice): { label: string; tone: "good" | "warn" } {
  const diff = round2(inv.outstanding - amount);
  if (Math.abs(diff) < 0.005) return { label: "Exact amount", tone: "good" };
  if (diff > 0) return { label: `Part payment, ${formatMoney(diff)} would remain`, tone: "warn" };
  return { label: `${formatMoney(-diff)} more than the invoice`, tone: "warn" };
}

/** Open invoices, best guess first: reference, then client name, then closest amount. */
export function suggestions(line: BankLine): OpenInvoice[] {
  const text = line.description.toLowerCase();
  const rank = (inv: OpenInvoice) => {
    const num = inv.number.toLowerCase();
    const short = num.slice(-4);
    const byNumber = text.includes(num) || text.includes(short);
    const byName = text.includes((inv.client.split(" ")[0] ?? "").toLowerCase());
    return (byNumber ? 0 : byName ? 1 : 2) * 1_000_000 + Math.abs(line.amount - inv.outstanding);
  };
  return [...OPEN_INVOICES].sort((a, b) => rank(a) - rank(b));
}
