/**
 * Creates the first admin login and the default settings row.
 *
 * Usage:
 *   bun run scripts/create-admin.ts myusername mypassword
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import * as schema from "../drizzle/schema";
import { fullPermissions } from "../src/lib/permissions";

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Usage: bun run scripts/create-admin.ts <username> <password>");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
    process.exit(1);
  }

  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) throw new Error("DATABASE_URL is not set — check your .env file.");

  const sql = neon(connectionString);
  const db = drizzle(sql, { schema });

  const id = `admin-${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  const passwordHash = await bcrypt.hash(password, 12);

  await db.insert(schema.users).values({
    id,
    username,
    passwordHash,
    displayName: username,
    role: "admin",
    permissions: fullPermissions(),
  });
  console.log(`Admin user "${username}" created.`);

  // Seed the single settings row if it doesn't exist yet.
  await db.insert(schema.settings).values({ id: "default" }).onConflictDoNothing();
  console.log("Default settings row ensured.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
