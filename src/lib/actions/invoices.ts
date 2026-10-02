import { createServerFn } from "@tanstack/react-start";
import { eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { invoices, invoiceLineItems, settings } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { uid } from "../server/id";
import { stripNulls, stripNullsAll } from "../server/normalize";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const invoiceLineItemInput = z.object({
  description: z.string().default(""),
  quantity: z.number().default(1),
  unitPrice: z.number().default(0),
  orderIndex: z.number().default(0),
});

const invoiceInput = z.object({
  number: z.string().min(1),
  clientId: z.string().min(1),
  month: z.string().optional(),
  invoiceDate: z.string().min(1),
  dueDate: z.string().min(1),
  poReference: z.string().optional(),
  // Optional end client; "" clears it (stored as NULL).
  endClient: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v.trim() || null)),
  description: z.string().default(""),
  // Optional second description; "" clears it (stored as NULL).
  description2: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v.trim() || null)),
  amountExVat: z.number(),
  hours: z.number().optional(),
  rate: z.number().optional(),
  vatIncluded: z.boolean().default(false),
  vatRate: z.number().default(20),
  vatMode: z.enum(["full", "remaining"]).default("full"),
  vatPaidBefore: z.number().min(0).optional(),
  paymentTerms: z.string().default(""),
  notes: z.string().optional(),
  // Approval status — kept fully separate from payment status.
  approved: z.boolean().default(false),
  // Set when this is an "Additional Invoice" referencing an original invoice.
  originalInvoiceId: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v : undefined)),
  // When present, amountExVat is recalculated server-side as the sum of
  // (quantity * unitPrice) across these rows — the client-supplied
  // amountExVat above is ignored in that case.
  lineItems: z.array(invoiceLineItemInput).optional(),
});

function sumLineItems(items: z.infer<typeof invoiceLineItemInput>[]): number {
  return Math.round(items.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0) * 100) / 100;
}

async function replaceLineItems(invoiceId: string, items: z.infer<typeof invoiceLineItemInput>[]) {
  await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  if (items.length > 0) {
    await db.insert(invoiceLineItems).values(
      items.map((li, i) => ({
        id: uid("li"),
        invoiceId,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        amountExVat: Math.round(li.quantity * li.unitPrice * 100) / 100,
        orderIndex: li.orderIndex ?? i,
      })),
    );
  }
}

export const listInvoices = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("invoices", "view");
  const rows = stripNullsAll(
    await db
      .select()
      .from(invoices)
      .where(isNull(invoices.deletedAt))
      .orderBy(invoices.invoiceDate),
  );
  const allLineItems = stripNullsAll(
    await db.select().from(invoiceLineItems).orderBy(invoiceLineItems.orderIndex),
  );
  const byInvoiceId = new Map<string, typeof allLineItems>();
  for (const li of allLineItems) {
    const list = byInvoiceId.get(li.invoiceId) ?? [];
    list.push(li);
    byInvoiceId.set(li.invoiceId, list);
  }
  return rows.map((inv) => ({ ...inv, lineItems: byInvoiceId.get(inv.id) ?? [] }));
});

export const addInvoice = createServerFn({ method: "POST" })
  .validator(invoiceInput)
  .handler(async ({ data }) => {
    const actor = await requirePermission("invoices", "create");
    const { lineItems, ...invoiceFields } = data;
    const amountExVat =
      lineItems && lineItems.length > 0 ? sumLineItems(lineItems) : invoiceFields.amountExVat;

    const [row] = await db
      .insert(invoices)
      .values({ id: uid("inv"), ...invoiceFields, amountExVat })
      .returning();

    if (row) {
      if (lineItems) {
        await replaceLineItems(row.id, lineItems);
      }
      try {
        await db
          .update(settings)
          .set({ nextInvoiceNumber: sql`${settings.nextInvoiceNumber} + 1` })
          .where(eq(settings.id, "default"));
      } catch (err) {
        console.error("addInvoice: failed to bump nextInvoiceNumber", err);
      }
      await recordActivity({
        actor,
        action: "created",
        module: "invoices",
        entityId: row.id,
        label: `Invoice ${row.number}`,
      });
    }

    return row && stripNulls({ ...row, lineItems: lineItems ?? [] });
  });

export const updateInvoice = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: invoiceInput.partial() }))
  .handler(async ({ data }) => {
    // Note: Agar invoice update ke dauran approval status bhi update ho raha hai to edit permission se handle ho jaata hai
    const actor = await requirePermission("invoices", "edit");
    const { lineItems, ...patchFields } = data.patch;
    if (lineItems && lineItems.length > 0) {
      (patchFields as { amountExVat?: number }).amountExVat = sumLineItems(lineItems);
    }

    const [row] = await db
      .update(invoices)
      .set(patchFields)
      .where(eq(invoices.id, data.id))
      .returning();

    if (row) {
      if (lineItems) {
        await replaceLineItems(row.id, lineItems);
      }
      await recordActivity({
        actor,
        action: "updated",
        module: "invoices",
        entityId: row.id,
        label: `Invoice ${row.number}`,
        details: changedFieldsSummary(data.patch),
      });
    }

    return row && stripNulls({ ...row, ...(lineItems ? { lineItems } : {}) });
  });

export const deleteInvoice = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("invoices", "delete");
    const [existing] = await db.select().from(invoices).where(eq(invoices.id, data.id)).limit(1);
    await db.update(invoices).set({ deletedAt: new Date() }).where(eq(invoices.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "invoices",
      entityId: data.id,
      label: existing ? `Invoice ${existing.number}` : data.id,
    });
    return { ok: true };
  });
