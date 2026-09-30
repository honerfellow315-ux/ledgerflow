import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { activityLog } from "../../../drizzle/schema";
import { requireAdmin } from "../server/auth";
import type { ActivityAction } from "../server/activity";

/** Every value the Activity Log screen's action filter can send — kept in
 * sync with ActivityAction in src/lib/server/activity.ts. */
export const ACTIVITY_ACTIONS: readonly ActivityAction[] = [
  "created",
  "updated",
  "deleted",
  "restored",
  "purged",
  "login",
  "login_failed",
  "logout",
];

const activityFilter = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  module: z.string().optional(),
  /** yyyy-mm-dd, inclusive */
  from: z.string().optional(),
  /** yyyy-mm-dd, inclusive */
  to: z.string().optional(),
  /** Matched against label, username and display name. */
  search: z.string().optional(),
});

/**
 * Admin-only: the rows behind the Activity Log screen
 * (src/routes/activity-log.index.tsx). Every mutating server fn across the
 * app writes here via recordActivity() (src/lib/server/activity.ts) — this
 * just reads them back, newest first, with optional filters.
 */
export const listActivityLog = createServerFn({ method: "GET" })
  .validator(activityFilter)
  .handler(async ({ data }) => {
    await requireAdmin();

    const conditions: SQL[] = [];
    if (data.userId) conditions.push(eq(activityLog.userId, data.userId));
    if (data.action) conditions.push(eq(activityLog.action, data.action));
    if (data.module) conditions.push(eq(activityLog.module, data.module));
    if (data.from) conditions.push(gte(activityLog.createdAt, new Date(`${data.from}T00:00:00`)));
    if (data.to) conditions.push(lte(activityLog.createdAt, new Date(`${data.to}T23:59:59.999`)));
    if (data.search && data.search.trim()) {
      const like = `%${data.search.trim()}%`;
      const term = or(
        ilike(activityLog.label, like),
        ilike(activityLog.username, like),
        ilike(activityLog.displayName, like),
        ilike(activityLog.details, like),
      );
      if (term) conditions.push(term);
    }

    const rows = await db
      .select()
      .from(activityLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(activityLog.createdAt))
      .limit(500);

    return rows;
  });
