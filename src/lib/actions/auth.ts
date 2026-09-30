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
      throw new Response("Invalid username or password", { status: 401 });
    }

    await createSession(user.id);
    return { username: user.username };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  await destroySession();
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
