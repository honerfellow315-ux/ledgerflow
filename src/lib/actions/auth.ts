import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { users, recoveryCodes } from "../../../drizzle/schema";
import {
  MAX_ACTIVATION_ATTEMPTS,
  clearFailures,
  createSession,
  deleteSessionsForUser,
  destroySession,
  getClientIp,
  getCurrentUser,
  getPendingSession,
  hashPassword,
  hashUserCode,
  idleTimeoutMs,
  ipThrottled,
  isLocked,
  pruneExpiredSessions,
  registerFailure,
  verifyPasswordOrDummy,
  type UserRow,
} from "../server/auth";
import { decryptString, encryptString, makeCode, normalizeCode, safeEqual } from "../server/crypto";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../server/totp";
import { recordActivity } from "../server/activity";
import { uid } from "../server/id";
import { validatePassword } from "../passwordPolicy";
import type { Permissions } from "../permissions";

/**
 * Login is a small state machine. The server never creates a full session
 * until every required step has passed:
 *
 *   password ──► (non-admin needing activation) ─► activation code ─► choose new password ─► in
 *            └─► (admin, 2FA not set up yet)    ─► scan QR + confirm code ─► save backup codes ─► in
 *            └─► (admin, 2FA enabled)           ─► 6-digit code / backup code ─► in
 *
 * Expected failures are *returned* as `{ status: "error", message }` (not
 * thrown) so the UI can show a precise message.
 */
export type LoginResult =
  | { status: "ok" }
  | { status: "need_totp" }
  | { status: "need_activation" }
  | { status: "totp_setup" }
  | { status: "change_password" }
  | { status: "error"; message: string };

const GENERIC_LOGIN_ERROR = "Incorrect username or password.";
const LOCKED_MESSAGE = "Too many failed attempts. This account is locked for 15 minutes.";

async function logFailure(
  username: string,
  reason: string,
  ip: string,
  actor: UserRow | null = null,
) {
  await recordActivity({
    actor,
    action: "login_failed",
    module: "auth",
    label: `Attempted username: ${username.slice(0, 64)} (${reason})`,
    // `ip:<addr>` is what the per-IP throttle counts — keep this exact format.
    details: `ip:${ip}`,
  });
}

/** Valid 6-digit authenticator code OR an unused backup code. */
async function verifySecondFactor(user: UserRow, rawCode: string): Promise<boolean> {
  const code = rawCode.replace(/\s/g, "");

  if (/^\d{6}$/.test(code)) {
    if (!user.totpSecretEnc) return false;
    const secret = decryptString(user.totpSecretEnc, "totp");
    const step = verifyTotp(secret, code, Date.now(), user.totpLastStep);
    if (step === null) return false;
    // Atomic "only if newer": a replayed code (same step) updates nothing.
    const updated = await db
      .update(users)
      .set({ totpLastStep: step })
      .where(
        and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))),
      )
      .returning({ id: users.id });
    return updated.length > 0;
  }

  // Backup (recovery) code — single use.
  const hash = hashUserCode(user.id, code);
  const used = await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(recoveryCodes.userId, user.id),
        eq(recoveryCodes.codeHash, hash),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return used.length > 0;
}

export const login = createServerFn({ method: "POST" })
  .validator(
    z.object({
      username: z.string().min(1).max(64),
      password: z.string().min(1).max(200),
      code: z.string().max(40).optional(),
    }),
  )
  .handler(async ({ data }): Promise<LoginResult> => {
    const username = data.username.trim();
    const ip = getClientIp();

    if (await ipThrottled(ip)) {
      return { status: "error", message: "Too many attempts from this network. Try again later." };
    }
    await pruneExpiredSessions();

    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

    // A locked account refuses even the correct password — otherwise the lock
    // would not stop a guessing attack.
    if (user && isLocked(user)) return { status: "error", message: LOCKED_MESSAGE };

    const passwordOk = await verifyPasswordOrDummy(data.password, user?.passwordHash);
    if (!user || !passwordOk) {
      await logFailure(username, "bad password", ip, user ?? null);
      if (user) await registerFailure(user);
      return { status: "error", message: GENERIC_LOGIN_ERROR };
    }

    /* ---- Step: activation code (non-admins flagged by an admin) ---- */
    if (user.mustActivate && user.role !== "admin") {
      if (!data.code) return { status: "need_activation" };

      const expired =
        !user.activationCodeHash ||
        !user.activationExpiresAt ||
        user.activationExpiresAt.getTime() < Date.now() ||
        user.activationAttempts >= MAX_ACTIVATION_ATTEMPTS;
      if (expired) {
        await logFailure(username, "activation code unavailable", ip, user);
        return {
          status: "error",
          message: "No valid activation code. Ask your administrator to generate a new one.",
        };
      }

      if (!safeEqual(hashUserCode(user.id, data.code), user.activationCodeHash!)) {
        await db
          .update(users)
          .set({ activationAttempts: sql`${users.activationAttempts} + 1` })
          .where(eq(users.id, user.id));
        await logFailure(username, "bad activation code", ip, user);
        return { status: "error", message: "Invalid activation code." };
      }

      await createSession(user.id, "change_password");
      return { status: "change_password" };
    }

    /* ---- Step: two-factor (admins always; anyone who enabled it) ---- */
    if (user.role === "admin" || user.totpEnabled) {
      if (!user.totpEnabled) {
        await createSession(user.id, "totp_setup");
        return { status: "totp_setup" };
      }
      if (!data.code) return { status: "need_totp" };

      if (!(await verifySecondFactor(user, data.code))) {
        await logFailure(username, "bad 2FA code", ip, user);
        await registerFailure(user);
        return { status: "error", message: "Invalid authentication code." };
      }
    }

    await clearFailures(user.id);
    await createSession(user.id, "full");
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

/* ------------------------- admin 2FA enrolment ------------------------- */

export const totpSetupStart = createServerFn({ method: "POST" }).handler(async () => {
  const pending = await getPendingSession("totp_setup");
  if (!pending) {
    return { status: "error" as const, message: "Session expired. Please log in again." };
  }
  const { user } = pending;
  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({ totpSecretEnc: encryptString(secret, "totp"), totpEnabled: false, totpLastStep: null })
    .where(eq(users.id, user.id));

  // Imported lazily so the QR library stays out of the client bundle.
  const QRCode = (await import("qrcode")).default;
  const qr = await QRCode.toDataURL(otpauthUrl(secret, user.username), {
    margin: 1,
    width: 224,
  });
  return { status: "ok" as const, secret, qr };
});

export const totpSetupConfirm = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string().min(1).max(20) }))
  .handler(async ({ data }) => {
    const pending = await getPendingSession("totp_setup");
    if (!pending) {
      return { status: "error" as const, message: "Session expired. Please log in again." };
    }
    const { user } = pending;
    if (isLocked(user)) return { status: "error" as const, message: LOCKED_MESSAGE };
    if (!user.totpSecretEnc) {
      return { status: "error" as const, message: "Setup not started. Reload and try again." };
    }

    const step = verifyTotp(
      decryptString(user.totpSecretEnc, "totp"),
      data.code.replace(/\s/g, ""),
      Date.now(),
      null,
    );
    if (step === null) {
      await registerFailure(user);
      return { status: "error" as const, message: "That code is not correct. Try the next one." };
    }

    await db
      .update(users)
      .set({ totpEnabled: true, totpLastStep: step })
      .where(eq(users.id, user.id));

    // 8 single-use backup codes; only hashes are stored.
    const plainCodes = Array.from({ length: 8 }, () => makeCode(10, 5));
    await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
    await db.insert(recoveryCodes).values(
      plainCodes.map((c) => ({
        id: uid("rc"),
        userId: user.id,
        codeHash: hashUserCode(user.id, normalizeCode(c)),
      })),
    );

    await clearFailures(user.id);
    await createSession(user.id, "full");
    await recordActivity({
      actor: user,
      action: "updated",
      module: "auth",
      entityId: user.id,
      label: user.displayName || user.username,
      details: "Two-factor authentication enabled",
    });
    return { status: "ok" as const, recoveryCodes: plainCodes };
  });

/* ---------------------- first-login password choice ---------------------- */

export const completeActivation = createServerFn({ method: "POST" })
  .validator(z.object({ newPassword: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const pending = await getPendingSession("change_password");
    if (!pending) {
      return { status: "error" as const, message: "Session expired. Please log in again." };
    }
    const { user } = pending;

    const problem = validatePassword(data.newPassword, user.username);
    if (problem) return { status: "error" as const, message: problem };

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(data.newPassword),
        mustActivate: false,
        activationCodeHash: null,
        activationExpiresAt: null,
        activationAttempts: 0,
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(eq(users.id, user.id));
    await deleteSessionsForUser(user.id);

    await recordActivity({
      actor: user,
      action: "updated",
      module: "auth",
      entityId: user.id,
      label: user.displayName || user.username,
      details: "Account activated, password chosen",
    });

    // If this account also needs a second factor, make them go through the
    // normal login (with the new password) rather than skipping it here.
    if (user.role === "admin" || user.totpEnabled) {
      return { status: "relogin" as const };
    }
    await createSession(user.id, "full");
    return { status: "ok" as const };
  });

/* ------------------------------ session ------------------------------ */

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
// Calling it also counts as activity for the server-side idle timeout.
export const me = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    permissions: (user.permissions as Permissions) ?? {},
    idleTimeoutMs: idleTimeoutMs(user.role),
  };
});
