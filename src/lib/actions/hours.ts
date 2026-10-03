import { createServerFn } from "@tanstack/react-start";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { hoursEntries } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { uid } from "../server/id";
import { stripNulls, stripNullsAll } from "../server/normalize";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const hoursInput = z.object({
  month: z.string().min(1),
  clientId: z.string().min(1),
  totalHours: z.number().default(0),
  payrollHours: z.number().default(0),
  managementPayrollHours: z.number().default(0),
  unpaidHours: z.number().default(0),
  rate: z.number().default(0),
  // Rate the payroll hours were paid at. 0 / missing = not set (NULL).
  payrollRate: z
    .number()
    .min(0)
    .optional()
    .transform((v) => (v === undefined ? undefined : v > 0 ? v : null)),
  notes: z.string().optional(),
  // Optional link to the invoice raised for this month's hours — see
  // drizzle/schema.ts hoursEntries.invoiceId. Transforms to `null` (not
  // `undefined`) so clearing it back to "Not invoiced yet" on edit actually
  // reaches the server — same convention as expenses.invoiceId above.
  invoiceId: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v : null)),
});

export const listHours = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("hours", "view");
  return stripNullsAll(
    await db
      .select()
      .from(hoursEntries)
      .where(isNull(hoursEntries.deletedAt))
      .orderBy(hoursEntries.month),
  );
});

export const addHours = createServerFn({ method: "POST" })
  .validator(hoursInput)
  .handler(async ({ data }) => {
    const actor = await requirePermission("hours", "create");
    const [row] = await db
      .insert(hoursEntries)
      .values({ id: uid("hr"), ...data })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "hours",
        entityId: row.id,
        label: `Hours — ${row.month}`,
      });
    }
    return row && stripNulls(row);
  });

export const updateHours = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: hoursInput.partial() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("hours", "edit");
    const [row] = await db
      .update(hoursEntries)
      .set(data.patch)
      .where(eq(hoursEntries.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "hours",
        entityId: row.id,
        label: `Hours — ${row.month}`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row && stripNulls(row);
  });

export const deleteHours = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("hours", "delete");
    const [existing] = await db
      .select()
      .from(hoursEntries)
      .where(eq(hoursEntries.id, data.id))
      .limit(1);
    await db
      .update(hoursEntries)
      .set({ deletedAt: new Date() })
      .where(eq(hoursEntries.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "hours",
      entityId: data.id,
      label: existing ? `Hours — ${existing.month}` : data.id,
    });
    return { ok: true };
  });
