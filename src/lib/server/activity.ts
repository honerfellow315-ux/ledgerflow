import { db } from "./db";
import { activityLog, users } from "../../../drizzle/schema";
import { uid } from "./id";

/**
 * Every kind of event the activity log records. CRUD actions cover the
 * normal add/edit/delete server fns (src/lib/actions/*.ts); restored/purged
 * cover the Recycle Bin (src/lib/actions/trash.ts); the login/login_failed/
 * logout trio covers src/lib/ledger/auth.ts.
 */
export type ActivityAction =
  "created" | "updated" | "deleted" | "restored" | "purged" | "login" | "login_failed" | "logout";

/** The full user row (as returned by requirePermission()/requireAdmin()/
 * getCurrentUser()) that performed the action — or `null` for events with no
 * real user to attribute (e.g. a failed login with a bad username). */
type Actor = typeof users.$inferSelect | null;

/**
 * Writes one row to `activity_log` after a mutation succeeds. Deliberately
 * fail-safe: a logging failure (e.g. a transient DB hiccup) is caught and
 * reported to the server console rather than thrown, so it can never break
 * the actual create/update/delete/login it's attached to.
 *
 * `username`/`displayName` are snapshotted from `actor` onto the row itself
 * (not just the `userId` foreign key) so the log stays readable — with the
 * name of who did it — even after that user account is later deleted.
 */
export async function recordActivity(params: {
  actor: Actor;
  action: ActivityAction;
  /** Which part of the app this happened in — "clients", "invoices",
   * "users", "settings", "auth", etc. */
  module: string;
  entityId?: string | undefined;
  /** Human-readable line identifying what was affected, e.g.
   * "Invoice INV-045 — Acme Ltd", snapshotted at the time of the action. */
  label?: string;
  /** Optional extra context, e.g. which fields changed on an update. */
  details?: string | undefined;
}): Promise<void> {
  try {
    await db.insert(activityLog).values({
      id: uid("log"),
      userId: params.actor?.id ?? null,
      username: params.actor?.username ?? "system",
      displayName: params.actor?.displayName ?? "",
      action: params.action,
      module: params.module,
      entityId: params.entityId ?? null,
      label: params.label ?? "",
      details: params.details ?? null,
    });
  } catch (err) {
    console.error("recordActivity: failed to write activity log row", err);
  }
}

/**
 * Turns a partial patch object (as sent to an updateX() server fn) into a
 * short "field: value, field2: value2" summary for the activity log's
 * `details` column. Skips keys that are `undefined` (not part of this
 * patch — zod/createServerFn already drops these before the handler runs,
 * this is just belt-and-braces) and truncates long values so one changed
 * field (e.g. a long notes string) can't blow out the log line.
 */
export function changedFieldsSummary(patch: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    let display: string;
    if (value === null) display = "—";
    else if (Array.isArray(value)) display = value.length > 0 ? value.join(", ") : "—";
    else if (typeof value === "object") display = JSON.stringify(value);
    else display = String(value);
    if (display.length > 60) display = `${display.slice(0, 57)}...`;
    parts.push(`${key}: ${display}`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}
