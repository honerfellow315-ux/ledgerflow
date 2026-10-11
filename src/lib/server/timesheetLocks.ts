import { sql } from "drizzle-orm";
import type { Db } from "./shiftImport";
export async function assertTimesheetMonthOpen(db: Db, month: string) {
  const result = await db.execute(
    sql`SELECT locked FROM timesheet_month_locks WHERE month = ${month}`,
  );
  if (result.rows[0]?.["locked"])
    throw new Error(`Timesheet month ${month} is locked. Reopen it before making changes.`);
}
