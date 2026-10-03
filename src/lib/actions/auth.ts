import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { users } from "../../../drizzle/schema";
import {
  createSession,
  destroySession,
  getClientIp,
  getCurrentUser,
  ipThrottled,
  pruneExpiredSessions,
  userThrottled,
  verifyPasswordOrDummy,
  type UserRow,
} from "../server/auth";
import { recordActivity } from "../server/activity";
import type { Permissions } from "../permissions";

export type LoginResult = { status: "ok" } | { status: "error"; message: string };

async function logFailure(username: string, ip: string, actor: UserRow | null) {
  await recordActivity({
    actor,
    action: "login_failed",
    module: "auth",
    label: `Attempted username: ${username.slice(0, 64)}`,
    // `ip:<addr>` is what the per-IP throttle counts — keep this exact format.
    details: `ip:${ip}`,
  });
}

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

    if (await ipThrottled(ip)) {
      return { status: "error", message: "Too many attempts. Please try again in a few minutes." };
    }
    await pruneExpiredSessions();

    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

    if (user && (await userThrottled(user.id))) {
      return {
        status: "error",
        message: "Too many failed attempts. Please try again in 15 minutes.",
      };
    }

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
