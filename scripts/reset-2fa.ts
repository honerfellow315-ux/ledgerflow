/**
 * Emergency recovery: removes a user's two-factor authentication, signs them
 * out everywhere and clears any lockout. Use it when the ONLY admin lost both
 * their authenticator app and their backup codes. At their next login they
 * must set up 2FA again.
 *
 * Usage:
 *   bun run scripts/reset-2fa.ts <username>
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../drizzle/schema";

async function main() {
  const [username] = process.argv.slice(2);
  if (!username) {
    console.error("Usage: bun run scripts/reset-2fa.ts <username>");
    process.exit(1);
  }
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) throw new Error("DATABASE_URL is not set — check your .env file.");

  const db = drizzle(neon(connectionString), { schema });
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  if (!user) {
    console.error(`No user named "${username}".`);
    process.exit(1);
  }

  await db
    .update(schema.users)
    .set({
      totpEnabled: false,
      totpSecretEnc: null,
      totpLastStep: null,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(schema.users.id, user.id));
  await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, user.id));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
  console.log(`2FA reset for "${username}". They will set it up again at next login.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
