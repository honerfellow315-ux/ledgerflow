import { createServerFn } from "@tanstack/react-start";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { users } from "../../../drizzle/schema";
import {
  deleteSessionsForUser,
  getCurrentSession,
  hashPassword,
  requireAdmin,
} from "../server/auth";
import { validatePassword } from "../passwordPolicy";
import { uid } from "../server/id";
import { ACTIONS, MODULES, type Permissions } from "../permissions";
import { recordActivity, changedFieldsSummary } from "../server/activity";

const permissionsInput: z.ZodType<Permissions> = z
  .object(
    Object.fromEntries(
      MODULES.map((module) => [
        module,
        z
          .object(Object.fromEntries(ACTIONS.map((action) => [action, z.boolean().optional()])))
          .partial()
          .optional(),
      ]),
    ),
  )
  .partial();

const createUserInput = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
  displayName: z.string().default(""),
  role: z.enum(["admin", "user"]).default("user"),
  permissions: permissionsInput.default({}),
});

const updateUserInput = z.object({
  id: z.string(),
  patch: z.object({
    displayName: z.string().optional(),
    password: z.string().min(1).max(200).optional(),
    role: z.enum(["admin", "user"]).optional(),
    permissions: permissionsInput.optional(),
  }),
});

/** Never send the password hash to the browser. */
function publicUser(row: typeof users.$inferSelect) {
  const { passwordHash: _passwordHash, ...rest } = row;
  return rest;
}

export const listUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const rows = await db.select().from(users).orderBy(users.username);
  return rows.map(publicUser);
});

export const createUser = createServerFn({ method: "POST" })
  .validator(createUserInput)
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const username = data.username.trim();
    const problem = validatePassword(data.password, username);
    if (problem) throw new Response(problem, { status: 400 });

    const passwordHash = await hashPassword(data.password);
    const [row] = await db
      .insert(users)
      .values({
        id: uid("usr"),
        username,
        passwordHash,
        displayName: data.displayName,
        role: data.role,
        permissions: data.permissions,
        createdBy: admin.id,
      })
      .returning();
    if (row) {
      await recordActivity({
        actor: admin,
        action: "created",
        module: "users",
        entityId: row.id,
        label: row.displayName || row.username,
        details: `Role: ${row.role}`,
      });
    }
    return row && publicUser(row);
  });

export const updateUser = createServerFn({ method: "POST" })
  .validator(updateUserInput)
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { password, ...rest } = data.patch;

    if (data.id === admin.id && rest.role && rest.role !== "admin") {
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
      if (admins.length <= 1) {
        throw new Response("Cannot remove admin role from the last remaining admin.", {
          status: 400,
        });
      }
    }

    const patch: Partial<typeof users.$inferInsert> = { ...rest };
    if (password) {
      const [target] = await db.select().from(users).where(eq(users.id, data.id)).limit(1);
      const problem = validatePassword(password, target?.username);
      if (problem) throw new Response(problem, { status: 400 });
      patch.passwordHash = await hashPassword(password);
    }

    const [row] = await db.update(users).set(patch).where(eq(users.id, data.id)).returning();
    if (row && (password || rest.role)) {
      // A changed password or role invalidates that user's other logins
      // (the admin editing their own account stays signed in).
      const current = await getCurrentSession();
      await deleteSessionsForUser(row.id, row.id === admin.id ? current?.sessionId : undefined);
    }
    if (row) {
      await recordActivity({
        actor: admin,
        action: "updated",
        module: "users",
        entityId: row.id,
        label: row.displayName || row.username,
        details: changedFieldsSummary({ ...rest, password: password ? "••••••••" : undefined }),
      });
    }
    return row && publicUser(row);
  });

export const deleteUser = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();

    if (data.id === admin.id) {
      throw new Response("You cannot delete your own account.", { status: 400 });
    }

    const [target] = await db.select().from(users).where(eq(users.id, data.id)).limit(1);
    if (target?.role === "admin") {
      const otherAdmins = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "admin"), ne(users.id, data.id)));
      if (otherAdmins.length === 0) {
        throw new Response("Cannot delete the last remaining admin.", { status: 400 });
      }
    }

    await db.delete(users).where(eq(users.id, data.id));
    await recordActivity({
      actor: admin,
      action: "deleted",
      module: "users",
      entityId: data.id,
      label: target?.displayName || target?.username || data.id,
    });
    return { ok: true };
  });
