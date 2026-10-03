import bcrypt from "bcryptjs";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie, getRequestHeader } from "@tanstack/react-start/server";
import { db } from "./db";
import { users, sessions, activityLog } from "../../../drizzle/schema";
import { hasPermission, type Action, type Module } from "../permissions";
import { randomToken, sha256Hex } from "./crypto";

/* ------------------------------------------------------------------ *
 * Sessions
 *  - The cookie holds a random 256-bit token. Only its SHA-256 hash is
 *    stored in `sessions.id`, so a leaked database can't be used to
 *    hijack a session.
 *  - Sessions last SESSION_TTL_MS (7 days) — the user stays logged in
 *    on that browser until then or until they press "Log out".
 * ------------------------------------------------------------------ */

const COOKIE_NAME = "ledgerflow_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// Brute-force protection (no schema needed: it counts rows in activity_log).
const THROTTLE_WINDOW_MS = 1000 * 60 * 15;
const MAX_FAILS_PER_IP = 20;
const MAX_FAILS_PER_USER = 10;

export type UserRow = typeof users.$inferSelect;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | undefined;
/** Compares against a throw-away hash when the user doesn't exist, so the
 * response time doesn't reveal which usernames are real. */
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

/** Call after a successful login: creates a session row and sets the cookie. */
export async function createSession(userId: string) {
  const token = randomToken(32);
  const id = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });

  setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return id;
}

export async function destroySession() {
  const token = getCookie(COOKIE_NAME);
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
  deleteCookie(COOKIE_NAME, { path: "/" });
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

/** Current logged-in user plus the id of their session row, or null. */
export async function getCurrentSession() {
  const token = getCookie(COOKIE_NAME);
  if (!token) return null;
  const sessionId = sha256Hex(token);

  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return null;

  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  return { user: row.user, sessionId };
}

/** Reads the session cookie and returns the logged-in user row, or null. */
export async function getCurrentUser() {
  return (await getCurrentSession())?.user ?? null;
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

/** Best-effort cleanup of expired sessions. */
export async function pruneExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/* ------------------------- brute-force protection ------------------------- */

async function recentFailures(filter: ReturnType<typeof eq>): Promise<number> {
  const since = new Date(Date.now() - THROTTLE_WINDOW_MS);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(and(eq(activityLog.action, "login_failed"), filter, gte(activityLog.createdAt, since)));
  return r?.n ?? 0;
}

/** True when this IP has produced too many failed logins recently. */
export async function ipThrottled(ip: string): Promise<boolean> {
  return (await recentFailures(eq(activityLog.details, `ip:${ip}`))) >= MAX_FAILS_PER_IP;
}

/** True when this account has had too many failed logins recently
 * (it unlocks by itself after 15 minutes). */
export async function userThrottled(userId: string): Promise<boolean> {
  return (await recentFailures(eq(activityLog.userId, userId))) >= MAX_FAILS_PER_USER;
}
