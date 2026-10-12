import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { requireAdmin, requirePermission } from "../server/auth";
import { aiConfiguration, extractDocument } from "../server/aiDocuments";
export const readAiDocument = createServerFn({ method: "POST" })
  .validator(
    z.object({
      kind: z.enum(["timesheet", "bank"]),
      consent: z.literal(true),
      pages: z
        .array(
          z.object({
            mimeType: z.literal("image/jpeg"),
            data: z
              .string()
              .min(4)
              .max(3_800_000)
              .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          }),
        )
        .min(1)
        .max(10),
    }),
  )
  .handler(async ({ data }) => {
    const actor =
      data.kind === "timesheet"
        ? await requireAdmin()
        : await requirePermission("payments", "create");
    if (data.kind === "bank") await requirePermission("invoices", "view");
    aiConfiguration();
    if (data.pages.reduce((n, p) => n + p.data.length, 0) > 3_800_000)
      throw new Error("AI request is too large. Split the document.");
    for (const p of data.pages) {
      const bytes = Buffer.from(p.data, "base64");
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
        throw new Error("Invalid page image.");
    }
    // Shared DB counter covers all server instances. Failed requests consume quota too.
    await db.execute(sql`SELECT reserve_ai_document_request(${actor.id})`);
    return extractDocument(data.kind, data.pages);
  });
