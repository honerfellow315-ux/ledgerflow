import { createServerFn } from "@tanstack/react-start";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { clients } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { uid } from "../server/id";
import { stripNulls, stripNullsAll } from "../server/normalize";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const clientInput = z.object({
  name: z.string().min(1),
  company: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  address: z.string().default(""),
  status: z.enum(["active", "on-hold", "closed"]).default("active"),
  rate: z.number().optional(),
  paymentTermDays: z.number().int().optional(),
  vatNumber: z.string().optional(),
  accountReference: z.string().optional(),
  startDate: z.string().optional(),
  notes: z.string().optional(),
  companyId: z.string().nullable().optional(),
});

export const listClients = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("clients", "view");
  return stripNullsAll(
    await db.select().from(clients).where(isNull(clients.deletedAt)).orderBy(clients.name),
  );
});

export const addClient = createServerFn({ method: "POST" })
  .validator(clientInput)
  .handler(async ({ data }) => {
    const actor = await requirePermission("clients", "create");
    const [row] = await db
      .insert(clients)
      .values({ id: uid("cl"), ...data })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "clients",
        entityId: row.id,
        label: row.company || row.name,
      });
    }
    return row && stripNulls(row);
  });

export const updateClient = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: clientInput.partial() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("clients", "edit");
    const [row] = await db
      .update(clients)
      .set(data.patch)
      .where(eq(clients.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "clients",
        entityId: row.id,
        label: row.company || row.name,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row && stripNulls(row);
  });

// Deleting a client cascades to its invoices/payments/hours/subcontracts/credit
// notes at the database level (see the `references(... onDelete: "cascade")`
// in drizzle/schema.ts) — this mirrors what the old in-memory store did by hand.
export const deleteClient = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("clients", "delete");
    const [existing] = await db.select().from(clients).where(eq(clients.id, data.id)).limit(1);
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "clients",
      entityId: data.id,
      label: existing ? existing.company || existing.name : data.id,
    });
    return { ok: true };
  });
