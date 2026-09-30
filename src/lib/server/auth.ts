import bcrypt from "bcryptjs";
import { eq, lt } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { db } from "./db";
import { users, sessions } from "../../../drizzle/schema";
import { uid } from "./id";
import { hasPermission, type Action, type Module } from "../permissions";

const COOKIE_NAME = "ledgerflow_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** Call after a successful login: creates a session row and sets the cookie. */
export async function createSession(userId: string) {
  const id = uid("sess");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });

  setCookie(COOKIE_NAME, id, {
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
  if (token) await db.delete(sessions).where(eq(sessions.id, token));
  deleteCookie(COOKIE_NAME, { path: "/" });
}

/** Reads the session cookie and returns the logged-in user row, or null. */
export async function getCurrentUser() {
  const token = getCookie(COOKIE_NAME);
  if (!token) return null;

  const [row] = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .limit(1);

  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, token));
    return null;
  }
  return row.user;
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

/** Best-effort cleanup of expired sessions — safe to call occasionally, e.g. on login. */
export async function pruneExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
