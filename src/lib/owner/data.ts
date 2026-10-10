/**
 * Owner Overview — UI only (sample clients and numbers, nothing is saved).
 * Phase B swaps BASE / TREND / AGEING for real figures from invoices, payments and payroll.
 */
import { round2 } from "@/lib/ledger/calc";

export type Period = "this_week" | "last_week" | "this_month" | "last_month";

export const PERIODS: { value: Period; label: string; factor: number }[] = [
  { value: "this_week", label: "This week", factor: 0.24 },
  { value: "last_week", label: "Last week", factor: 0.26 },
  { value: "this_month", label: "This month", factor: 1 },
  { value: "last_month", label: "Last month", factor: 0.94 },
];

/** A client's margin below this share of what was billed is flagged. Confirm the number with the owner. */
export const LOW_MARGIN = 15;
export const VERY_LOW_MARGIN = 8;

export interface ClientRow {
  id: string;
  client: string;
  hours: number;
  /** Billed, ex VAT. */
  billed: number;
  /** What the staff on this client cost (payroll). */
  staffCost: number;
  received: number;
  /** Still to collect right now (not tied to the period). */
  outstanding: number;
  overdue: number;
}

const BASE: ClientRow[] = [
  { id: "o1", client: "Northgate Retail Ltd", hours: 432, billed: 6264, staffCost: 4752, received: 5100, outstanding: 6762, overdue: 2250 },
  { id: "o2", client: "Docklands Logistics", hours: 296, billed: 4144, staffCost: 3330, received: 2800, outstanding: 10776, overdue: 10776 },
  { id: "o3", client: "Marsh Lane Stores", hours: 176, billed: 2420, staffCost: 1760, received: 2420, outstanding: 3380, overdue: 3380 },
  { id: "o4", client: "Riverside Offices", hours: 178.5, billed: 2713, staffCost: 2410, received: 1830, outstanding: 3660, overdue: 1830 },
  { id: "o5", client: "Harbour Warehousing", hours: 128, billed: 1792, staffCost: 1550, received: 3100, outstanding: 3100, overdue: 3100 },
  { id: "o6", client: "Crest Events", hours: 168, billed: 2688, staffCost: 2250, received: 1920, outstanding: 3370, overdue: 1450 },
  { id: "o7", client: "Alder Court Housing", hours: 240, billed: 3480, staffCost: 2400, received: 3480, outstanding: 0, overdue: 0 },
];

const scale = (n: number, f: number) => round2(n * f);

export function rowsFor(period: Period): ClientRow[] {
  const f = PERIODS.find((p) => p.value === period)?.factor ?? 1;
  return BASE.map((r) => ({
    ...r,
    hours: scale(r.hours, f),
    billed: scale(r.billed, f),
    staffCost: scale(r.staffCost, f),
    received: scale(r.received, f),
  }));
}

export const marginOf = (r: Pick<ClientRow, "billed" | "staffCost">) => round2(r.billed - r.staffCost);
export const marginPct = (r: Pick<ClientRow, "billed" | "staffCost">) =>
  r.billed > 0 ? round2((marginOf(r) / r.billed) * 100) : 0;

export function totals(rows: ClientRow[]) {
  const sum = (k: keyof ClientRow) => round2(rows.reduce((a, r) => a + (r[k] as number), 0));
  const t = { hours: sum("hours"), billed: sum("billed"), staffCost: sum("staffCost"), received: sum("received"), outstanding: sum("outstanding"), overdue: sum("overdue") };
  return { ...t, margin: marginOf(t), marginPct: marginPct(t) };
}

export const marginTone = (pct: number): "good" | "warn" | "bad" =>
  pct < VERY_LOW_MARGIN ? "bad" : pct < LOW_MARGIN ? "warn" : "good";

export function trend(): { label: string; billed: number; received: number }[] {
  const out: { label: string; billed: number; received: number }[] = [];
  const billed = [14200, 15800, 15100, 17400, 16300, 19200];
  const received = [13100, 14900, 15400, 15900, 15600, 17800];
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 5);
  for (let i = 0; i < 6; i++) {
    out.push({ label: d.toLocaleDateString("en-GB", { month: "short" }), billed: billed[i] ?? 0, received: received[i] ?? 0 });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export const AGEING: { label: string; amount: number }[] = [
  { label: "Not yet due", amount: 6800 },
  { label: "1 to 30 days late", amount: 9200 },
  { label: "31 to 60 days late", amount: 3480 },
  { label: "Over 60 days late", amount: 11248 },
];

/** The "in short" sentences, written from the numbers on screen. */
export function summaryLines(period: Period, rows: ClientRow[], money: (n: number) => string): string[] {
  const t = totals(rows);
  const label = (PERIODS.find((p) => p.value === period)?.label ?? "").toLowerCase();
  const lines = [
    `${label[0]?.toUpperCase()}${label.slice(1)}, you billed ${money(t.billed)} and received ${money(t.received)}.`,
    `Staff cost was ${money(t.staffCost)}, which leaves ${money(t.margin)} (${t.marginPct}%).`,
  ];
  const late = rows.filter((r) => r.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  if (late.length > 0)
    lines.push(`${money(t.overdue)} is overdue across ${late.length} clients. The biggest is ${late[0]!.client} with ${money(late[0]!.overdue)}.`);
  const low = rows.filter((r) => marginPct(r) < LOW_MARGIN).sort((a, b) => marginPct(a) - marginPct(b));
  if (low.length > 0)
    lines.push(`${low.length} ${low.length === 1 ? "client has" : "clients have"} a margin under ${LOW_MARGIN}%. The lowest is ${low[0]!.client} at ${marginPct(low[0]!)}%.`);
  return lines;
}
