import { createServerFn } from "@tanstack/react-start";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { users } from "../../../drizzle/schema";
import {
  createSession,
  destroySession,
  getClientIp,
  getCurrentUser,
  loginFailureDetails,
  loginThrottled,
  pruneExpiredSessions,
  pruneOldLoginFailures,
  verifyPasswordOrDummy,
  type UserRow,
} from "../server/auth";
import { recordActivity } from "../server/activity";
import { activityLog } from "../../../drizzle/schema";
import { uid } from "../server/id";
import type { Permissions } from "../permissions";

export type LoginResult = { status: "ok" } | { status: "error"; message: string };

/** Written straight to the table (not via the fail-safe recordActivity) on
 * purpose: the brute-force throttle counts these rows, so if the write fails
 * the login must fail too instead of silently switching protection off. */
async function logFailure(username: string, ip: string, actor: UserRow | null) {
  await db.insert(activityLog).values({
    id: uid("log"),
    userId: actor?.id ?? null,
    username: actor?.username ?? "system",
    displayName: actor?.displayName ?? "",
    action: "login_failed",
    module: "auth",
    // Never store what was typed for an unknown account: people sometimes
    // paste their password into the username box.
    label: actor ? `Failed login: ${actor.username}` : "Failed login: unknown username",
    details: loginFailureDetails(ip, username),
  });
}

const THROTTLE_MESSAGE = "Too many attempts. Please try again in a few minutes.";

export const login = createServerFn({ method: "POST" })
  .validator(
    z.object({
      username: z.string().min(1).max(64),
      password: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }): Promise<LoginResult> => {
    const username = data.username.trim();
    const ip = getClientIp();

    if (await loginThrottled(ip, username)) {
      return { status: "error", message: THROTTLE_MESSAGE };
    }
    await pruneExpiredSessions();
    await pruneOldLoginFailures();

    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
      .limit(1);

    const passwordOk = await verifyPasswordOrDummy(data.password, user?.passwordHash);
    if (!user || !passwordOk) {
      await logFailure(username, ip, user ?? null);
      return { status: "error", message: "Incorrect username or password." };
    }

    await createSession(user.id);
    await recordActivity({
      actor: user,
      action: "login",
      module: "auth",
      entityId: user.id,
      label: user.displayName || user.username,
      details: `ip:${ip}`,
    });
    return { status: "ok" };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  // Grab who's logging out before the session (and with it getCurrentUser)
  // is gone.
  const user = await getCurrentUser();
  await destroySession();
  if (user) {
    await recordActivity({
      actor: user,
      action: "logout",
      module: "auth",
      entityId: user.id,
      label: user.displayName || user.username,
    });
  }
  return { ok: true };
});

// Includes role + permissions so the frontend can hydrate usePermissions()
// on load (see src/lib/ledger/permissions.tsx) without a second round trip.
export const me = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    permissions: (user.permissions as Permissions) ?? {},
  };
});
