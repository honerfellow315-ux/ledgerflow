/**
 * Invoice drafts, server side. No auth or request handling here (actions/invoiceDrafts.ts
 * wraps these with permissions).
 *
 * Source of the hours: the Salary Sheet's imported shifts (salary_shifts) for the month,
 * grouped by the client name in the shift export. Each name is matched to ONE client
 * (name, company or account reference, or a link the user saved once). A name that matches
 * nobody, or more than one client, is never guessed: it is listed so the user can link it.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { companies, invoices, settings, hoursEntries } from "../../../drizzle/schema";
import { uid } from "./id";
import { recordActivity } from "./activity";
import { hoursInvoiceAmount, round2, suggestNextInvoiceNumber } from "../ledger/calc";
import { formatMonthLabel } from "../payroll/calc";
import type { Client, Invoice } from "../ledger/types";
import {
  canCreateDraft,
  draftDescription,
  draftState,
  draftTotals,
  nameKey,
  type Draft,
  type UnmatchedName,
} from "../invoiceDrafts/data";

type Actor = Parameters<typeof recordActivity>[0]["actor"];

const num = (v: unknown) => Number(v ?? 0);
const rows = (res: unknown) =>
  ((res as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];

export interface DraftSet {
  periodFound: boolean;
  periodStatus: string;
  drafts: Draft[];
  unmatched: UnmatchedName[];
}

export async function loadDrafts(month: string): Promise<DraftSet> {
  const [period] = await db
    .execute(sql`SELECT id, status FROM salary_periods WHERE month = ${month} LIMIT 1`)
    .then(rows);
  if (!period) return { periodFound: false, periodStatus: "", drafts: [], unmatched: [] };
  const periodId = String(period["id"]);

  const [groups, dupes, clientRows, aliasRows, hoursRows, monthInvoices, runRows, setRows] =
    await Promise.all([
      db
        .execute(
          sql`SELECT client_name AS name, count(*)::int AS shifts, round(sum(hours), 2)::float8 AS hours,
              (count(*) FILTER (WHERE substr(date, 1, 7) <> ${month}))::int AS outside
            FROM salary_shifts WHERE period_id = ${periodId} AND hours > 0
            GROUP BY client_name`,
        )
        .then(rows),
      db
        .execute(
          sql`SELECT client_name AS name, coalesce(sum(c - 1), 0)::int AS dupes FROM (
              SELECT client_name, count(*) AS c FROM salary_shifts
              WHERE period_id = ${periodId} AND hours > 0
              GROUP BY source, client_name, coalesce(nullif(employee_id, ''), employee_name), date, site_name, hours, amount
              HAVING count(*) > 1) t GROUP BY client_name`,
        )
        .then(rows),
      db
        .execute(
          sql`SELECT id, name, company, account_reference, rate::float8 AS rate, status
            FROM clients WHERE deleted_at IS NULL`,
        )
        .then(rows),
      db.execute(sql`SELECT name_key, client_id FROM invoice_draft_aliases`).then(rows),
      db
        .execute(
          sql`SELECT h.client_id, sum(h.total_hours)::float8 AS th, sum(h.payroll_hours)::float8 AS ph,
              max(h.payroll_rate)::float8 AS pr, max(h.rate)::float8 AS r,
              max(i.id) AS invoice_id, max(i.number) AS invoice_number
            FROM hours_entries h LEFT JOIN invoices i ON i.id = h.invoice_id AND i.deleted_at IS NULL
            WHERE h.month = ${month} AND h.deleted_at IS NULL GROUP BY h.client_id`,
        )
        .then(rows),
      db
        .execute(
          sql`SELECT id, number, client_id FROM invoices
            WHERE month = ${month} AND deleted_at IS NULL AND original_invoice_id IS NULL
            ORDER BY number`,
        )
        .then(rows),
      db
        .execute(
          sql`SELECT r.client_id, i.id AS invoice_id, i.number FROM invoice_draft_runs r
            JOIN invoices i ON i.id = r.invoice_id AND i.deleted_at IS NULL WHERE r.month = ${month}`,
        )
        .then(rows),
      db
        .execute(
          sql`SELECT default_vat_rate::float8 AS vat FROM settings WHERE id = 'default' LIMIT 1`,
        )
        .then(rows),
    ]);
  const vatRate = setRows[0] ? num(setRows[0]["vat"]) : 20;

  const clientById = new Map(clientRows.map((c) => [String(c["id"]), c]));
  const byKey = new Map<string, Set<string>>();
  for (const c of clientRows) {
    for (const f of ["name", "company", "account_reference"]) {
      const k = nameKey(String(c[f] ?? ""));
      if (!k) continue;
      const set = byKey.get(k) ?? new Set<string>();
      set.add(String(c["id"]));
      byKey.set(k, set);
    }
  }
  const aliasByKey = new Map<string, string>();
  for (const a of aliasRows) {
    if (clientById.has(String(a["client_id"])))
      aliasByKey.set(String(a["name_key"]), String(a["client_id"]));
  }
  const dupesByName = new Map(dupes.map((d) => [String(d["name"] ?? ""), num(d["dupes"])]));

  interface Acc {
    names: Set<string>;
    shifts: number;
    hours: number;
    outside: number;
    dupes: number;
  }
  const perClient = new Map<string, Acc>();
  const unmatched: UnmatchedName[] = [];
  for (const g of groups) {
    const name = String(g["name"] ?? "");
    const key = nameKey(name);
    let clientId: string | null = null;
    let reason: "none" | "several" = "none";
    if (key) {
      const alias = aliasByKey.get(key);
      if (alias) clientId = alias;
      else {
        const found = byKey.get(key);
        if (found && found.size === 1) clientId = [...found][0] ?? null;
        else if (found && found.size > 1) reason = "several";
      }
    }
    if (!clientId) {
      unmatched.push({
        name: name || "(no client name)",
        shifts: num(g["shifts"]),
        hours: round2(num(g["hours"])),
        reason,
      });
      continue;
    }
    const acc = perClient.get(clientId) ?? {
      names: new Set<string>(),
      shifts: 0,
      hours: 0,
      outside: 0,
      dupes: 0,
    };
    acc.names.add(name);
    acc.shifts += num(g["shifts"]);
    acc.hours += num(g["hours"]);
    acc.outside += num(g["outside"]);
    acc.dupes += dupesByName.get(name) ?? 0;
    perClient.set(clientId, acc);
  }

  const hoursBy = new Map(hoursRows.map((h) => [String(h["client_id"]), h]));
  const invoicedBy = new Map<string, { id: string; number: string }>();
  for (const h of hoursRows) {
    if (h["invoice_id"])
      invoicedBy.set(String(h["client_id"]), {
        id: String(h["invoice_id"]),
        number: String(h["invoice_number"] ?? ""),
      });
  }
  for (const i of monthInvoices)
    invoicedBy.set(String(i["client_id"]), { id: String(i["id"]), number: String(i["number"]) });
  for (const r of runRows)
    invoicedBy.set(String(r["client_id"]), {
      id: String(r["invoice_id"]),
      number: String(r["number"]),
    });

  const drafts: Draft[] = [];
  for (const [clientId, acc] of perClient) {
    const c = clientById.get(clientId);
    if (!c) continue;
    const h = hoursBy.get(clientId);
    const clientRate = c["rate"] === null || c["rate"] === undefined ? 0 : num(c["rate"]);
    const entryRate = h ? num(h["r"]) : 0;
    const rate = clientRate > 0 ? clientRate : entryRate > 0 ? entryRate : null;
    const payrollRate = h && num(h["pr"]) > 0 ? num(h["pr"]) : null;
    const inv = invoicedBy.get(clientId);
    drafts.push({
      id: clientId,
      clientId,
      client: String(c["name"]),
      month,
      shiftNames: [...acc.names].sort(),
      shifts: acc.shifts,
      hours: round2(acc.hours),
      payrollHours: h ? round2(num(h["ph"])) : 0,
      rate,
      payrollRate,
      vatRate,
      hoursEntry: h ? round2(num(h["th"])) : null,
      clientStatus: String(c["status"] ?? "active"),
      duplicateShifts: acc.dupes,
      outsideMonthShifts: acc.outside,
      invoiceId: inv?.id ?? null,
      invoiceNumber: inv?.number ?? null,
    });
  }
  drafts.sort((a, b) => a.client.localeCompare(b.client));
  unmatched.sort((a, b) => b.hours - a.hours);
  return { periodFound: true, periodStatus: String(period["status"] ?? ""), drafts, unmatched };
}

/* ------------------------------------------------------------------ */
/* Creating invoices                                                    */
/* ------------------------------------------------------------------ */

/**
 * Takes the claim for "this client + this month" so the same invoice can never be created
 * twice (double click, two people, two tabs). A claim whose invoice was later deleted can
 * be taken again; a claim with no invoice yet is only taken over after 2 minutes (a request
 * that died half way).
 */
async function claimRun(clientId: string, month: string, byName: string): Promise<boolean> {
  const ins = await db
    .execute(
      sql`INSERT INTO invoice_draft_runs (client_id, month, created_by_name)
          VALUES (${clientId}, ${month}, ${byName})
          ON CONFLICT (client_id, month) DO NOTHING RETURNING client_id`,
    )
    .then(rows);
  if (ins.length > 0) return true;
  const upd = await db
    .execute(
      sql`UPDATE invoice_draft_runs r SET created_by_name = ${byName}, created_at = now(), invoice_id = NULL
          WHERE r.client_id = ${clientId} AND r.month = ${month}
            AND ((r.invoice_id IS NULL AND r.created_at < now() - interval '2 minutes')
                 OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = r.invoice_id AND i.deleted_at IS NOT NULL))
          RETURNING r.client_id`,
    )
    .then(rows);
  return upd.length > 0;
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export interface CreateResult {
  created: { clientId: string; client: string; number: string; invoiceId: string }[];
  skipped: { clientId: string; client: string; reason: string }[];
}

export async function createDraftInvoices(args: {
  actor: Actor;
  month: string;
  clientIds: string[];
  /** Create drafts that only have "soft" warnings (the person said OK to them). */
  allowWarnings: boolean;
}): Promise<CreateResult> {
  const { actor, month, allowWarnings } = args;
  const result: CreateResult = { created: [], skipped: [] };
  const set = await loadDrafts(month);
  if (!set.periodFound) throw new Error("There is no Salary Sheet for that month.");
  const byId = new Map(set.drafts.map((d) => [d.clientId, d]));

  // Data for the next invoice number, same rule as the invoice screen (suggestNextInvoiceNumber).
  const [settingRow] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);
  const companyRows = await db
    .select({ id: companies.id, invoicePrefix: companies.invoicePrefix })
    .from(companies);
  const prefixOfCompany = new Map(companyRows.map((c) => [c.id, c.invoicePrefix]));
  const clientsForNumber = (
    await db.execute(sql`SELECT id, company_id, payment_term_days FROM clients`).then(rows)
  ).map((c) => ({
    id: String(c["id"]),
    companyId: c["company_id"] ? String(c["company_id"]) : null,
    terms: c["payment_term_days"] as number | null,
  }));
  const termsOf = new Map(clientsForNumber.map((c) => [c.id, c.terms]));
  const existing = (
    await db.execute(sql`SELECT number, client_id, invoice_date FROM invoices`).then(rows)
  ).map((i) => ({
    number: String(i["number"]),
    clientId: String(i["client_id"]),
    invoiceDate: String(i["invoice_date"]),
  }));

  const byName = actor?.displayName || actor?.username || "";
  const uniqueIds = [...new Set(args.clientIds)];
  for (const clientId of uniqueIds) {
    const d = byId.get(clientId);
    if (!d) {
      result.skipped.push({
        clientId,
        client: clientId,
        reason: "No shifts for this client this month.",
      });
      continue;
    }
    const st = draftState(d);
    if (st.state === "done") {
      result.skipped.push({
        clientId,
        client: d.client,
        reason: `Already invoiced${d.invoiceNumber ? ` (${d.invoiceNumber})` : ""}.`,
      });
      continue;
    }
    if (!canCreateDraft(st.issues)) {
      result.skipped.push({
        clientId,
        client: d.client,
        reason: st.issues.find((i) => i.kind === "hard")?.text ?? "Needs a look.",
      });
      continue;
    }
    if (st.issues.length > 0 && !allowWarnings) {
      result.skipped.push({
        clientId,
        client: d.client,
        reason: `${st.issues[0]?.text ?? "Needs a look"}. Check it, then create it from the draft.`,
      });
      continue;
    }

    if (!(await claimRun(clientId, month, byName))) {
      result.skipped.push({
        clientId,
        client: d.client,
        reason: "Already invoiced (someone just created it).",
      });
      continue;
    }
    try {
      const t = draftTotals(d);
      const split = t.payrollHours > 0 && t.payrollValue > 0;
      const amountExVat = hoursInvoiceAmount({
        hours: t.hours,
        rate: d.rate ?? 0,
        payrollHours: t.payrollHours,
        payrollRate: d.payrollRate ?? 0,
      });

      const companyId = clientsForNumber.find((c) => c.id === clientId)?.companyId ?? null;
      const companyPrefix = companyId ? prefixOfCompany.get(companyId) : undefined;
      const prefix = companyPrefix?.trim() ? companyPrefix : (settingRow?.invoicePrefix ?? "INV-");
      const number = suggestNextInvoiceNumber({
        invoices: existing as unknown as Invoice[],
        clients: clientsForNumber.map((c) => ({
          id: c.id,
          companyId: c.companyId,
        })) as unknown as Client[],
        clientId,
        prefix,
        fallbackNext: settingRow?.nextInvoiceNumber ?? 1,
      });

      const today = todayIso();
      const termDays = termsOf.get(clientId);
      const days = termDays === null || termDays === undefined ? 30 : termDays;
      const paymentTerms = days === 0 ? "On receipt" : `${days} days`;

      const [row] = await db
        .insert(invoices)
        .values({
          id: uid("inv"),
          number,
          clientId,
          month,
          invoiceDate: today,
          dueDate: plusDays(today, days),
          description: draftDescription(formatMonthLabel(month)),
          amountExVat,
          hours: t.hours,
          rate: d.rate ?? 0,
          payrollHours: split ? t.payrollHours : null,
          payrollRate: split ? d.payrollRate : null,
          vatIncluded: true,
          vatRate: d.vatRate,
          vatMode: t.vatMode,
          vatPaidBefore: split ? t.payrollValue : null,
          paymentTerms,
          approved: false,
        })
        .returning();
      if (!row) throw new Error("The invoice could not be saved.");

      existing.push({ number: row.number, clientId, invoiceDate: row.invoiceDate });
      await db.execute(
        sql`UPDATE invoice_draft_runs SET invoice_id = ${row.id} WHERE client_id = ${clientId} AND month = ${month}`,
      );
      // Link the Hours screen entry for this month (only when it is not linked to an invoice yet).
      await db
        .update(hoursEntries)
        .set({ invoiceId: row.id })
        .where(
          and(
            eq(hoursEntries.clientId, clientId),
            eq(hoursEntries.month, month),
            isNull(hoursEntries.invoiceId),
            isNull(hoursEntries.deletedAt),
          ),
        );
      try {
        await db
          .update(settings)
          .set({ nextInvoiceNumber: sql`${settings.nextInvoiceNumber} + 1` })
          .where(eq(settings.id, "default"));
      } catch (err) {
        console.error("createDraftInvoices: failed to bump nextInvoiceNumber", err);
      }
      await recordActivity({
        actor,
        action: "created",
        module: "invoices",
        entityId: row.id,
        label: `Invoice ${row.number} — ${d.client}`,
        details: `From invoice draft ${month}: ${t.hours} h, ${amountExVat} ex VAT`,
      });
      result.created.push({ clientId, client: d.client, number: row.number, invoiceId: row.id });
    } catch (err) {
      // Give the claim back so the draft can be tried again.
      await db
        .execute(
          sql`DELETE FROM invoice_draft_runs WHERE client_id = ${clientId} AND month = ${month} AND invoice_id IS NULL`,
        )
        .catch(() => undefined);
      throw new Error(
        "Invoice drafts could not be saved. No drafts from this request were committed.",
      );
    }
  }
  return result;
}
