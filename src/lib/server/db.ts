import { sql as querySql } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as transactionalDrizzle } from "drizzle-orm/neon-serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../../../drizzle/schema";

// DATABASE_URL comes from your Neon project's connection string, e.g:
// postgresql://user:password@ep-xxxx.eu-west-2.aws.neon.tech/ledgerflow?sslmode=require
const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Add it to your .env file (see .env.example).");
}

const sql = neon(connectionString);
const httpDb = drizzle(sql, { schema });
const context = new AsyncLocalStorage<typeof httpDb>();
export const db = new Proxy(httpDb, {
  get(_target, key) {
    const current = context.getStore() ?? httpDb;
    const value = Reflect.get(current, key);
    return typeof value === "function" ? value.bind(current) : value;
  },
});
export async function withTransaction<T>(work: () => Promise<T>): Promise<T> {
  if (context.getStore()) return work();
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const pool = new Pool({ connectionString, max: 1 });
  try {
    return await transactionalDrizzle(pool, { schema }).transaction(async (tx) =>
      context.run(tx as unknown as typeof httpDb, async () => {
        const result = await work();
        // A caught SQL error must never turn an aborted transaction into a success response.
        await tx.execute(querySql`SELECT 1`);
        return result;
      }),
    );
  } finally {
    await pool.end();
  }
}

// Import and invoice writes need one connection so a failure rolls back the whole operation.
