import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { settings } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const settingsPatch = z.object({
  businessName: z.string().optional(),
  businessEmail: z.string().optional(),
  businessPhone: z.string().optional(),
  businessAddress: z.string().optional(),
  vatNumber: z.string().optional(),
  companyNumber: z.string().optional(),
  businessWebsite: z.string().optional(),
  defaultVatRate: z.number().optional(),
  currency: z.string().optional(),
  // Free-form/reusable — users can add their own custom methods.
  paymentMethods: z.array(z.string().min(1)).optional(),
  paymentTerms: z.array(z.string()).optional(),
  expenseCategories: z.array(z.string()).optional(),
  invoicePrefix: z.string().optional(),
  nextInvoiceNumber: z.number().int().optional(),
  creditNotePrefix: z.string().optional(),
  bankDetails: z.string().optional(),
  businessLogo: z.string().optional(),
  businessLetterhead: z.string().optional(),
  letterheadMarginTop: z.number().optional(),
  letterheadMarginBottom: z.number().optional(),
});

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("settings", "view");
  const [row] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);
  return row ?? null; // null the first time, before the seed script has run
});

export const updateSettings = createServerFn({ method: "POST" })
  .validator(settingsPatch)
  .handler(async ({ data }) => {
    const actor = await requirePermission("settings", "edit");
    const [row] = await db.update(settings).set(data).where(eq(settings.id, "default")).returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "settings",
        entityId: row.id,
        label: "Business settings",
        details: changedFieldsSummary(data),
      });
    }
    return row;
  });
