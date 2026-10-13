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
// A session now expires after SESSION_IDLE_MS without use (it slides forward
// while the person is working) and can never live longer than
// SESSION_MAX_MS in total, however active they are.
const SESSION_IDLE_MS = 1000 * 60 * 60 * 12; // 12 hours idle
const SESSION_MAX_MS = 1000 * 60 * 60 * 24 * 7; // 7 days absolute
const SESSION_REFRESH_AFTER_MS = 1000 * 60 * 10; // write at most every 10 min

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
  const expiresAt = new Date(Date.now() + SESSION_IDLE_MS);
  // A fresh token is issued on every login; retire whichever session this
  // browser was holding so an old token can't be carried over.
  const oldToken = getCookie(COOKIE_NAME);
  if (oldToken) await db.delete(sessions).where(eq(sessions.id, sha256Hex(oldToken)));
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
    .select({ user: users, expiresAt: sessions.expiresAt, createdAt: sessions.createdAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return null;

  const now = Date.now();
  if (row.expiresAt.getTime() < now || row.createdAt.getTime() + SESSION_MAX_MS < now) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  // Sliding idle window: push expiry forward while the person keeps working.
  const target = Math.min(now + SESSION_IDLE_MS, row.createdAt.getTime() + SESSION_MAX_MS);
  if (target - row.expiresAt.getTime() > SESSION_REFRESH_AFTER_MS) {
    const next = new Date(target);
    try {
      await db.update(sessions).set({ expiresAt: next }).where(eq(sessions.id, sessionId));
      setCookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env["NODE_ENV"] === "production",
        sameSite: "lax",
        path: "/",
        expires: next,
      });
    } catch {
      /* best effort: the session is still valid until its old expiry */
    }
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

/* ------------------------- brute-force protection -------------------------
 * Failed logins are rows in activity_log (action "login_failed") whose
 * `details` is `ip:<addr>|u:<hash of the lower-cased typed username>`.
 *  - per IP:            too many failures from one address
 *  - per IP + username: too many guesses at one account from one address
 *  - per username:      a high global cap that slows a distributed attack
 * Because the per-account limit is tied to the attacker's own IP, a stranger
 * can no longer lock the real admin out by typing wrong passwords from
 * elsewhere. The username hash is computed whether or not the account
 * exists, so throttling never reveals which usernames are real.
 * ------------------------------------------------------------------------- */

const MAX_FAILS_PER_USERNAME_GLOBAL = 60;
const FAILED_LOGIN_RETENTION_MS = 1000 * 60 * 60 * 24 * 30;

/** Keeps only characters a real IP can contain (stops LIKE wildcards). */
function safeIp(ip: string): string {
  return /^[0-9a-fA-F:.]{1,64}$/.test(ip) ? ip : "unknown";
}

export function usernameKey(username: string): string {
  return sha256Hex(username.trim().toLowerCase()).slice(0, 16);
}

export function loginFailureDetails(ip: string, username: string): string {
  return `ip:${safeIp(ip)}|u:${usernameKey(username)}`;
}

async function countFailures(where: ReturnType<typeof sql>): Promise<number> {
  const since = new Date(Date.now() - THROTTLE_WINDOW_MS);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(and(eq(activityLog.action, "login_failed"), where, gte(activityLog.createdAt, since)));
  return r?.n ?? 0;
}

/** True when this login attempt must be refused for now. One answer for every
 * reason, so the caller can show one message. */
export async function loginThrottled(ip: string, username: string): Promise<boolean> {
  const safe = safeIp(ip);
  const key = usernameKey(username);
  const [fromIp, fromIpForUser, forUser] = await Promise.all([
    countFailures(sql`${activityLog.details} LIKE ${`ip:${safe}|%`}`),
    countFailures(sql`${activityLog.details} = ${`ip:${safe}|u:${key}`}`),
    countFailures(sql`${activityLog.details} LIKE ${`%|u:${key}`}`),
  ]);
  return (
    fromIp >= MAX_FAILS_PER_IP ||
    fromIpForUser >= MAX_FAILS_PER_USER ||
    forUser >= MAX_FAILS_PER_USERNAME_GLOBAL
  );
}

/** Deletes old failed-login rows so the table can't grow without limit. */
export async function pruneOldLoginFailures() {
  await db
    .delete(activityLog)
    .where(
      and(
        eq(activityLog.action, "login_failed"),
        lt(activityLog.createdAt, new Date(Date.now() - FAILED_LOGIN_RETENTION_MS)),
      ),
    );
}
