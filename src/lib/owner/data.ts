/**
 * Owner Overview: types and the small rules shared by the screen and the server.
 * No sample data any more. The numbers come from src/lib/server/ownerOverview.ts.
 *
 * Plain rules, so nobody is surprised:
 *  - Billed = invoice amounts ex VAT, less issued/applied credit notes.
 *      * For a WEEK: invoices dated in that week.
 *      * For a MONTH: invoices for that service month (the invoice's Month; if it has none,
 *        the month of its invoice date).
 *  - Staff cost = what the shifts in the period paid (salary_shifts amount), put under the client
 *    the shift export names. A name that is not linked to one client goes to "Not linked to a client".
 *  - Margin = billed - staff cost, shown for whole MONTHS only. Invoices are raised once a month, so a
 *    week's margin would mislead. It does not include employer NI, pension or other overheads.
 *  - Received = payments dated in the period (cash, VAT included).
 *  - Outstanding / overdue = right now, worked out exactly like Statements and Follow-ups.
 */
import { round2 } from "@/lib/ledger/calc";

export type Period = "this_week" | "last_week" | "this_month" | "last_month";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
];

/** A client's margin below this share of what was billed is flagged. Confirm the number with the owner. */
export const LOW_MARGIN = 15;
export const VERY_LOW_MARGIN = 8;

/** Row id for staff cost whose client name is not linked to one client. */
export const UNLINKED_ID = "__unlinked__";

export interface PeriodRange {
  period: Period;
  label: string;
  kind: "week" | "month";
  /** Inclusive, yyyy-mm-dd. */
  from: string;
  to: string;
  /** yyyy-mm, month periods only. */
  month: string | null;
  /** The period is not over yet (it ends today or later). */
  inProgress: boolean;
}

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};
/** Monday of the week that contains `iso` (UK weeks run Monday to Sunday). */
const mondayOf = (iso: string) => addDays(iso, -((parse(iso).getUTCDay() + 6) % 7));

export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/** `n` month keys (yyyy-mm), oldest first, ending with the month of `today`. */
export function lastMonths(today: string, n: number): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    out.push(fmt(d).slice(0, 7));
  }
  return out;
}

export function periodRange(period: Period, today: string): PeriodRange {
  const label = PERIODS.find((p) => p.value === period)?.label ?? "";
  if (period === "this_week" || period === "last_week") {
    const mon = mondayOf(today);
    const from = period === "this_week" ? mon : addDays(mon, -7);
    const sun = addDays(from, 6);
    const to = period === "this_week" ? today : sun;
    return {
      period,
      label,
      kind: "week",
      from,
      to,
      month: null,
      inProgress: period === "this_week" && to <= sun,
    };
  }
  const thisMonth = monthKeyOf(today);
  const month = period === "this_month" ? thisMonth : lastMonths(today, 2)[0]!;
  const from = `${month}-01`;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lastDay = fmt(new Date(Date.UTC(y, m, 0)));
  return {
    period,
    label,
    kind: "month",
    from,
    to: period === "this_month" ? today : lastDay,
    month,
    inProgress: period === "this_month",
  };
}

export interface ClientRow {
  id: string;
  client: string;
  /** Hours the staff worked for this client in the period. */
  hours: number;
  /** Billed in the period, ex VAT, after credit notes. */
  billed: number;
  /** What the shifts for this client paid. */
  staffCost: number;
  /** Cash received in the period (VAT included). */
  received: number;
  /** Still to collect right now (not tied to the period). VAT included. */
  outstanding: number;
  overdue: number;
}

export interface TrendMonth {
  month: string;
  label: string;
  billed: number;
  received: number;
}

export interface Overview {
  today: string;
  range: PeriodRange;
  rows: ClientRow[];
  trend: TrendMonth[];
  ageing: { label: string; amount: number }[];
  /** Things the owner should know before trusting the numbers (data gaps). */
  notes: string[];
}

export const marginOf = (r: Pick<ClientRow, "billed" | "staffCost">) =>
  round2(r.billed - r.staffCost);

/** null when nothing was billed: a margin of "-100%" would only mislead. */
export const marginPct = (r: Pick<ClientRow, "billed" | "staffCost">): number | null =>
  r.billed > 0 ? round2((marginOf(r) / r.billed) * 100) : null;

export function totals(rows: ClientRow[]) {
  const sum = (k: Exclude<keyof ClientRow, "id" | "client">) =>
    round2(rows.reduce((a, r) => a + r[k], 0));
  const t = {
    hours: sum("hours"),
    billed: sum("billed"),
    staffCost: sum("staffCost"),
    received: sum("received"),
    outstanding: sum("outstanding"),
    overdue: sum("overdue"),
  };
  return { ...t, margin: marginOf(t), marginPct: marginPct(t) };
}

export const marginTone = (pct: number): "good" | "warn" | "bad" =>
  pct < VERY_LOW_MARGIN ? "bad" : pct < LOW_MARGIN ? "warn" : "good";

/** Clients (not the "not linked" row) with a real margin that is under the limit, lowest first. */
export function lowMarginRows(rows: ClientRow[]): ClientRow[] {
  return rows
    .filter((r) => r.id !== UNLINKED_ID && r.billed > 0 && (marginPct(r) ?? 100) < LOW_MARGIN)
    .sort((a, b) => (marginPct(a) ?? 0) - (marginPct(b) ?? 0));
}

/** Clients that cost staff money but have nothing billed for the period. */
export function unbilledRows(rows: ClientRow[]): ClientRow[] {
  return rows.filter((r) => r.id !== UNLINKED_ID && r.billed <= 0 && r.staffCost > 0);
}

/** The "in short" sentences, written from the numbers on screen. */
export function summaryLines(
  range: PeriodRange,
  rows: ClientRow[],
  money: (n: number) => string,
): string[] {
  const t = totals(rows);
  const lines: string[] = [];
  const when = range.label;

  if (range.kind === "week") {
    lines.push(
      `${when}, you invoiced ${money(t.billed)} (ex VAT) and received ${money(t.received)}.`,
    );
    lines.push(
      `Staff cost for shifts worked was ${money(t.staffCost)} over ${t.hours} hours. Margin is shown for whole months only, because invoices are raised monthly.`,
    );
  } else {
    lines.push(
      `${when}, you billed ${money(t.billed)} (ex VAT) and received ${money(t.received)}.`,
    );
    if (t.billed > 0 && t.marginPct !== null) {
      lines.push(
        `Staff cost was ${money(t.staffCost)}, which leaves ${money(t.margin)} (${t.marginPct}%).`,
      );
    } else if (t.staffCost > 0) {
      lines.push(
        `Staff cost was ${money(t.staffCost)}, but nothing is billed for this month yet, so there is no margin to show.`,
      );
    }
    if (range.inProgress && t.billed > 0) {
      lines.push(
        "The month is not over yet, so the margin will move as more shifts and invoices come in.",
      );
    }
  }

  const late = rows.filter((r) => r.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  if (late.length > 0)
    lines.push(
      `Right now ${money(t.overdue)} is overdue across ${late.length} ${late.length === 1 ? "client" : "clients"}. The biggest is ${late[0]!.client} with ${money(late[0]!.overdue)}.`,
    );
  else if (t.outstanding > 0)
    lines.push(`Right now nothing is overdue. ${money(t.outstanding)} is still to collect.`);
  else lines.push("Right now every invoice is paid.");

  if (range.kind === "month") {
    const low = lowMarginRows(rows);
    if (low.length > 0)
      lines.push(
        `${low.length} ${low.length === 1 ? "client has" : "clients have"} a margin under ${LOW_MARGIN}%. The lowest is ${low[0]!.client} at ${marginPct(low[0]!)}%.`,
      );
    const unbilled = unbilledRows(rows);
    if (unbilled.length > 0) {
      const cost = round2(unbilled.reduce((a, r) => a + r.staffCost, 0));
      lines.push(
        `${unbilled.length} ${unbilled.length === 1 ? "client has" : "clients have"} staff cost (${money(cost)}) but no invoice for this month yet.`,
      );
    }
  }
  const unlinked = rows.find((r) => r.id === UNLINKED_ID);
  if (unlinked && unlinked.staffCost > 0)
    lines.push(
      `${money(unlinked.staffCost)} of staff cost (${unlinked.hours} hours) is not linked to a client. Link those names in Invoice Drafts so it lands on the right client.`,
    );
  return lines;
}
