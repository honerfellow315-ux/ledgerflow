import bcrypt from "bcryptjs";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie, getRequestHeader } from "@tanstack/react-start/server";
import { db } from "./db";
import { users, sessions, activityLog } from "../../../drizzle/schema";
import { hasPermission, type Action, type Module } from "../permissions";
import { makeCode, normalizeCode, randomToken, sha256Hex } from "./crypto";

/* ------------------------------------------------------------------ *
 * Session design
 *  - The cookie holds a random 256-bit token. Only its SHA-256 hash is
 *    stored in `sessions.id`, so a leaked database can't be used to
 *    hijack sessions.
 *  - It is a *session cookie* (no expiry): the browser drops it when it
 *    is closed. The server enforces the real limits: an idle timeout and
 *    an absolute lifetime.
 *  - `stage` lets a half-finished login (2FA setup, forced password
 *    change) exist without granting access to any data.
 * ------------------------------------------------------------------ */

const IS_PROD = process.env["NODE_ENV"] === "production";
// "__Host-" pins the cookie to this exact host over HTTPS (production only,
// the prefix requires `Secure`).
const COOKIE_NAME = IS_PROD ? "__Host-lf_session" : "lf_session";
const LEGACY_COOKIE_NAME = "ledgerflow_session";

const ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 12; // 12 h hard cap, however active
const PENDING_TTL_MS = 1000 * 60 * 10; // half-finished logins live 10 min
const ADMIN_IDLE_MS = 1000 * 60 * 15;
const USER_IDLE_MS = 1000 * 60 * 30;

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MS = 1000 * 60 * 15;
const IP_WINDOW_MS = 1000 * 60 * 15;
const IP_MAX_FAILURES = 20;

export const ACTIVATION_TTL_MS = 1000 * 60 * 60 * 24;
export const MAX_ACTIVATION_ATTEMPTS = 5;

export type SessionStage = "full" | "totp_setup" | "change_password";
export type UserRow = typeof users.$inferSelect;

export function idleTimeoutMs(role: "admin" | "user"): number {
  return role === "admin" ? ADMIN_IDLE_MS : USER_IDLE_MS;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | undefined;
/** Verifies against a throw-away hash when the user doesn't exist, so response
 * time doesn't reveal which usernames are real. */
export async function verifyPasswordOrDummy(password: string, hash: string | undefined) {
  if (hash) return bcrypt.compare(password, hash);
  dummyHash ??= bcrypt.hash("not-a-real-password", 12);
  await bcrypt.compare(password, await dummyHash);
  return false;
}

/** Best-effort client IP (Vercel/Cloudflare/nginx set x-forwarded-for). */
export function getClientIp(): string {
  const xff = getRequestHeader("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return (first || getRequestHeader("x-real-ip") || "unknown").slice(0, 64);
}

/** Creates a session row and sets the (session-only) cookie. */
export async function createSession(userId: string, stage: SessionStage = "full") {
  // A user only ever has one half-finished login at a time.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.stage, "full")));

  const token = randomToken(32);
  const id = sha256Hex(token);
  const now = Date.now();
  const expiresAt = new Date(now + (stage === "full" ? ABSOLUTE_TTL_MS : PENDING_TTL_MS));
  await db.insert(sessions).values({ id, userId, expiresAt, stage, lastActiveAt: new Date(now) });

  setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "strict",
    path: "/",
    // no `expires` / `maxAge`  ->  cookie is discarded when the browser closes
  });
  deleteCookie(LEGACY_COOKIE_NAME, { path: "/" });
  return id;
}

export async function destroySession() {
  const token = getCookie(COOKIE_NAME);
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
  deleteCookie(COOKIE_NAME, { path: "/" });
  deleteCookie(LEGACY_COOKIE_NAME, { path: "/" });
}

/** Signs a user out of every device (optionally keeping one session). */
export async function deleteSessionsForUser(userId: string, exceptSessionId?: string) {
  await db
    .delete(sessions)
    .where(
      exceptSessionId
        ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
        : eq(sessions.userId, userId),
    );
}

async function loadSession(stage: SessionStage) {
  const token = getCookie(COOKIE_NAME);
  if (!token) return null;
  const sessionId = sha256Hex(token);

  const [row] = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return null;

  const now = Date.now();
  const { session, user } = row;

  if (session.expiresAt.getTime() < now) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  if (session.stage !== stage) return null;

  if (stage === "full") {
    const lastActive = session.lastActiveAt.getTime();
    if (now - lastActive > idleTimeoutMs(user.role)) {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
      return null;
    }
    // Refresh the idle clock (at most once a minute to keep DB writes low).
    if (now - lastActive > 60_000) {
      await db
        .update(sessions)
        .set({ lastActiveAt: new Date(now) })
        .where(eq(sessions.id, sessionId));
    }
  }
  return { user, sessionId };
}

/** Fully logged-in user + their session id, or null. */
export async function getCurrentSession() {
  return loadSession("full");
}

/** Reads the session cookie and returns the logged-in user row, or null. */
export async function getCurrentUser() {
  return (await loadSession("full"))?.user ?? null;
}

/** A half-finished login (2FA setup / forced password change), or null. */
export async function getPendingSession(stage: Exclude<SessionStage, "full">) {
  return loadSession(stage);
}

/** Throws a 401 if there's no valid session. Call this at the top of every
 * protected server function. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return user;
}

/** Throws a 401 if not logged in, or a 403 if logged in but not permitted to
 * perform `action` on `module`. Admins always pass. Use this instead of
 * `requireUser()` in every list/add/update/delete server function — this is
 * the real security boundary (the frontend `can()` check is UX only). */
export async function requirePermission(module: Module, action: Action) {
  const user = await requireUser();
  if (!hasPermission(user.role, user.permissions, module, action)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}

/** Throws a 401 if not logged in, or a 403 if logged in but not an admin.
 * Use for admin-only surfaces like user management. */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}

/** Best-effort cleanup of expired / long-idle sessions. */
export async function pruneExpiredSessions() {
  const now = Date.now();
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now)));
  // Anything idle longer than the most generous idle limit is dead too.
  await db.delete(sessions).where(lt(sessions.lastActiveAt, new Date(now - USER_IDLE_MS)));
}

/* ------------------------- brute-force protection ------------------------- */

export function isLocked(user: UserRow): boolean {
  return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
}

/** Counts a failed attempt (atomically) and locks the account after too many. */
export async function registerFailure(user: UserRow) {
  const [r] = await db
    .update(users)
    .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
    .where(eq(users.id, user.id))
    .returning({ count: users.failedLoginCount });
  if (r && r.count >= MAX_FAILED_ATTEMPTS) {
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) })
      .where(eq(users.id, user.id));
  }
}

export async function clearFailures(userId: string) {
  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, userId));
}

/** True when this IP has produced too many failed logins recently. */
export async function ipThrottled(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - IP_WINDOW_MS);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.action, "login_failed"),
        eq(activityLog.details, `ip:${ip}`),
        gte(activityLog.createdAt, since),
      ),
    );
  return (r?.n ?? 0) >= IP_MAX_FAILURES;
}

/* ----------------------------- activation codes ----------------------------- */

export function hashUserCode(userId: string, code: string) {
  return sha256Hex(`${userId}:${normalizeCode(code)}`);
}

/**
 * Issues a fresh one-time activation code for a user. Returns the plain code —
 * it is shown to the admin exactly once and only its hash is stored.
 * Also signs the user out everywhere and clears any lockout.
 */
export async function issueActivationCode(userId: string): Promise<string> {
  const code = makeCode(8, 4);
  await db
    .update(users)
    .set({
      mustActivate: true,
      activationCodeHash: hashUserCode(userId, code),
      activationExpiresAt: new Date(Date.now() + ACTIVATION_TTL_MS),
      activationAttempts: 0,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId));
  await deleteSessionsForUser(userId);
  return code;
}
