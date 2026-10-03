import { createServerFn } from "@tanstack/react-start";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { users, recoveryCodes } from "../../../drizzle/schema";
import {
  deleteSessionsForUser,
  getCurrentSession,
  hashPassword,
  issueActivationCode,
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

/** Never send secrets (password hash, 2FA secret, activation-code hash) to the browser. */
function publicUser(row: typeof users.$inferSelect) {
  const {
    passwordHash: _passwordHash,
    totpSecretEnc: _totpSecretEnc,
    activationCodeHash: _activationCodeHash,
    totpLastStep: _totpLastStep,
    ...rest
  } = row;
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
    if (!row) return row;

    // New non-admin accounts can't log in until the admin hands over a
    // one-time activation code. (New admins instead must set up 2FA.)
    let activationCode: string | undefined;
    if (row.role === "user") activationCode = await issueActivationCode(row.id);

    await recordActivity({
      actor: admin,
      action: "created",
      module: "users",
      entityId: row.id,
      label: row.displayName || row.username,
      details: `Role: ${row.role}`,
    });
    // Same shape as before, plus the code (only present for non-admin users).
    return { ...publicUser(row), activationCode };
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

/* ----------------------- security actions (admin only) ----------------------- */

/**
 * Generates a new one-time activation code for a non-admin user (new user,
 * existing user after the security update, or a user who forgot their
 * password). The user is signed out everywhere. The code is returned ONCE.
 */
export const generateActivationCode = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const [target] = await db.select().from(users).where(eq(users.id, data.id)).limit(1);
    if (!target) throw new Response("User not found.", { status: 404 });
    if (target.role === "admin") {
      throw new Response("Administrators use two-factor authentication, not activation codes.", {
        status: 400,
      });
    }
    const code = await issueActivationCode(target.id);
    await recordActivity({
      actor: admin,
      action: "updated",
      module: "users",
      entityId: target.id,
      label: target.displayName || target.username,
      details: "Activation code generated",
    });
    return { code, username: target.username };
  });

/** Removes a user's 2FA so they must enrol again (lost phone). Not for yourself. */
export const resetUserTotp = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (data.id === admin.id) {
      throw new Response("Use another administrator (or the reset script) to reset your own 2FA.", {
        status: 400,
      });
    }
    const [target] = await db.select().from(users).where(eq(users.id, data.id)).limit(1);
    if (!target) throw new Response("User not found.", { status: 404 });

    await db
      .update(users)
      .set({
        totpEnabled: false,
        totpSecretEnc: null,
        totpLastStep: null,
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(eq(users.id, target.id));
    await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, target.id));
    await deleteSessionsForUser(target.id);
    await recordActivity({
      actor: admin,
      action: "updated",
      module: "users",
      entityId: target.id,
      label: target.displayName || target.username,
      details: "Two-factor authentication reset",
    });
    return { ok: true };
  });

/** Signs a user out of every device and clears any login lockout. */
export const revokeUserSessions = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const [target] = await db.select().from(users).where(eq(users.id, data.id)).limit(1);
    if (!target) throw new Response("User not found.", { status: 404 });

    const current = await getCurrentSession();
    await deleteSessionsForUser(target.id, target.id === admin.id ? current?.sessionId : undefined);
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, target.id));
    await recordActivity({
      actor: admin,
      action: "updated",
      module: "users",
      entityId: target.id,
      label: target.displayName || target.username,
      details: "Signed out of all devices / lockout cleared",
    });
    return { ok: true };
  });
