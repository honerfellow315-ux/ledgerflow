import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { settings } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const text = (max = 500) => z.string().max(max).optional();
const list = (itemMax = 100) => z.array(z.string().max(itemMax)).max(100).optional();

const settingsPatch = z.object({
  businessName: text(200),
  businessEmail: text(200),
  businessPhone: text(60),
  businessAddress: text(1000),
  vatNumber: text(60),
  companyNumber: text(60),
  businessWebsite: text(200),
  defaultVatRate: z.number().finite().min(0).max(100).optional(),
  currency: text(10),
  // Free-form/reusable — users can add their own custom methods.
  paymentMethods: z.array(z.string().min(1).max(100)).max(100).optional(),
  paymentTerms: list(),
  expenseCategories: list(),
  invoicePrefix: text(30),
  nextInvoiceNumber: z.number().int().min(0).max(1_000_000_000).optional(),
  creditNotePrefix: text(30),
  bankDetails: text(2000),
  // Images are stored as data URLs; ~4 MB of text is plenty for a letterhead.
  businessLogo: text(4_000_000),
  businessLetterhead: text(4_000_000),
  letterheadMarginTop: z.number().finite().min(-100).max(1000).optional(),
  letterheadMarginBottom: z.number().finite().min(-100).max(1000).optional(),
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
    const [before] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);

    // Bank details are printed on every invoice, so changing them is the
    // classic payment-redirect fraud. Only an admin may change them.
    const bankChanged =
      data.bankDetails !== undefined &&
      data.bankDetails.trim() !== (before?.bankDetails ?? "").trim();
    if (bankChanged && actor.role !== "admin") {
      throw new Response("Only an admin can change the bank details.", { status: 403 });
    }

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
      // Keep the OLD bank details too, so "who changed it and from what" can
      // always be answered.
      if (bankChanged) {
        await recordActivity({
          actor,
          action: "updated",
          module: "settings",
          entityId: row.id,
          label: "Bank details changed",
          details: `Before: ${(before?.bankDetails ?? "").slice(0, 300)} → After: ${(data.bankDetails ?? "").slice(0, 300)}`,
        });
      }
    }
    return row;
  });
