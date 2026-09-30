import { createServerFn } from "@tanstack/react-start";
import { eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import {
  clients,
  companies,
  invoices,
  payments,
  expenses,
  hoursEntries,
  subcontractEntries,
  creditNotes,
} from "../../../drizzle/schema";
import { requireAdmin } from "../server/auth";
import { recordActivity } from "../server/activity";

/**
 * Recycle bin: every table that gets soft-deleted (see the `deletedAt`
 * column in drizzle/schema.ts and the list/delete server fns in
 * src/lib/actions/*.ts) shows up here so an admin can find and undo an
 * accidental delete, or empty the bin for good. Admin-only — regular users
 * never see deleted rows anywhere, including here.
 */

export type TrashType =
  "client" | "company" | "invoice" | "payment" | "expense" | "hours" | "subcontract" | "creditNote";

export interface TrashItem {
  type: TrashType;
  id: string;
  /** Short human-readable line identifying the row, e.g. "Invoice INV-045 — Acme Ltd". */
  label: string;
  /** Secondary line, e.g. an amount or a date, shown smaller under the label. */
  detail: string;
  deletedAt: string;
}

const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(n) || 0);

export const listTrash = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrashItem[]> => {
    await requireAdmin();

    // Every deleted client/invoice/etc. still carries the old id it was
    // linked by (clientId, invoiceId...) even after deletion, so pull a
    // name map from *all* clients (deleted or not) to label things like
    // payments/invoices sensibly even when the client itself was deleted too.
    const allClients = await db
      .select({ id: clients.id, name: clients.name, company: clients.company })
      .from(clients);
    const clientName = new Map(allClients.map((c) => [c.id, c.company || c.name]));

    const [
      deletedClients,
      deletedCompanies,
      deletedInvoices,
      deletedPayments,
      deletedExpenses,
      deletedHours,
      deletedSubcontracts,
      deletedCreditNotes,
    ] = await Promise.all([
      db.select().from(clients).where(isNotNull(clients.deletedAt)),
      db.select().from(companies).where(isNotNull(companies.deletedAt)),
      db.select().from(invoices).where(isNotNull(invoices.deletedAt)),
      db.select().from(payments).where(isNotNull(payments.deletedAt)),
      db.select().from(expenses).where(isNotNull(expenses.deletedAt)),
      db.select().from(hoursEntries).where(isNotNull(hoursEntries.deletedAt)),
      db.select().from(subcontractEntries).where(isNotNull(subcontractEntries.deletedAt)),
      db.select().from(creditNotes).where(isNotNull(creditNotes.deletedAt)),
    ]);

    const items: TrashItem[] = [
      ...deletedClients.map((c) => ({
        type: "client" as const,
        id: c.id,
        label: c.company || c.name,
        detail: c.name,
        deletedAt: c.deletedAt!.toISOString(),
      })),
      ...deletedCompanies.map((c) => ({
        type: "company" as const,
        id: c.id,
        label: c.name,
        detail: c.email || "",
        deletedAt: c.deletedAt!.toISOString(),
      })),
      ...deletedInvoices.map((i) => ({
        type: "invoice" as const,
        id: i.id,
        label: `Invoice ${i.number} — ${clientName.get(i.clientId) ?? "Unknown client"}`,
        detail: `${money(i.amountExVat)} · ${i.invoiceDate}`,
        deletedAt: i.deletedAt!.toISOString(),
      })),
      ...deletedPayments.map((p) => ({
        type: "payment" as const,
        id: p.id,
        label: `Payment — ${clientName.get(p.clientId) ?? "Unknown client"}`,
        detail: `${money(p.amount)} · ${p.date}${p.reference ? ` · ${p.reference}` : ""}`,
        deletedAt: p.deletedAt!.toISOString(),
      })),
      ...deletedExpenses.map((e) => ({
        type: "expense" as const,
        id: e.id,
        label: e.description || e.category || "Expense",
        detail: `${money(e.amountExVat)} · ${e.date}`,
        deletedAt: e.deletedAt!.toISOString(),
      })),
      ...deletedHours.map((h) => ({
        type: "hours" as const,
        id: h.id,
        label: `Hours — ${clientName.get(h.clientId) ?? "Unknown client"}`,
        detail: `${h.month} · ${h.totalHours}h`,
        deletedAt: h.deletedAt!.toISOString(),
      })),
      ...deletedSubcontracts.map((s) => ({
        type: "subcontract" as const,
        id: s.id,
        label: `Subcontract — ${s.subcontractorName}`,
        detail: `${s.month} · ${clientName.get(s.clientId) ?? "Unknown client"}`,
        deletedAt: s.deletedAt!.toISOString(),
      })),
      ...deletedCreditNotes.map((n) => ({
        type: "creditNote" as const,
        id: n.id,
        label: `Credit Note ${n.number} — ${clientName.get(n.clientId) ?? "Unknown client"}`,
        detail: `${money(n.amountExVat)} · ${n.date}`,
        deletedAt: n.deletedAt!.toISOString(),
      })),
    ];

    return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  },
);

const TABLE_BY_TYPE = {
  client: clients,
  company: companies,
  invoice: invoices,
  payment: payments,
  expense: expenses,
  hours: hoursEntries,
  subcontract: subcontractEntries,
  creditNote: creditNotes,
} as const;

/** Best-effort short label for an activity-log line, built from whatever
 * fields a given trash row happens to have — same spirit as the `label`
 * fields built in listTrash() above, minus the extra client-name lookup
 * (restore/purge only touch one row, so it isn't worth another query). */
function labelForRow(type: TrashType, row: Record<string, unknown> | undefined): string {
  if (!row) return "";
  switch (type) {
    case "client":
      return String(row["company"] || row["name"] || "");
    case "company":
      return String(row["name"] || "");
    case "invoice":
      return `Invoice ${String(row["number"] ?? "")}`;
    case "creditNote":
      return `Credit Note ${String(row["number"] ?? "")}`;
    case "payment":
      return `Payment — ${String(row["reference"] || row["id"])}`;
    case "expense":
      return String(row["description"] || row["category"] || "Expense");
    case "hours":
      return `Hours — ${String(row["month"] ?? "")}`;
    case "subcontract":
      return `Subcontract — ${String(row["subcontractorName"] || "")}`;
  }
}

/** Maps a trash item's singular `type` to the plural module name used
 * everywhere else in the activity log (src/lib/actions/*.ts), so the
 * Activity Log screen's module filter has one consistent set of values
 * instead of "clients" from addClient() next to "client" from here. */
const MODULE_BY_TYPE: Record<TrashType, string> = {
  client: "clients",
  company: "companies",
  invoice: "invoices",
  payment: "payments",
  expense: "expenses",
  hours: "hours",
  subcontract: "subcontracting",
  creditNote: "creditNotes",
};

const trashRef = z.object({
  type: z.enum([
    "client",
    "company",
    "invoice",
    "payment",
    "expense",
    "hours",
    "subcontract",
    "creditNote",
  ]),
  id: z.string(),
});

/** Un-deletes a row: clears deletedAt so it reappears everywhere normally. */
export const restoreFromTrash = createServerFn({ method: "POST" })
  .validator(trashRef)
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const table = TABLE_BY_TYPE[data.type];
    const [existing] = await db.select().from(table).where(eq(table.id, data.id)).limit(1);
    await db.update(table).set({ deletedAt: null }).where(eq(table.id, data.id));
    await recordActivity({
      actor,
      action: "restored",
      module: MODULE_BY_TYPE[data.type],
      entityId: data.id,
      label: labelForRow(data.type, existing as Record<string, unknown> | undefined),
    });
    return { ok: true };
  });

/** Permanently removes a row — only reachable from the Recycle Bin screen, admin-only, no way back. */
export const permanentlyDelete = createServerFn({ method: "POST" })
  .validator(trashRef)
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const table = TABLE_BY_TYPE[data.type];
    const [existing] = await db.select().from(table).where(eq(table.id, data.id)).limit(1);
    await db.delete(table).where(eq(table.id, data.id));
    await recordActivity({
      actor,
      action: "purged",
      module: MODULE_BY_TYPE[data.type],
      entityId: data.id,
      label: labelForRow(data.type, existing as Record<string, unknown> | undefined),
    });
    return { ok: true };
  });
