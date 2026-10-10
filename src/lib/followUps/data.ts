/**
 * Overdue follow-ups — UI only (sample clients, nothing is saved).
 * No emails are sent: this is where you note every chase and keep track of promises to pay.
 * Phase B swaps buildClients() for the real overdue invoices and a saved contact history.
 */
import { round2 } from "@/lib/ledger/calc";

export interface OverdueInvoice {
  number: string;
  dueDate: string;
  outstanding: number;
}

export interface Contact {
  id: string;
  at: string;
  method: string;
  note: string;
  by: string;
}

export interface OverdueClient {
  id: string;
  client: string;
  invoices: OverdueInvoice[];
  nextFollowUp: string | null;
  promisedDate: string | null;
  contacts: Contact[];
}

export const METHODS = ["Phone call", "WhatsApp", "Email", "In person", "Other"];

export function dayIso(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** Whole days from one yyyy-mm-dd to another. */
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86400000);

export const daysOverdue = (inv: OverdueInvoice) => Math.max(0, daysBetween(inv.dueDate, dayIso(0)));

export function clientTotals(c: OverdueClient) {
  return {
    overdue: round2(c.invoices.reduce((a, i) => a + i.outstanding, 0)),
    oldest: Math.max(0, ...c.invoices.map(daysOverdue)),
    lastContact: c.contacts.length
      ? [...c.contacts].sort((a, b) => b.at.localeCompare(a.at))[0]!
      : null,
  };
}

export type FollowState = "overdue" | "today" | "later" | "none";

export function followState(c: OverdueClient): FollowState {
  if (!c.nextFollowUp) return "none";
  if (c.nextFollowUp < dayIso(0)) return "overdue";
  if (c.nextFollowUp === dayIso(0)) return "today";
  return "later";
}

export const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "1 to 30 days", min: 1, max: 30 },
  { label: "31 to 60 days", min: 31, max: 60 },
  { label: "61 to 90 days", min: 61, max: 90 },
  { label: "Over 90 days", min: 91, max: Infinity },
];

export function bucketTotals(clients: OverdueClient[]): number[] {
  const all = clients.flatMap((c) => c.invoices);
  return BUCKETS.map((b) =>
    round2(all.filter((i) => daysOverdue(i) >= b.min && daysOverdue(i) <= b.max).reduce((a, i) => a + i.outstanding, 0)),
  );
}

const ago = (days: number, hour = 11) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
};

let seq = 0;
const contact = (daysAgo: number, method: string, note: string): Contact => ({
  id: `c${++seq}`,
  at: ago(daysAgo),
  method,
  note,
  by: "Admin",
});

export function buildClients(): OverdueClient[] {
  const inv = (number: string, dueOffset: number, outstanding: number): OverdueInvoice => ({
    number,
    dueDate: dayIso(dueOffset),
    outstanding,
  });
  return [
    {
      id: "f1",
      client: "Docklands Logistics",
      invoices: [inv("INV-2026-0118", -96, 3480), inv("INV-2026-0131", -41, 7296)],
      nextFollowUp: dayIso(-1),
      promisedDate: null,
      contacts: [
        contact(14, "Phone call", "Spoke to accounts. They said the invoice is with the director for approval."),
        contact(6, "WhatsApp", "No reply yet. Sent the invoice copy again."),
      ],
    },
    {
      id: "f2",
      client: "Harbour Warehousing",
      invoices: [inv("INV-2026-0127", -33, 3100)],
      nextFollowUp: dayIso(0),
      promisedDate: dayIso(4),
      contacts: [contact(3, "Phone call", "Promised to pay on Friday after the bank transfer limit resets.")],
    },
    {
      id: "f3",
      client: "Northgate Retail Ltd",
      invoices: [inv("INV-2026-0136", -22, 2250)],
      nextFollowUp: dayIso(2),
      promisedDate: null,
      contacts: [contact(2, "Email", "Sent a polite reminder with the PO number they asked for.")],
    },
    {
      id: "f4",
      client: "Riverside Offices",
      invoices: [inv("INV-2026-0138", -12, 1830)],
      nextFollowUp: null,
      promisedDate: null,
      contacts: [],
    },
    {
      id: "f5",
      client: "Marsh Lane Stores",
      invoices: [inv("INV-2026-0139", -5, 2420), inv("INV-2026-0140", -3, 960)],
      nextFollowUp: dayIso(1),
      promisedDate: dayIso(6),
      contacts: [contact(1, "In person", "Manager said the payment run is next week.")],
    },
    {
      id: "f6",
      client: "Crest Events",
      invoices: [inv("INV-2026-0099", -128, 1450)],
      nextFollowUp: dayIso(-4),
      promisedDate: null,
      contacts: [
        contact(30, "Phone call", "Number rang out."),
        contact(21, "Email", "No answer. Asked who now handles payments."),
      ],
    },
  ];
}
