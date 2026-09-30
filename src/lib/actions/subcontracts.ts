import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { invoices, subcontractEntries } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { uid } from "../server/id";
import { stripNulls, stripNullsAll } from "../server/normalize";
import { recordActivity, changedFieldsSummary } from "../server/activity";

/**
 * Server-side guard for "Remaining Hours = Invoice Total Hours − Total Hours
 * Already Processed Through Subcontractor Entries" — the actual source of
 * truth, so a request that skips the frontend form (or a stale UI) can never
 * push an invoice's processed hours past its total or negative. Mirrors
 * calc.ts:remainingInvoiceHours, but computed here against the database
 * directly rather than a client-supplied list.
 *
 * Invoices that don't track hours at all (`hours` is null — Fixed Amount or
 * Line Items billing) have nothing to cap, so this is a no-op for them.
 * `excludeEntryId` is passed on update so the entry being edited isn't
 * counted against its own old value.
 */
async function assertWithinRemainingHours(
  invoiceId: string,
  hoursProceed: number,
  excludeEntryId?: string,
): Promise<void> {
  const [invoice] = await db
    .select({ id: invoices.id, hours: invoices.hours, number: invoices.number })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)));

  if (!invoice) throw new Error("The selected invoice could not be found.");
  if (invoice.hours == null) return; // This invoice doesn't track hours.

  const [processedRow] = await db
    .select({
      processed: sql<number>`coalesce(sum(${subcontractEntries.hoursProceed}), 0)`.mapWith(Number),
    })
    .from(subcontractEntries)
    .where(
      and(
        eq(subcontractEntries.invoiceId, invoiceId),
        isNull(subcontractEntries.deletedAt),
        excludeEntryId ? ne(subcontractEntries.id, excludeEntryId) : undefined,
      ),
    );
  const processed = processedRow?.processed ?? 0;

  const remaining = Math.max(0, Math.round((invoice.hours - processed) * 100) / 100);
  if (hoursProceed > remaining + 0.004) {
    throw new Error(
      `Only ${remaining} remaining hour(s) on invoice ${invoice.number} — cannot process ${hoursProceed}.`,
    );
  }
}

const subcontractInput = z.object({
  month: z.string().min(1),
  clientId: z.string().min(1),
  invoiceId: z.string().optional(),
  subcontractorName: z.string().min(1),
  hoursProceed: z.number().default(0),
  rate: z.number().default(0),
  description: z.string().optional(),
  reference: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  invoiceNumber: z.string().optional(),
  notes: z.string().optional(),
  vatIncluded: z.boolean().default(false),
  vatRate: z.number().default(0),
});

export const listSubcontracts = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("subcontracting", "view");
  return stripNullsAll(
    await db
      .select()
      .from(subcontractEntries)
      .where(isNull(subcontractEntries.deletedAt))
      .orderBy(subcontractEntries.month),
  );
});

export const addSubcontract = createServerFn({ method: "POST" })
  .validator(subcontractInput)
  .handler(async ({ data }) => {
    const actor = await requirePermission("subcontracting", "create");
    if (data.invoiceId) {
      await assertWithinRemainingHours(data.invoiceId, data.hoursProceed);
    }
    const [row] = await db
      .insert(subcontractEntries)
      .values({ id: uid("sc"), ...data })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "subcontracting",
        entityId: row.id,
        label: `Subcontract — ${row.subcontractorName} · ${row.month}`,
      });
    }
    return row && stripNulls(row);
  });

export const updateSubcontract = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: subcontractInput.partial() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("subcontracting", "edit");

    // hoursProceed and/or invoiceId may not both be present in a partial
    // patch — fall back to the entry's current saved values for whichever
    // side of the check isn't being changed this time.
    if (data.patch.invoiceId !== undefined || data.patch.hoursProceed !== undefined) {
      const [current] = await db
        .select({
          invoiceId: subcontractEntries.invoiceId,
          hoursProceed: subcontractEntries.hoursProceed,
        })
        .from(subcontractEntries)
        .where(eq(subcontractEntries.id, data.id));
      const invoiceId = data.patch.invoiceId ?? current?.invoiceId ?? undefined;
      const hoursProceed = data.patch.hoursProceed ?? current?.hoursProceed ?? 0;
      if (invoiceId) {
        await assertWithinRemainingHours(invoiceId, hoursProceed, data.id);
      }
    }

    const [row] = await db
      .update(subcontractEntries)
      .set(data.patch)
      .where(eq(subcontractEntries.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "subcontracting",
        entityId: row.id,
        label: `Subcontract — ${row.subcontractorName} · ${row.month}`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row && stripNulls(row);
  });

export const deleteSubcontract = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("subcontracting", "delete");
    const [existing] = await db
      .select()
      .from(subcontractEntries)
      .where(eq(subcontractEntries.id, data.id))
      .limit(1);
    await db
      .update(subcontractEntries)
      .set({ deletedAt: new Date() })
      .where(eq(subcontractEntries.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "subcontracting",
      entityId: data.id,
      label: existing ? `Subcontract — ${existing.subcontractorName} · ${existing.month}` : data.id,
    });
    return { ok: true };
  });
