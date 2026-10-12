/**
 * Bank Match, server side (no auth here; actions/bankMatch.ts wraps it with permissions).
 *
 * Money rules:
 *  - A payment is only ever recorded when a person confirms (or presses "Confirm all matched",
 *    where the server first works out the match again for every line).
 *  - The invoice's outstanding amount is worked out from the database at the moment of
 *    confirming (the same buildInvoiceViews the Invoices and Statements screens use), never
 *    taken from the browser. A payment can never be more than what is still owed.
 *  - A line is claimed with one UPDATE ... WHERE status = 'open', so a double click or two
 *    people confirming the same line cannot record two payments.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "./db";
import { clients, creditNotes, invoices, payments } from "../../../drizzle/schema";
import { stripNullsAll } from "./normalize";
import { uid } from "./id";
import { recordActivity } from "./activity";
import { buildInvoiceViews, formatMoney, round2 } from "../ledger/calc";
import type { Client, CreditNote, Invoice, Payment } from "../ledger/types";
import {
  duplicateWarning,
  matchLine,
  overpays,
  payerKey,
  squash,
  type BankLine,
  type LineStatus,
  type OpenInvoice,
  type StatementInfo,
} from "../bankMatch/data";

type Actor = Parameters<typeof recordActivity>[0]["actor"];
const rows = (res: unknown) =>
  ((res as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
const str = (v: unknown) => String(v ?? "");

export const byName = (a: NonNullable<Actor>) => a.displayName || a.username;

/* ------------------------------ open invoices ------------------------------ */

function toOpen(
  v: ReturnType<typeof buildInvoiceViews>[number],
  pays: { date: string; amount: number }[],
): OpenInvoice {
  return {
    id: v.id,
    number: v.number,
    clientId: v.clientId,
    client: v.clientName,
    outstanding: round2(v.outstanding),
    dueDate: v.dueDate ?? "",
    payments: pays,
  };
}

const payList = (all: Payment[], invoiceId: string) =>
  all
    .filter((p) => p.invoiceId === invoiceId)
    .map((p) => ({ date: p.date, amount: Number(p.amount) }));

/** Every invoice that still has money outstanding (after payments, credit notes, VAT rules). */
export async function loadOpenInvoices(): Promise<OpenInvoice[]> {
  const [invRows, payRows, cnRows, clientRows] = await Promise.all([
    db.select().from(invoices).where(isNull(invoices.deletedAt)),
    db.select().from(payments).where(isNull(payments.deletedAt)),
    db.select().from(creditNotes).where(isNull(creditNotes.deletedAt)),
    db.select().from(clients).where(isNull(clients.deletedAt)),
  ]);
  const pays = stripNullsAll(payRows) as unknown as Payment[];
  const views = buildInvoiceViews(
    stripNullsAll(invRows) as unknown as Invoice[],
    pays,
    stripNullsAll(clientRows) as unknown as Client[],
    stripNullsAll(cnRows) as unknown as CreditNote[],
  );
  const live = new Set(clientRows.map((c) => c.id));
  return views
    .filter((v) => live.has(v.clientId) && v.outstanding > 0.004)
    .map((v) => toOpen(v, payList(pays, v.id)));
}

/** One invoice, fresh from the database. Null when it is gone, or nothing is owed any more. */
export async function loadOneOpen(invoiceId: string): Promise<OpenInvoice | null> {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)))
    .limit(1);
  if (!inv) return null;
  const [payRows, cnRows, clientRows] = await Promise.all([
    db
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), isNull(payments.deletedAt))),
    db
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.invoiceId, invoiceId), isNull(creditNotes.deletedAt))),
    db
      .select()
      .from(clients)
      .where(and(eq(clients.id, inv.clientId), isNull(clients.deletedAt))),
  ]);
  if (clientRows.length === 0) return null;
  const pays = stripNullsAll(payRows) as unknown as Payment[];
  const [view] = buildInvoiceViews(
    stripNullsAll([inv]) as unknown as Invoice[],
    pays,
    stripNullsAll(clientRows) as unknown as Client[],
    stripNullsAll(cnRows) as unknown as CreditNote[],
  );
  if (!view || view.outstanding <= 0.004) return null;
  return toOpen(view, payList(pays, invoiceId));
}

/* ------------------------------ list ------------------------------ */

export interface BankListData {
  lines: BankLine[];
  statements: StatementInfo[];
  counts: Record<LineStatus, number>;
  waitingTotal: number;
}

interface RawLine {
  id: string;
  statementId: string;
  date: string;
  description: string;
  amount: number;
  status: "open" | "confirmed" | "ignored";
  invoiceId: string | null;
}

const rawLine = (r: Record<string, unknown>): RawLine => ({
  id: str(r["id"]),
  statementId: str(r["statement_id"]),
  date: str(r["date"]),
  description: str(r["description"]),
  amount: Number(r["amount"]),
  status: str(r["status"]) as RawLine["status"],
  invoiceId: r["invoice_id"] ? str(r["invoice_id"]) : null,
});

async function linkedClients(keys: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(keys.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const res = rows(
    await db.execute(
      sql`SELECT payer_key, client_id FROM bank_payer_links WHERE payer_key IN (${sql.join(
        uniq.map((k) => sql`${k}`),
        sql`, `,
      )})`,
    ),
  );
  return new Map(res.map((r) => [str(r["payer_key"]), str(r["client_id"])]));
}

/** All waiting lines (matched fresh against today's open invoices) and the latest decided ones. */
export async function loadBank(): Promise<BankListData & { open: OpenInvoice[] }> {
  const [openRes, doneRes, stmtRes, countRes, open] = await Promise.all([
    db.execute(
      sql`SELECT id, statement_id, date, description, amount, status, invoice_id FROM bank_lines WHERE status = 'open' ORDER BY date DESC, line_no`,
    ),
    db.execute(
      sql`SELECT id, statement_id, date, description, amount, status, invoice_id FROM bank_lines WHERE status <> 'open' ORDER BY decided_at DESC NULLS LAST LIMIT 1000`,
    ),
    db.execute(sql`
      SELECT s.id, s.file_name, s.line_count, s.skipped_out, s.uploaded_by, s.uploaded_at,
             (SELECT count(*)::int FROM bank_lines l WHERE l.statement_id = s.id AND l.status = 'confirmed') AS confirmed
      FROM bank_statements s ORDER BY s.uploaded_at DESC LIMIT 30`),
    db.execute(
      sql`SELECT status, count(*)::int AS n FROM bank_lines WHERE status <> 'open' GROUP BY status`,
    ),
    loadOpenInvoices(),
  ]);
  const openLines = rows(openRes).map(rawLine);
  const links = await linkedClients(openLines.map((l) => payerKey(l.description)));

  const counts: Record<LineStatus, number> = {
    matched: 0,
    review: 0,
    none: 0,
    confirmed: 0,
    ignored: 0,
  };
  for (const r of rows(countRes))
    counts[str(r["status"]) as "confirmed" | "ignored"] = Number(r["n"]);
  let waitingTotal = 0;

  const lines: BankLine[] = openLines.map((l) => {
    const m = matchLine(l, open, links.get(payerKey(l.description)) ?? null);
    counts[m.status]++;
    waitingTotal += l.amount;
    return {
      id: l.id,
      statementId: l.statementId,
      date: l.date,
      description: l.description,
      amount: l.amount,
      status: m.status,
      invoiceId: m.invoiceId,
      reason: m.reason,
      candidateIds: m.candidateIds,
    };
  });
  for (const l of rows(doneRes).map(rawLine)) {
    lines.push({
      id: l.id,
      statementId: l.statementId,
      date: l.date,
      description: l.description,
      amount: l.amount,
      status: l.status === "confirmed" ? "confirmed" : "ignored",
      invoiceId: l.invoiceId,
      reason: l.status === "confirmed" ? "Recorded as a payment." : "Ignored by you.",
      candidateIds: [],
    });
  }
  const statements: StatementInfo[] = rows(stmtRes).map((r) => ({
    id: str(r["id"]),
    fileName: str(r["file_name"]),
    lineCount: Number(r["line_count"]),
    skippedOut: Number(r["skipped_out"]),
    uploadedBy: str(r["uploaded_by"]),
    uploadedAt: new Date(str(r["uploaded_at"])).toISOString(),
    confirmed: Number(r["confirmed"]),
  }));
  return { lines, statements, counts, waitingTotal: round2(waitingTotal), open };
}

/** Number and client for invoices shown on a page (a confirmed line's invoice may be fully paid now). */
export async function invoiceLabels(
  ids: string[],
): Promise<Record<string, { number: string; client: string }>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return {};
  const res = rows(
    await db.execute(
      sql`SELECT i.id, i.number, c.name AS client FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id IN (${sql.join(
        uniq.map((k) => sql`${k}`),
        sql`, `,
      )})`,
    ),
  );
  return Object.fromEntries(
    res.map((r) => [str(r["id"]), { number: str(r["number"]), client: str(r["client"]) }]),
  );
}

/* ------------------------------ upload ------------------------------ */

export interface UploadLine {
  lineNo: number;
  date: string;
  description: string;
  amount: number;
}

export interface UploadResult {
  statementId: string;
  added: number;
  alreadyThere: number;
}

export async function saveStatement(
  actor: NonNullable<Actor>,
  input: { fileName: string; fileHash: string; skippedOut: number; lines: UploadLine[] },
): Promise<UploadResult> {
  const dup = rows(
    await db.execute(
      sql`SELECT file_name, uploaded_at FROM bank_statements WHERE file_hash = ${input.fileHash} LIMIT 1`,
    ),
  )[0];
  if (dup) {
    throw new Error(
      `This exact file was already uploaded as "${str(dup["file_name"])}" on ${new Date(str(dup["uploaded_at"])).toLocaleDateString("en-GB")}.`,
    );
  }
  const statementId = uid("bs");
  await db.execute(sql`
    INSERT INTO bank_statements (id, file_name, file_hash, line_count, skipped_out, uploaded_by)
    VALUES (${statementId}, ${input.fileName}, ${input.fileHash}, 0, ${input.skippedOut}, ${byName(actor)})`);
  try {
    // Same date + amount + text inside one file are different payments: the n-th one gets key ":n".
    // The same line in an overlapping statement gets the same key and is skipped.
    const seen = new Map<string, number>();
    const prepared = input.lines.map((l) => {
      const base = createHash("sha256")
        .update(`${l.date}|${l.amount.toFixed(2)}|${squash(l.description)}`)
        .digest("hex")
        .slice(0, 32);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...l, id: uid("bl"), key: `${base}:${n}` };
    });
    let added = 0;
    for (let i = 0; i < prepared.length; i += 400) {
      const chunk = prepared.slice(i, i + 400);
      const values = chunk.map(
        (l) =>
          sql`(${l.id}, ${statementId}, ${l.lineNo}, ${l.date}, ${l.description}, ${l.amount}, ${l.key})`,
      );
      const ins = rows(
        await db.execute(sql`
          INSERT INTO bank_lines (id, statement_id, line_no, date, description, amount, dedupe_key)
          VALUES ${sql.join(values, sql`, `)} ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`),
      );
      added += ins.length;
    }
    await db.execute(
      sql`UPDATE bank_statements SET line_count = ${added} WHERE id = ${statementId}`,
    );
    await recordActivity({
      actor,
      action: "created",
      module: "payments",
      entityId: statementId,
      label: `Bank statement ${input.fileName}`,
      details: `${added} new payments in${input.lines.length - added > 0 ? `, ${input.lines.length - added} already uploaded before` : ""}`,
    });
    return { statementId, added, alreadyThere: input.lines.length - added };
  } catch (err) {
    await db
      .execute(sql`DELETE FROM bank_statements WHERE id = ${statementId}`)
      .catch(() => undefined);
    console.error("saveStatement failed", err);
    throw new Error("The statement could not be saved. Nothing was added.");
  }
}

export async function removeStatement(actor: NonNullable<Actor>, id: string): Promise<void> {
  const [s] = rows(await db.execute(sql`SELECT file_name FROM bank_statements WHERE id = ${id}`));
  if (!s) throw new Error("This statement no longer exists.");
  const [c] = rows(
    await db.execute(
      sql`SELECT count(*)::int AS n FROM bank_lines WHERE statement_id = ${id} AND status = 'confirmed'`,
    ),
  );
  if (Number(c?.["n"]) > 0) {
    throw new Error(
      "Some payments from this statement are already recorded. Undo them first, then delete the statement.",
    );
  }
  await db.execute(sql`DELETE FROM bank_statements WHERE id = ${id}`);
  await recordActivity({
    actor,
    action: "deleted",
    module: "payments",
    entityId: id,
    label: `Bank statement ${str(s["file_name"])}`,
  });
}

/* ------------------------------ confirm / ignore / undo ------------------------------ */

export type ConfirmResult =
  { ok: true; paymentId: string } | { ok: false; reason: string; needsTick?: boolean };

const fail = (reason: string, needsTick = false): ConfirmResult => ({
  ok: false,
  reason,
  ...(needsTick ? { needsTick } : {}),
});

/**
 * Records ONE bank line as a payment on ONE invoice. Every check is made here, on fresh data.
 * `learn` remembers "this bank name = this client" (only for choices a person made by hand).
 */
export async function confirmOne(
  actor: NonNullable<Actor>,
  p: { lineId: string; invoiceId: string; recordAnyway: boolean; learn: boolean },
): Promise<ConfirmResult> {
  const [line] = rows(
    await db.execute(
      sql`SELECT id, statement_id, date, description, amount, status FROM bank_lines WHERE id = ${p.lineId}`,
    ),
  ).map(rawLine);
  if (!line) return fail("This bank line no longer exists.");
  if (line.status !== "open") return fail("This line was already dealt with.");

  const inv = await loadOneOpen(p.invoiceId);
  if (!inv) return fail("This invoice has nothing outstanding any more, or no longer exists.");
  if (overpays(line.amount, inv)) {
    return fail(
      `The payment (${formatMoney(line.amount)}) is more than what is owed on ${inv.number} (${formatMoney(inv.outstanding)}). Record the extra by hand in Payments.`,
    );
  }
  const warn = duplicateWarning(line, inv);
  if (warn && !p.recordAnyway)
    return fail(`${warn} Tick "record anyway" if this is a second payment.`, true);

  const claim = rows(
    await db.execute(sql`
      UPDATE bank_lines SET status = 'confirmed', invoice_id = ${inv.id}, decided_by = ${byName(actor)}, decided_at = now()
      WHERE id = ${line.id} AND status = 'open' RETURNING id`),
  );
  if (claim.length === 0) return fail("This line was just dealt with by someone else.");

  const giveBack = () =>
    db
      .execute(
        sql`UPDATE bank_lines SET status = 'open', invoice_id = NULL, payment_id = NULL, decided_by = '', decided_at = NULL WHERE id = ${line.id}`,
      )
      .catch(() => undefined);

  const paymentId = uid("pm");
  try {
    await db.insert(payments).values({
      id: paymentId,
      invoiceId: inv.id,
      clientId: inv.clientId,
      date: line.date,
      method: "Bank Transfer",
      amount: line.amount,
      reference: line.description.slice(0, 200),
      notes: "Recorded from Bank Match",
    });
  } catch (err) {
    console.error("confirmOne: payment insert failed", err);
    await giveBack();
    return fail("The payment could not be saved. Nothing was recorded.");
  }

  // Two different lines confirmed at the same moment could together pay more than is owed:
  // look again; if the invoice is now overpaid, take this payment back.
  const after = await loadOneOpen(inv.id);
  const overpaid = after === null ? await isOverpaid(inv.id) : false;
  if (overpaid) {
    await db
      .update(payments)
      .set({ deletedAt: new Date() })
      .where(eq(payments.id, paymentId))
      .catch(() => undefined);
    await giveBack();
    return fail(
      "Another payment was recorded on this invoice at the same moment. Check the invoice and try again.",
    );
  }

  await db.execute(sql`UPDATE bank_lines SET payment_id = ${paymentId} WHERE id = ${line.id}`);
  if (p.learn) {
    const key = payerKey(line.description);
    if (key.length >= 3) {
      await db
        .execute(
          sql`INSERT INTO bank_payer_links (payer_key, client_id) VALUES (${key}, ${inv.clientId}) ON CONFLICT (payer_key) DO UPDATE SET client_id = EXCLUDED.client_id`,
        )
        .catch(() => undefined);
    }
  }
  await recordActivity({
    actor,
    action: "created",
    module: "payments",
    entityId: paymentId,
    label: `Payment of ${formatMoney(line.amount)} — ${inv.client}`,
    details: `From Bank Match, invoice ${inv.number}`,
  });
  return { ok: true, paymentId };
}

/** True when an invoice (that showed nothing outstanding) has been paid MORE than its total. */
async function isOverpaid(invoiceId: string): Promise<boolean> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) return false;
  const [payRows, cnRows, clientRows] = await Promise.all([
    db
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), isNull(payments.deletedAt))),
    db
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.invoiceId, invoiceId), isNull(creditNotes.deletedAt))),
    db.select().from(clients).where(eq(clients.id, inv.clientId)),
  ]);
  const [v] = buildInvoiceViews(
    stripNullsAll([inv]) as unknown as Invoice[],
    stripNullsAll(payRows) as unknown as Payment[],
    stripNullsAll(clientRows) as unknown as Client[],
    stripNullsAll(cnRows) as unknown as CreditNote[],
  );
  return !!v && v.outstanding < -0.004;
}

export async function ignoreLine(actor: NonNullable<Actor>, lineId: string): Promise<boolean> {
  const r = rows(
    await db.execute(
      sql`UPDATE bank_lines SET status = 'ignored', decided_by = ${byName(actor)}, decided_at = now() WHERE id = ${lineId} AND status = 'open' RETURNING id`,
    ),
  );
  return r.length > 0;
}

/** Puts an ignored line back; for a confirmed line it also removes the payment it created. */
export async function reopenLine(
  actor: NonNullable<Actor>,
  lineId: string,
  mayDeletePayment: boolean,
): Promise<ConfirmResult | { ok: true; paymentId: null }> {
  const [l] = rows(
    await db.execute(
      sql`SELECT id, status, payment_id, amount, description FROM bank_lines WHERE id = ${lineId}`,
    ),
  );
  if (!l) return fail("This bank line no longer exists.");
  const status = str(l["status"]);
  if (status === "open") return fail("This line is already waiting.");
  if (status === "confirmed") {
    if (!mayDeletePayment)
      return fail("You may not remove payments. Ask someone with Payments delete access.");
    const claim = rows(
      await db.execute(
        sql`UPDATE bank_lines SET status = 'open', decided_by = '', decided_at = NULL WHERE id = ${lineId} AND status = 'confirmed' RETURNING id`,
      ),
    );
    if (claim.length === 0) return fail("This line was just changed by someone else.");
    const pid = l["payment_id"] ? str(l["payment_id"]) : null;
    if (pid) {
      await db
        .update(payments)
        .set({ deletedAt: new Date() })
        .where(and(eq(payments.id, pid), isNull(payments.deletedAt)));
      await recordActivity({
        actor,
        action: "deleted",
        module: "payments",
        entityId: pid,
        label: `Payment of ${formatMoney(Number(l["amount"]))}`,
        details: "Undone from Bank Match",
      });
    }
    await db.execute(
      sql`UPDATE bank_lines SET invoice_id = NULL, payment_id = NULL WHERE id = ${lineId}`,
    );
    return { ok: true, paymentId: null };
  }
  await db.execute(
    sql`UPDATE bank_lines SET status = 'open', decided_by = '', decided_at = NULL WHERE id = ${lineId} AND status = 'ignored'`,
  );
  return { ok: true, paymentId: null };
}
