/**
 * Bank Match server functions.
 *  - Seeing the screen needs Payments (view) and Invoices (view), because it shows invoice amounts.
 *  - Uploading a statement, confirming, ignoring and deleting an upload need Payments (create).
 *  - Undoing a confirmed payment needs Payments (delete), because it removes a payment.
 * The matching and every money check are done on the server (src/lib/server/bankMatch.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { requirePermission } from "../server/auth";
import { isRealDay } from "../tasks/rules";
import {
  confirmOne,
  ignoreLine,
  invoiceLabels,
  loadBank,
  loadOpenInvoices,
  removeStatement,
  reopenLine,
  saveStatement,
  type UploadResult,
} from "../server/bankMatch";
import {
  matchLine,
  payerKey,
  type BankLine,
  type LineStatus,
  type OpenInvoice,
  type StatementInfo,
} from "../bankMatch/data";
import { MAX_BANK_LINES } from "../bankMatch/parse";

async function requireBankAccess() {
  await requirePermission("invoices", "view");
  return requirePermission("payments", "view");
}

export type BankFilter = "all" | "matched" | "review" | "none" | "confirmed" | "ignored";

export interface BankPage {
  rows: BankLine[];
  total: number;
  page: number;
  pageSize: number;
  labels: Record<string, { number: string; client: string }>;
  statements: StatementInfo[];
  counts: Record<LineStatus, number>;
  waitingTotal: number;
}

const ORDER: Record<LineStatus, number> = {
  review: 0,
  none: 1,
  matched: 2,
  confirmed: 3,
  ignored: 4,
};

export const listBank = createServerFn({ method: "GET" })
  .validator(
    z.object({
      filter: z.enum(["all", "matched", "review", "none", "confirmed", "ignored"]).default("all"),
      search: z.string().trim().max(80).default(""),
      page: z.number().int().min(1).max(10000).default(1),
      pageSize: z.number().int().min(5).max(100).default(50),
    }),
  )
  .handler(async ({ data }): Promise<BankPage> => {
    await requireBankAccess();
    const { lines, statements, counts, waitingTotal } = await loadBank();
    const needle = data.search.toLowerCase();
    const filtered = lines
      .filter((l) => (data.filter === "all" ? true : l.status === data.filter))
      .filter((l) => (needle ? l.description.toLowerCase().includes(needle) : true))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.date.localeCompare(a.date));
    const start = (data.page - 1) * data.pageSize;
    const rows = filtered.slice(start, start + data.pageSize);
    const labels = await invoiceLabels(
      rows.flatMap((r) => [r.invoiceId ?? "", ...r.candidateIds.slice(0, 3)]),
    );
    return {
      rows,
      total: filtered.length,
      page: data.page,
      pageSize: data.pageSize,
      labels,
      statements,
      counts,
      waitingTotal,
    };
  });

/** The invoices a person can choose from for one line (fresh, only those with money owed). */
export const listChoices = createServerFn({ method: "POST" })
  .validator(z.object({ lineId: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<{ invoices: OpenInvoice[]; candidateIds: string[] }> => {
    await requireBankAccess();
    const [line] = (
      await db.execute(
        sql`SELECT date, description, amount FROM bank_lines WHERE id = ${data.lineId} AND status = 'open'`,
      )
    ).rows as {
      date: string;
      description: string;
      amount: string;
    }[];
    if (!line) throw new Error("This line is not waiting any more.");
    const open = await loadOpenInvoices();
    const linkRes = await db.execute(
      sql`SELECT client_id FROM bank_payer_links WHERE payer_key = ${payerKey(line.description)}`,
    );
    const linked = (linkRes.rows[0] as { client_id: string } | undefined)?.client_id ?? null;
    const m = matchLine(
      { date: line.date, description: line.description, amount: Number(line.amount) },
      open,
      linked,
    );
    return { invoices: open, candidateIds: m.candidateIds };
  });

const day = z.string().refine(isRealDay, "That is not a real date.");

export const uploadStatement = createServerFn({ method: "POST" })
  .validator(
    z.object({
      fileName: z.string().trim().min(1).max(200),
      fileHash: z.string().regex(/^[0-9a-f]{64}$/, "The file could not be checked."),
      skippedOut: z.number().int().min(0).max(1_000_000),
      lines: z
        .array(
          z.object({
            lineNo: z.number().int().min(1).max(1_000_000),
            date: day,
            description: z.string().trim().min(1).max(300),
            amount: z.number().positive().max(10_000_000),
          }),
        )
        .min(1, "There are no payments in this file.")
        .max(MAX_BANK_LINES),
    }),
  )
  .handler(async ({ data }): Promise<UploadResult> => {
    const actor = await requirePermission("payments", "create");
    await requirePermission("invoices", "view");
    return saveStatement(actor, data);
  });

export const confirmLine = createServerFn({ method: "POST" })
  .validator(
    z.object({
      lineId: z.string().min(1).max(100),
      invoiceId: z.string().min(1).max(100),
      recordAnyway: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("payments", "create");
    await requirePermission("invoices", "view");
    return confirmOne(actor, { ...data, learn: true });
  });

export interface BulkResult {
  confirmed: number;
  skipped: { lineId: string; reason: string }[];
}

/**
 * "Confirm all matched": for every line the server works out the match AGAIN and only records
 * the lines that are still "matched" to the very invoice the system picks now.
 */
export const confirmMatched = createServerFn({ method: "POST" })
  .validator(z.object({ lineIds: z.array(z.string().min(1).max(100)).min(1).max(200) }))
  .handler(async ({ data }): Promise<BulkResult> => {
    const actor = await requirePermission("payments", "create");
    await requirePermission("invoices", "view");
    const ids = [...new Set(data.lineIds)];
    const res = await db.execute(
      sql`SELECT id, date, description, amount FROM bank_lines WHERE status = 'open' AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`,
    );
    const lines = res.rows as { id: string; date: string; description: string; amount: string }[];
    const open = await loadOpenInvoices();
    const out: BulkResult = { confirmed: 0, skipped: [] };
    const found = new Set(lines.map((l) => l.id));
    for (const id of ids)
      if (!found.has(id))
        out.skipped.push({ lineId: id, reason: "This line was already dealt with." });
    for (const l of lines) {
      const linkRes = await db.execute(
        sql`SELECT client_id FROM bank_payer_links WHERE payer_key = ${payerKey(l.description)}`,
      );
      const linked = (linkRes.rows[0] as { client_id: string } | undefined)?.client_id ?? null;
      const m = matchLine(
        { date: l.date, description: l.description, amount: Number(l.amount) },
        open,
        linked,
      );
      if (m.status !== "matched" || !m.invoiceId) {
        out.skipped.push({
          lineId: l.id,
          reason: "It is no longer a sure match. Check it by hand.",
        });
        continue;
      }
      const r = await confirmOne(actor, {
        lineId: l.id,
        invoiceId: m.invoiceId,
        recordAnyway: false,
        learn: false,
      });
      if (r.ok) {
        out.confirmed++;
        // The next line may be for the same invoice: its owed amount changed.
        const inv = open.find((i) => i.id === m.invoiceId);
        if (inv) {
          inv.outstanding = Math.round((inv.outstanding - Number(l.amount)) * 100) / 100;
          inv.payments.push({ date: l.date, amount: Number(l.amount) });
        }
      } else out.skipped.push({ lineId: l.id, reason: r.reason });
    }
    return out;
  });

export const ignoreBankLine = createServerFn({ method: "POST" })
  .validator(z.object({ lineId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("payments", "create");
    await requirePermission("invoices", "view");
    if (!(await ignoreLine(actor, data.lineId))) {
      throw new Error("This line was already dealt with.");
    }
    return { ok: true };
  });

export const undoBankLine = createServerFn({ method: "POST" })
  .validator(z.object({ lineId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("payments", "create");
    await requirePermission("invoices", "view");
    let mayDelete = true;
    try {
      await requirePermission("payments", "delete");
    } catch {
      mayDelete = false;
    }
    const r = await reopenLine(actor, data.lineId, mayDelete);
    if (!r.ok) throw new Error(r.reason);
    return { ok: true };
  });

export const deleteBankStatement = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("payments", "delete");
    await requirePermission("invoices", "view");
    await removeStatement(actor, data.id);
    return { ok: true };
  });
