/**
 * Owner Overview, server side (no auth here; actions/owner.ts wraps it).
 *
 * Outstanding and overdue are worked out exactly like Statements and Follow-ups
 * (buildInvoiceViews, then applyClientCredit, overdue = past due date), so the three screens
 * always agree. Billed, received and staff cost follow the rules at the top of lib/owner/data.ts.
 */
import { isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { clients, creditNotes, invoices, payments } from "../../../drizzle/schema";
import { stripNullsAll } from "./normalize";
import { londonToday } from "./followUps";
import {
  DEDUCTING_CREDIT_STATUSES,
  applyClientCredit,
  buildInvoiceViews,
  round2,
} from "../ledger/calc";
import { INCLUDE_EXPENSES_AND_PENALTY } from "../payroll/calc";
import type { Client, CreditNote, Invoice, Payment } from "../ledger/types";
import { nameKey } from "../invoiceDrafts/data";
import {
  UNLINKED_ID,
  lastMonths,
  periodRange,
  type ClientRow,
  type Overview,
  type Period,
  type TrendMonth,
} from "../owner/data";

const num = (v: unknown) => Number(v ?? 0);
const rowsOf = (res: unknown) =>
  ((res as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];

/** The month an invoice belongs to: its own Month, else the month of its invoice date. */
export const serviceMonth = (i: Pick<Invoice, "month" | "invoiceDate">): string =>
  i.month && /^\d{4}-\d{2}$/.test(i.month) ? i.month : i.invoiceDate.slice(0, 7);

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const monthLabel = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m;

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

export async function loadOverview(period: Period): Promise<Overview> {
  const today = londonToday();
  const range = periodRange(period, today);
  const months = lastMonths(today, 6);
  const notes: string[] = [];

  const costExpr = INCLUDE_EXPENSES_AND_PENALTY ? sql`(amount + expenses - penalty)` : sql`amount`;

  const [invRows, payRows, cnRows, clientRows, shiftGroups, aliasRows, noDate] = await Promise.all([
    db.select().from(invoices).where(isNull(invoices.deletedAt)),
    db.select().from(payments).where(isNull(payments.deletedAt)),
    db.select().from(creditNotes).where(isNull(creditNotes.deletedAt)),
    db.select().from(clients).where(isNull(clients.deletedAt)),
    db.execute(
      sql`SELECT client_name AS name, count(*)::int AS shifts, round(sum(hours), 2)::float8 AS hours,
            round(sum(${costExpr}), 2)::float8 AS cost
          FROM salary_shifts WHERE date >= ${range.from} AND date <= ${range.to}
          GROUP BY client_name`,
    ),
    db.execute(sql`SELECT name_key, client_id FROM invoice_draft_aliases`),
    range.month
      ? db.execute(
          sql`SELECT count(*)::int AS n FROM salary_shifts s JOIN salary_periods p ON p.id = s.period_id
              WHERE s.date = '' AND p.month = ${range.month}`,
        )
      : Promise.resolve(null),
  ]);

  const invs = stripNullsAll(invRows) as unknown as Invoice[];
  const pays = stripNullsAll(payRows) as unknown as Payment[];
  const cns = stripNullsAll(cnRows) as unknown as CreditNote[];
  const cls = stripNullsAll(clientRows) as unknown as Client[];
  const nameOf = new Map(cls.map((c) => [c.id, c.name]));

  /* ---- per-client accumulator ---- */
  const acc = new Map<string, ClientRow>();
  const row = (id: string): ClientRow => {
    let r = acc.get(id);
    if (!r) {
      r = {
        id,
        client: id === UNLINKED_ID ? "Not linked to a client" : (nameOf.get(id) ?? "—"),
        hours: 0,
        billed: 0,
        staffCost: 0,
        received: 0,
        outstanding: 0,
        overdue: 0,
      };
      acc.set(id, r);
    }
    return r;
  };

  /* ---- billed (invoices less deducting credit notes) ---- */
  let noServiceMonth = 0;
  for (const i of invs) {
    if (!nameOf.has(i.clientId)) continue;
    const hit =
      range.kind === "month"
        ? serviceMonth(i) === range.month
        : inRange(i.invoiceDate, range.from, range.to);
    if (!hit) continue;
    row(i.clientId).billed += i.amountExVat;
    if (range.kind === "month" && !(i.month && /^\d{4}-\d{2}$/.test(i.month))) noServiceMonth += 1;
  }
  const deducting = DEDUCTING_CREDIT_STATUSES as readonly string[];
  for (const n of cns) {
    if (!nameOf.has(n.clientId) || !deducting.includes(n.status)) continue;
    if (inRange(n.date, range.from, range.to)) row(n.clientId).billed -= n.amountExVat;
  }
  if (noServiceMonth > 0)
    notes.push(
      `${noServiceMonth} ${noServiceMonth === 1 ? "invoice has" : "invoices have"} no Month set, so ${noServiceMonth === 1 ? "it is" : "they are"} counted in the month of ${noServiceMonth === 1 ? "its" : "their"} invoice date.`,
    );

  /* ---- received (payments dated in the period) ---- */
  for (const p of pays) {
    if (!nameOf.has(p.clientId)) continue;
    if (inRange(p.date, range.from, range.to)) row(p.clientId).received += p.amount;
  }

  /* ---- staff cost: shifts, matched to ONE client by name (same rule as Invoice Drafts) ---- */
  const byKey = new Map<string, Set<string>>();
  for (const c of cls) {
    for (const v of [c.name, c.company, c.accountReference]) {
      const k = nameKey(String(v ?? ""));
      if (!k) continue;
      const set = byKey.get(k) ?? new Set<string>();
      set.add(c.id);
      byKey.set(k, set);
    }
  }
  const alias = new Map<string, string>();
  for (const a of rowsOf(aliasRows)) {
    if (nameOf.has(String(a["client_id"])))
      alias.set(String(a["name_key"]), String(a["client_id"]));
  }
  const unlinkedNames = new Set<string>();
  for (const g of rowsOf(shiftGroups)) {
    const name = String(g["name"] ?? "");
    const key = nameKey(name);
    let clientId: string | null = null;
    if (key) {
      clientId = alias.get(key) ?? null;
      if (!clientId) {
        const found = byKey.get(key);
        if (found && found.size === 1) clientId = [...found][0] ?? null;
      }
    }
    const target = row(clientId ?? UNLINKED_ID);
    target.hours += num(g["hours"]);
    target.staffCost += num(g["cost"]);
    if (!clientId) unlinkedNames.add(name || "(no client name)");
  }
  if (unlinkedNames.size > 0)
    notes.push(
      `Shifts for ${unlinkedNames.size} client ${unlinkedNames.size === 1 ? "name" : "names"} are not linked to one client (${[...unlinkedNames].slice(0, 5).join(", ")}${unlinkedNames.size > 5 ? ", ..." : ""}). Their cost is shown on the "Not linked to a client" row.`,
    );
  const dateless = noDate ? num(rowsOf(noDate)[0]?.["n"]) : 0;
  if (dateless > 0)
    notes.push(
      `${dateless} ${dateless === 1 ? "shift in" : "shifts in"} this month's Salary Sheet ${dateless === 1 ? "has" : "have"} no date, so ${dateless === 1 ? "its" : "their"} cost is missing from these numbers.`,
    );

  /* ---- outstanding, overdue and ageing: same maths as Statements / Follow-ups ---- */
  const views = buildInvoiceViews(invs, pays, cls, cns);
  const byClient = new Map<string, typeof views>();
  for (const v of views) byClient.set(v.clientId, [...(byClient.get(v.clientId) ?? []), v]);
  const ageing = [0, 0, 0, 0];
  for (const c of cls) {
    const { views: withCredit } = applyClientCredit(byClient.get(c.id) ?? []);
    for (const v of withCredit) {
      const owed = v.effectiveOutstanding;
      if (owed <= 0.004) continue;
      const r = row(c.id);
      r.outstanding += owed;
      if (v.ageing > 0) r.overdue += owed;
      ageing[v.ageing <= 0 ? 0 : v.ageing <= 30 ? 1 : v.ageing <= 60 ? 2 : 3]! += owed;
    }
  }

  /* ---- six-month trend: billed by service month, received by payment month ---- */
  const trend: TrendMonth[] = months.map((m) => ({
    month: m,
    label: monthLabel(m),
    billed: 0,
    received: 0,
  }));
  const at = new Map(trend.map((t) => [t.month, t]));
  for (const i of invs) {
    if (!nameOf.has(i.clientId)) continue;
    const t = at.get(serviceMonth(i));
    if (t) t.billed += i.amountExVat;
  }
  for (const n of cns) {
    if (!nameOf.has(n.clientId) || !deducting.includes(n.status)) continue;
    const t = at.get(n.date.slice(0, 7));
    if (t) t.billed -= n.amountExVat;
  }
  for (const p of pays) {
    if (!nameOf.has(p.clientId)) continue;
    const t = at.get(p.date.slice(0, 7));
    if (t) t.received += p.amount;
  }

  const rows: ClientRow[] = [...acc.values()]
    .map((r) => ({
      ...r,
      hours: round2(r.hours),
      billed: round2(r.billed),
      staffCost: round2(r.staffCost),
      received: round2(r.received),
      outstanding: round2(r.outstanding),
      overdue: round2(r.overdue),
    }))
    .filter(
      (r) =>
        r.hours !== 0 ||
        r.billed !== 0 ||
        r.staffCost !== 0 ||
        r.received !== 0 ||
        r.outstanding > 0.004,
    )
    .sort((a, b) => a.client.localeCompare(b.client));

  return {
    today,
    range,
    rows,
    trend: trend.map((t) => ({ ...t, billed: round2(t.billed), received: round2(t.received) })),
    ageing: [
      { label: "Not yet due", amount: round2(ageing[0]!) },
      { label: "1 to 30 days late", amount: round2(ageing[1]!) },
      { label: "31 to 60 days late", amount: round2(ageing[2]!) },
      { label: "Over 60 days late", amount: round2(ageing[3]!) },
    ],
    notes,
  };
}
