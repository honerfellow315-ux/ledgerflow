import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { users } from "../../../drizzle/schema";
import {
  createSession,
  destroySession,
  getCurrentUser,
  pruneExpiredSessions,
  verifyPassword,
} from "../server/auth";
import type { Permissions } from "../permissions";
import { recordActivity } from "../server/activity";

export const login = createServerFn({ method: "POST" })
  .validator(z.object({ username: z.string().min(1), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    await pruneExpiredSessions();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, data.username.trim()))
      .limit(1);

    // Same generic error whether the username or the password was wrong,
    // so login attempts can't be used to enumerate usernames.
    if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
      // No real user to attribute this to — log the attempted username as
      // the label instead, so a run of bad logins is still visible.
      await recordActivity({
        actor: null,
        action: "login_failed",
        module: "auth",
        label: `Attempted username: ${data.username.trim()}`,
      });
      throw new Response("Invalid username or password", { status: 401 });
    }

    await createSession(user.id);
    await recordActivity({
      actor: user,
      action: "login",
      module: "auth",
      entityId: user.id,
      label: user.displayName || user.username,
    });
    return { username: user.username };
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
