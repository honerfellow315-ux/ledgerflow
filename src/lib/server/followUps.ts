/**
 * Overdue follow-ups, server side (no auth here; actions/followUps.ts wraps it).
 * The overdue amount of a client is worked out exactly like the Statements screen:
 * buildInvoiceViews (payments, credit notes, VAT) then applyClientCredit (carried-forward
 * overpayments), and only invoices past their due date count.
 */
import { and, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { clients, creditNotes, invoices, payments } from "../../../drizzle/schema";
import { stripNullsAll } from "./normalize";
import { applyClientCredit, buildInvoiceViews, round2 } from "../ledger/calc";
import type { Client, CreditNote, Invoice, Payment } from "../ledger/types";
import { BUCKETS, followState, type OverdueClient, type OverdueInvoice } from "../followUps/data";

/** Today's date in the UK (the business is UK based), yyyy-mm-dd. */
export function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

export interface OverdueSet {
  today: string;
  /** Per client, with its overdue invoices. */
  clients: (OverdueClient & { invoices: OverdueInvoice[] })[];
  buckets: number[];
}

export async function loadOverdue(): Promise<OverdueSet> {
  const today = londonToday();
  // Only clients that have at least one invoice past its due date; their WHOLE account is
  // loaded so payments, credit notes and carried-forward credit are exact.
  const owing = sql`SELECT DISTINCT client_id FROM invoices WHERE deleted_at IS NULL AND due_date < ${today}`;
  const invRows = stripNullsAll(
    await db
      .select()
      .from(invoices)
      .where(and(isNull(invoices.deletedAt), sql`${invoices.clientId} IN (${owing})`)),
  ) as unknown as Invoice[];
  if (invRows.length === 0) return { today, clients: [], buckets: BUCKETS.map(() => 0) };
  const payRows = stripNullsAll(
    await db
      .select()
      .from(payments)
      .where(and(isNull(payments.deletedAt), sql`${payments.clientId} IN (${owing})`)),
  ) as unknown as Payment[];
  const cnRows = stripNullsAll(
    await db
      .select()
      .from(creditNotes)
      .where(and(isNull(creditNotes.deletedAt), sql`${creditNotes.clientId} IN (${owing})`)),
  ) as unknown as CreditNote[];
  const clientRows = stripNullsAll(
    await db
      .select()
      .from(clients)
      .where(and(isNull(clients.deletedAt), sql`${clients.id} IN (${owing})`)),
  ) as unknown as Client[];
  const stateRes = await db.execute(
    sql`SELECT client_id, next_follow_up, promised_date FROM follow_up_state`,
  );
  const stateBy = new Map(
    (
      stateRes.rows as {
        client_id: string;
        next_follow_up: string | null;
        promised_date: string | null;
      }[]
    ).map((r) => [r.client_id, r]),
  );
  const contactRes = await db.execute(sql`
    SELECT DISTINCT ON (client_id) client_id, method, note, at,
           count(*) OVER (PARTITION BY client_id)::int AS n
    FROM follow_up_contacts WHERE client_id IN (${owing}) ORDER BY client_id, at DESC`);
  const contactBy = new Map(
    (
      contactRes.rows as {
        client_id: string;
        method: string;
        note: string;
        at: Date | string;
        n: number;
      }[]
    ).map((r) => [r.client_id, r]),
  );

  const views = buildInvoiceViews(invRows, payRows, clientRows, cnRows);
  const byClient = new Map<string, typeof views>();
  for (const v of views) byClient.set(v.clientId, [...(byClient.get(v.clientId) ?? []), v]);

  const out: OverdueSet["clients"] = [];
  const allLate: number[][] = [];
  for (const c of clientRows) {
    const { views: withCredit } = applyClientCredit(byClient.get(c.id) ?? []);
    const late = withCredit.filter((v) => v.effectiveOutstanding > 0.004 && v.ageing > 0);
    if (late.length === 0) continue;
    const overdue = round2(late.reduce((a, v) => a + v.effectiveOutstanding, 0));
    const st = stateBy.get(c.id);
    const ct = contactBy.get(c.id);
    const promised = st?.promised_date ?? null;
    for (const v of late) allLate.push([v.ageing, v.effectiveOutstanding]);
    out.push({
      id: c.id,
      client: c.name,
      overdue,
      invoiceCount: late.length,
      oldest: Math.max(...late.map((v) => v.ageing)),
      nextFollowUp: st?.next_follow_up ?? null,
      promisedDate: promised,
      promiseMissed: promised !== null && promised < today,
      state: followState(st?.next_follow_up ?? null, today),
      contactCount: ct?.n ?? 0,
      lastContact: ct
        ? { method: ct.method, note: ct.note, at: new Date(ct.at).toISOString() }
        : null,
      invoices: late
        .sort((a, b) => b.ageing - a.ageing)
        .map((v) => ({
          id: v.id,
          number: v.number,
          dueDate: v.dueDate,
          outstanding: v.effectiveOutstanding,
          daysLate: v.ageing,
        })),
    });
  }
  const buckets = BUCKETS.map((b) =>
    round2(
      allLate.filter(([age]) => age! >= b.min && age! <= b.max).reduce((a, [, amt]) => a + amt!, 0),
    ),
  );
  return { today, clients: out, buckets };
}
