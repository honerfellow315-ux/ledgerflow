import { lockInvoiceNumbers } from "../server/invoiceNumbers";
/**
 * Invoice Drafts server functions.
 *  - Seeing drafts needs Invoices (view) and Salary Sheet (view): the hours come from the
 *    Salary Sheet's shifts and the rates are the invoice rates.
 *  - Creating an invoice, or linking a shift client name to a client, needs Invoices (create).
 * Every figure is recalculated here from the database; the browser only says WHICH drafts.
 */
import { createServerFn } from "@tanstack/react-start";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction } from "../server/db";
import { salaryPeriods } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { recordActivity } from "../server/activity";
import { createDraftInvoices, loadDrafts, type CreateResult } from "../server/invoiceDrafts";
import {
  draftState,
  draftTotals,
  nameKey,
  type Draft,
  type SiteHours,
  type UnmatchedName,
} from "../invoiceDrafts/data";
import { round2 } from "../ledger/calc";

async function requireDraftAccess() {
  await requirePermission("salary", "view");
  return requirePermission("invoices", "view");
}

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

export interface DraftMonth {
  month: string;
  status: string;
}

/** Months that have a Salary Sheet, newest first. */
export const listDraftMonths = createServerFn({ method: "GET" }).handler(
  async (): Promise<DraftMonth[]> => {
    await requireDraftAccess();
    const list = await db
      .select({ month: salaryPeriods.month, status: salaryPeriods.status })
      .from(salaryPeriods)
      .orderBy(desc(salaryPeriods.month))
      .limit(60);
    return list;
  },
);

export type DraftFilter = "all" | "ready" | "check" | "done";

export interface DraftPage {
  periodFound: boolean;
  periodStatus: string;
  rows: Draft[];
  total: number;
  page: number;
  pageSize: number;
  summary: { count: number; ready: number; check: number; done: number; readyExVat: number };
  unmatched: UnmatchedName[];
  unmatchedCount: number;
}

export const listDrafts = createServerFn({ method: "GET" })
  .validator(
    z.object({
      month: monthSchema,
      search: z.string().trim().max(80).default(""),
      filter: z.enum(["all", "ready", "check", "done"]).default("all"),
      page: z.number().int().min(1).max(10000).default(1),
      pageSize: z.number().int().min(5).max(100).default(50),
    }),
  )
  .handler(async ({ data }): Promise<DraftPage> => {
    await requireDraftAccess();
    const set = await loadDrafts(data.month);

    let ready = 0;
    let check = 0;
    let done = 0;
    let readyExVat = 0;
    for (const d of set.drafts) {
      const s = draftState(d).state;
      if (s === "ready") {
        ready++;
        readyExVat += draftTotals(d).exVat;
      } else if (s === "check") check++;
      else done++;
    }

    const needle = data.search.toLowerCase();
    const filtered = set.drafts.filter(
      (d) =>
        (data.filter === "all" || draftState(d).state === data.filter) &&
        (!needle || d.client.toLowerCase().includes(needle)),
    );
    const start = (data.page - 1) * data.pageSize;
    return {
      periodFound: set.periodFound,
      periodStatus: set.periodStatus,
      rows: filtered.slice(start, start + data.pageSize),
      total: filtered.length,
      page: data.page,
      pageSize: data.pageSize,
      summary: { count: set.drafts.length, ready, check, done, readyExVat: round2(readyExVat) },
      unmatched: set.unmatched.slice(0, 50),
      unmatchedCount: set.unmatched.length,
    };
  });

/** Hours per site for one draft ("where the hours come from"). */
export const getDraftSites = createServerFn({ method: "POST" })
  .validator(
    z.object({ month: monthSchema, shiftNames: z.array(z.string().max(300)).min(1).max(50) }),
  )
  .handler(async ({ data }): Promise<SiteHours[]> => {
    await requireDraftAccess();
    const names = sql.join(
      data.shiftNames.map((n) => sql`${n}`),
      sql`, `,
    );
    const res = await db.execute(sql`
      SELECT coalesce(nullif(sh.site_name, ''), '(no site)') AS site, count(*)::int AS shifts,
             round(sum(sh.hours), 2)::float8 AS hours
      FROM salary_shifts sh JOIN salary_periods p ON p.id = sh.period_id
      WHERE p.month = ${data.month} AND sh.hours > 0 AND sh.client_name IN (${names})
      GROUP BY 1 ORDER BY 3 DESC LIMIT 200`);
    return (res.rows as { site: string; shifts: number; hours: number }[]).map((r) => ({
      site: r.site,
      shifts: Number(r.shifts),
      hours: Number(r.hours),
    }));
  });

/** Make invoices from drafts. The server rechecks every draft; nothing is trusted from the browser. */
export const createDrafts = createServerFn({ method: "POST" })
  .validator(
    z.object({
      month: monthSchema,
      clientIds: z.array(z.string().min(1).max(100)).min(1).max(50),
      allowWarnings: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }): Promise<CreateResult> => {
    const actor = await requirePermission("invoices", "create");
    await requirePermission("salary", "view");
    return withTransaction(async () => {
      await lockInvoiceNumbers();
      return createDraftInvoices({
        actor,
        month: data.month,
        clientIds: data.clientIds,
        allowWarnings: data.allowWarnings,
      });
    });
  });

export interface MappableClient {
  id: string;
  name: string;
}

/** Clients a shift name can be linked to. */
export const listMappableClients = createServerFn({ method: "GET" }).handler(
  async (): Promise<MappableClient[]> => {
    await requirePermission("invoices", "create");
    const res = await db.execute(
      sql`SELECT id, name FROM clients WHERE deleted_at IS NULL ORDER BY name LIMIT 2000`,
    );
    return (res.rows as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
  },
);

/** Remember "this name in the shift export is this client". */
export const linkShiftClient = createServerFn({ method: "POST" })
  .validator(
    z.object({
      shiftName: z.string().trim().min(1).max(300),
      clientId: z.string().min(1).max(100),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("invoices", "create");
    const key = nameKey(data.shiftName);
    if (!key) throw new Error("That name has no letters or numbers to match on.");
    const found = await db.execute(
      sql`SELECT name FROM clients WHERE id = ${data.clientId} AND deleted_at IS NULL LIMIT 1`,
    );
    const client = (found.rows[0] as { name: string } | undefined)?.name;
    if (!client) throw new Error("That client no longer exists.");
    await db.execute(sql`
      INSERT INTO invoice_draft_aliases (name_key, shift_name, client_id) VALUES (${key}, ${data.shiftName}, ${data.clientId})
      ON CONFLICT (name_key) DO UPDATE SET client_id = EXCLUDED.client_id, shift_name = EXCLUDED.shift_name`);
    await recordActivity({
      actor,
      action: "updated",
      module: "invoices",
      entityId: data.clientId,
      label: `Invoice draft link — ${data.shiftName} → ${client}`,
    });
    return { ok: true };
  });
