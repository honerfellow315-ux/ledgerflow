/**
 * Overdue Follow-ups server functions.
 *  - Seeing the list needs Follow-ups (view) and Invoices (view), because it shows invoice amounts.
 *  - Logging a chase needs Follow-ups (create).
 * Nothing is emailed. The overdue figures are worked out on the server (src/lib/server/followUps.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { requirePermission } from "../server/auth";
import { recordActivity } from "../server/activity";
import { uid } from "../server/id";
import { round2 } from "../ledger/calc";
import { isRealDay } from "../tasks/rules";
import { loadOverdue } from "../server/followUps";
import { METHODS, type ClientFollowUp, type Contact, type OverdueClient } from "../followUps/data";

async function requireFollowUpAccess() {
  await requirePermission("invoices", "view");
  return requirePermission("followUps", "view");
}

const URGENCY = { overdue: 0, today: 1, none: 2, later: 3 } as const;

export type FollowFilter = "all" | "due" | "promised" | "never";

export interface FollowUpPage {
  today: string;
  rows: OverdueClient[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    overdue: number;
    clients: number;
    due: number;
    promised: number;
    never: number;
    buckets: number[];
  };
}

export const listFollowUps = createServerFn({ method: "GET" })
  .validator(
    z.object({
      filter: z.enum(["all", "due", "promised", "never"]).default("all"),
      search: z.string().trim().max(80).default(""),
      page: z.number().int().min(1).max(10000).default(1),
      pageSize: z.number().int().min(5).max(100).default(50),
    }),
  )
  .handler(async ({ data }): Promise<FollowUpPage> => {
    await requireFollowUpAccess();
    const set = await loadOverdue();
    const all = set.clients;

    const needle = data.search.toLowerCase();
    const filtered = all
      .filter((c) => {
        if (data.filter === "due") return c.state === "overdue" || c.state === "today";
        if (data.filter === "promised") return c.promisedDate !== null;
        if (data.filter === "never") return c.contactCount === 0;
        return true;
      })
      .filter((c) => (needle ? c.client.toLowerCase().includes(needle) : true))
      .sort(
        (a, b) =>
          URGENCY[a.state] - URGENCY[b.state] ||
          b.overdue - a.overdue ||
          a.client.localeCompare(b.client),
      );

    const start = (data.page - 1) * data.pageSize;
    return {
      today: set.today,
      rows: filtered.slice(start, start + data.pageSize).map(({ invoices: _inv, ...row }) => row),
      total: filtered.length,
      page: data.page,
      pageSize: data.pageSize,
      summary: {
        overdue: round2(all.reduce((a, c) => a + c.overdue, 0)),
        clients: all.length,
        due: all.filter((c) => c.state === "overdue" || c.state === "today").length,
        promised: all.filter((c) => c.promisedDate !== null).length,
        never: all.filter((c) => c.contactCount === 0).length,
        buckets: set.buckets,
      },
    };
  });

/** One client: the overdue invoices and the contact history (latest 100). */
export const getClientFollowUp = createServerFn({ method: "POST" })
  .validator(z.object({ clientId: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<ClientFollowUp> => {
    await requireFollowUpAccess();
    const set = await loadOverdue();
    const c = set.clients.find((x) => x.id === data.clientId);
    if (!c) throw new Error("This client has nothing overdue any more.");
    const res = await db.execute(sql`
      SELECT id, at, method, note, by_name FROM follow_up_contacts
      WHERE client_id = ${data.clientId} ORDER BY at DESC LIMIT 100`);
    const contacts: Contact[] = (
      res.rows as { id: string; at: Date | string; method: string; note: string; by_name: string }[]
    ).map((r) => ({
      id: r.id,
      at: new Date(r.at).toISOString(),
      method: r.method,
      note: r.note,
      by: r.by_name,
    }));
    return {
      id: c.id,
      client: c.client,
      invoices: c.invoices,
      contacts,
      contactCount: c.contactCount,
    };
  });

const day = z.string().refine(isRealDay, "That is not a real date.");

/** Saves one chase and where the client stands now (next chase, promised date). */
export const logFollowUp = createServerFn({ method: "POST" })
  .validator(
    z.object({
      clientId: z.string().min(1).max(100),
      method: z.string().refine((m) => METHODS.includes(m), "Choose how you chased."),
      note: z.string().trim().min(1, "Write what happened.").max(2000),
      /** null = no promise (clears an old one). */
      promisedDate: day.nullable(),
      nextFollowUp: day.nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("followUps", "create");
    const found = await db.execute(
      sql`SELECT name FROM clients WHERE id = ${data.clientId} AND deleted_at IS NULL LIMIT 1`,
    );
    const client = (found.rows[0] as { name: string } | undefined)?.name;
    if (!client) throw new Error("That client no longer exists.");
    const id = uid("fu");
    const who = actor.displayName || actor.username;
    await db.execute(sql`
      INSERT INTO follow_up_contacts (id, client_id, method, note, by_id, by_name)
      VALUES (${id}, ${data.clientId}, ${data.method}, ${data.note}, ${actor.id}, ${who})`);
    await db.execute(sql`
      INSERT INTO follow_up_state (client_id, next_follow_up, promised_date, updated_at)
      VALUES (${data.clientId}, ${data.nextFollowUp}, ${data.promisedDate}, now())
      ON CONFLICT (client_id) DO UPDATE
        SET next_follow_up = EXCLUDED.next_follow_up, promised_date = EXCLUDED.promised_date, updated_at = now()`);
    await recordActivity({
      actor,
      action: "created",
      module: "followUps",
      entityId: id,
      label: `Follow-up — ${client}`,
      details: `${data.method}${data.promisedDate ? `, promised ${data.promisedDate}` : ""}${data.nextFollowUp ? `, next ${data.nextFollowUp}` : ""}`,
    });
    return { ok: true };
  });
