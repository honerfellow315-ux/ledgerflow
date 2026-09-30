import { createServerFn } from "@tanstack/react-start";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { creditNotes } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { uid } from "../server/id";
import { stripNulls, stripNullsAll } from "../server/normalize";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const creditNoteInput = z.object({
  number: z.string().min(1),
  clientId: z.string().min(1),
  invoiceId: z.string().optional(),
  date: z.string().min(1),
  reason: z.string().default(""),
  amountExVat: z.number(),
  vatIncluded: z.boolean().default(false),
  vatRate: z.number().default(20),
  status: z.enum(["draft", "issued", "applied"]).default("draft"),
  comments: z.string().optional(),
});

export const listCreditNotes = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("creditNotes", "view");
  return stripNullsAll(
    await db
      .select()
      .from(creditNotes)
      .where(isNull(creditNotes.deletedAt))
      .orderBy(creditNotes.date),
  );
});

export const addCreditNote = createServerFn({ method: "POST" })
  .validator(creditNoteInput)
  .handler(async ({ data }) => {
    const actor = await requirePermission("creditNotes", "create");
    const [row] = await db
      .insert(creditNotes)
      .values({ id: uid("cn"), ...data })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "creditNotes",
        entityId: row.id,
        label: `Credit Note ${row.number}`,
      });
    }
    return row && stripNulls(row);
  });

export const updateCreditNote = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: creditNoteInput.partial() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("creditNotes", "edit");
    const [row] = await db
      .update(creditNotes)
      .set(data.patch)
      .where(eq(creditNotes.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "creditNotes",
        entityId: row.id,
        label: `Credit Note ${row.number}`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row && stripNulls(row);
  });

export const deleteCreditNote = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("creditNotes", "delete");
    const [existing] = await db
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.id, data.id))
      .limit(1);
    await db.update(creditNotes).set({ deletedAt: new Date() }).where(eq(creditNotes.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "creditNotes",
      entityId: data.id,
      label: existing ? `Credit Note ${existing.number}` : data.id,
    });
    return { ok: true };
  });
