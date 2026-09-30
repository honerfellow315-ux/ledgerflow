import { createServerFn } from "@tanstack/react-start";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { companies } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { uid } from "../server/id";
import { stripNulls, stripNullsAll } from "../server/normalize";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const companyInput = z.object({
  name: z.string().min(1),
  email: z.string().default(""),
  phone: z.string().default(""),
  address: z.string().default(""),
  vatNumber: z.string().default(""),
  companyNumber: z.string().default(""),
  website: z.string().optional(),
  bankDetails: z.string().optional(),
  logo: z.string().optional(),
  letterhead: z.string().optional(),
  letterheadMarginTop: z.number().optional(),
  letterheadMarginBottom: z.number().optional(),
  // Company-specific default invoice-number prefix, e.g. "FFM-". Empty/unset
  // falls back to the global Settings invoicePrefix.
  invoicePrefix: z.string().optional(),
});

export const listCompanies = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("companies", "view");
  return stripNullsAll(
    await db.select().from(companies).where(isNull(companies.deletedAt)).orderBy(companies.name),
  );
});

export const addCompany = createServerFn({ method: "POST" })
  .validator(companyInput)
  .handler(async ({ data }) => {
    const actor = await requirePermission("companies", "create");
    const [row] = await db
      .insert(companies)
      .values({ id: uid("co"), ...data })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "companies",
        entityId: row.id,
        label: row.name,
      });
    }
    return row && stripNulls(row);
  });

export const updateCompany = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: companyInput.partial() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("companies", "edit");
    const [row] = await db
      .update(companies)
      .set(data.patch)
      .where(eq(companies.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "companies",
        entityId: row.id,
        label: row.name,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row && stripNulls(row);
  });

// Deleting a company just unlinks its clients (see the `onDelete: "set null"`
// on `clients.company_id` in drizzle/schema.ts) — those clients fall back to
// the global Settings business profile, nothing else is removed.
export const deleteCompany = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("companies", "delete");
    const [existing] = await db.select().from(companies).where(eq(companies.id, data.id)).limit(1);
    await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "companies",
      entityId: data.id,
      label: existing?.name ?? data.id,
    });
    return { ok: true };
  });
