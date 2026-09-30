import { createServerFn } from "@tanstack/react-start";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { payments } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { uid } from "../server/id";
import { stripNulls, stripNullsAll } from "../server/normalize";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(n) || 0);

const paymentInput = z.object({
  invoiceId: z.string().min(1),
  clientId: z.string().min(1),
  date: z.string().min(1),
  // Free-form/reusable — see settings.paymentMethods (Settings > Payment Methods).
  method: z.string().min(1).default("Bank Transfer"),
  amount: z.number(),
  reference: z.string().default(""),
  notes: z.string().optional(),
  // Hours-wise payment recording — see drizzle/schema.ts payments.hoursEntryId.
  // Transforms to `null` (not `undefined`) when cleared: `undefined` values
  // are dropped before the request reaches the server, so switching an
  // edited payment back to "Fixed Amount" would otherwise silently fail to
  // clear the old link. The dialog sends "" for that case.
  hoursEntryId: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v : null)),
  hoursPaid: z.number().optional(),
});

export const listPayments = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("payments", "view");
  return stripNullsAll(
    await db.select().from(payments).where(isNull(payments.deletedAt)).orderBy(payments.date),
  );
});

export const addPayment = createServerFn({ method: "POST" })
  .validator(paymentInput)
  .handler(async ({ data }) => {
    const actor = await requirePermission("payments", "create");
    const [row] = await db
      .insert(payments)
      .values({ id: uid("pm"), ...data })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "payments",
        entityId: row.id,
        label: `Payment of ${money(row.amount)}`,
        details: row.reference ? `Ref: ${row.reference}` : undefined,
      });
    }
    return row && stripNulls(row);
  });

export const updatePayment = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: paymentInput.partial() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("payments", "edit");
    const [row] = await db
      .update(payments)
      .set(data.patch)
      .where(eq(payments.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "payments",
        entityId: row.id,
        label: `Payment of ${money(row.amount)}`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row && stripNulls(row);
  });

export const deletePayment = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("payments", "delete");
    const [existing] = await db.select().from(payments).where(eq(payments.id, data.id)).limit(1);
    await db.update(payments).set({ deletedAt: new Date() }).where(eq(payments.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "payments",
      entityId: data.id,
      label: existing ? `Payment of ${money(existing.amount)}` : data.id,
    });
    return { ok: true };
  });
