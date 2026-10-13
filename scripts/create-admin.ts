/**
 * Creates the first admin login and the default settings row.
 *
 * Usage:
 *   bun run scripts/create-admin.ts myusername
 *     (the password is asked for with hidden typing, so it never lands in
 *      your shell history), or set CREATE_ADMIN_PASSWORD in the environment.
 *   Passing the password as a 2nd argument still works but is discouraged.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import * as schema from "../drizzle/schema";
import { fullPermissions } from "../src/lib/permissions";
import { validatePassword } from "../src/lib/passwordPolicy";

/** Reads a line from the terminal without echoing what is typed. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    let started = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (!started) write.call(rl, s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    started = true;
  });
}

async function main() {
  const [username, passwordArg] = process.argv.slice(2);
  if (!username) {
    console.error("Usage: bun run scripts/create-admin.ts <username>");
    process.exit(1);
  }
  const password =
    passwordArg || process.env["CREATE_ADMIN_PASSWORD"] || (await askHidden("Password: "));
  if (!password) {
    console.error("A password is required.");
    process.exit(1);
  }
  const problem = validatePassword(password, username);
  if (problem) {
    console.error(problem);
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
