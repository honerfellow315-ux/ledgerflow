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
export const db = drizzle(sql, { schema });
