import { createServerFn } from "@tanstack/react-start";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { expenses } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { uid } from "../server/id";
import { stripNulls, stripNullsAll } from "../server/normalize";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(n) || 0);

const expenseInput = z.object({
  date: z.string().min(1),
  category: z.string().default(""),
  description: z.string().default(""),
  amountExVat: z.number(),
  vatAmount: z.number().default(0),
  // Free-form/reusable — see settings.paymentMethods (Settings > Payment Methods).
  method: z.string().min(1).default("Bank Transfer"),
  paidTo: z.string().default(""),
  reference: z.string().optional(),
  comments: z.string().optional(),
  // Optional job-costing link — see drizzle/schema.ts expenses.invoiceId.
  // Transforms to `null` (not `undefined`) so clearing it on edit actually
  // reaches the server — see the matching note in actions/payments.ts.
  invoiceId: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v : null)),
});

export const listExpenses = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("expenses", "view");
  return stripNullsAll(
    await db.select().from(expenses).where(isNull(expenses.deletedAt)).orderBy(expenses.date),
  );
});

export const addExpense = createServerFn({ method: "POST" })
  .validator(expenseInput)
  .handler(async ({ data }) => {
    const actor = await requirePermission("expenses", "create");
    const [row] = await db
      .insert(expenses)
      .values({ id: uid("ex"), ...data })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "expenses",
        entityId: row.id,
        label: row.description || row.category || `Expense of ${money(row.amountExVat)}`,
      });
    }
    return row && stripNulls(row);
  });

export const updateExpense = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: expenseInput.partial() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("expenses", "edit");
    const [row] = await db
      .update(expenses)
      .set(data.patch)
      .where(eq(expenses.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "expenses",
        entityId: row.id,
        label: row.description || row.category || `Expense of ${money(row.amountExVat)}`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row && stripNulls(row);
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("expenses", "delete");
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, data.id)).limit(1);
    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "expenses",
      entityId: data.id,
      label: existing
        ? existing.description || existing.category || `Expense of ${money(existing.amountExVat)}`
        : data.id,
    });
    return { ok: true };
  });
