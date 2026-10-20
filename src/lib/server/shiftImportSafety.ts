/**
 * Safety net around shift imports.
 *
 *  - previewExisting : what is already in the sheet for a period + company
 *  - snapshotBeforeImport : saves the shifts + RSS/ESS columns BEFORE an import changes them
 *  - undoLastImport : puts that snapshot back
 *
 * The backup table is created on first use (CREATE TABLE IF NOT EXISTS), so the
 * patch works even if the SQL migration was never run.
 */
import { sql } from "drizzle-orm";
import type { Db } from "./shiftImport";
import { recomputeFromShifts } from "./salaryShifts";
import { uid } from "./id";

export async function ensureBackupTable(db: Db): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS salary_import_backups (
      id          text PRIMARY KEY,
      period_id   text NOT NULL,
      source      text NOT NULL,
      mode        text NOT NULL,
      actor_name  text NOT NULL DEFAULT '',
      file_name   text NOT NULL DEFAULT '',
      created_at  timestamptz NOT NULL DEFAULT now(),
      undone_at   timestamptz,
      shifts_before integer NOT NULL DEFAULT 0,
      shifts_after  integer NOT NULL DEFAULT 0,
      shifts      jsonb NOT NULL DEFAULT '[]'::jsonb,
      entries     jsonb NOT NULL DEFAULT '[]'::jsonb
    )`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS salary_import_backups_period_idx
    ON salary_import_backups (period_id, source, created_at DESC)`);
}

export interface ExistingStats {
  shifts: number;
  people: number;
  hours: number;
  amount: number;
}

export async function previewExisting(
  db: Db,
  periodId: string,
  source: string,
): Promise<ExistingStats> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS shifts,
           count(DISTINCT coalesce(staff_id, nullif(employee_id,''), employee_name))::int AS people,
           coalesce(sum(hours),0)::float8 AS hours,
           coalesce(sum(amount),0)::float8 AS amount
    FROM salary_shifts WHERE period_id = ${periodId} AND source = ${source}`);
  const row = (r.rows[0] ?? {}) as Record<string, unknown>;
  return {
    shifts: Number(row["shifts"] ?? 0),
    people: Number(row["people"] ?? 0),
    hours: Math.round(Number(row["hours"] ?? 0) * 100) / 100,
    amount: Math.round(Number(row["amount"] ?? 0) * 100) / 100,
  };
}

/** Save everything an import is about to touch. Returns the backup id. */
export async function snapshotBeforeImport(
  db: Db,
  args: {
    periodId: string;
    source: string;
    mode: "add" | "replace";
    actorName: string;
    fileName: string;
  },
): Promise<string> {
  await ensureBackupTable(db);
  const id = uid("bk");
  const entryCols =
    args.source === "RSS"
      ? sql`jsonb_build_object('staff_id', staff_id, 'amount', rss_amount, 'hours', rss_hours)`
      : args.source === "ESS"
        ? sql`jsonb_build_object('staff_id', staff_id, 'amount', ess_amount, 'hours', ess_hours)`
        : sql`jsonb_build_object('staff_id', staff_id)`;
  await db.execute(sql`
    INSERT INTO salary_import_backups
      (id, period_id, source, mode, actor_name, file_name, shifts_before, shifts, entries)
    SELECT ${id}, ${args.periodId}, ${args.source}, ${args.mode}, ${args.actorName}, ${args.fileName},
      (SELECT count(*) FROM salary_shifts WHERE period_id = ${args.periodId} AND source = ${args.source}),
      coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM salary_shifts s
                WHERE s.period_id = ${args.periodId} AND s.source = ${args.source}), '[]'::jsonb),
      coalesce((SELECT jsonb_agg(${entryCols}) FROM salary_entries
                WHERE period_id = ${args.periodId}), '[]'::jsonb)`);
  // Keep the table small: only the 5 newest backups per period + company.
  await db.execute(sql`
    DELETE FROM salary_import_backups b
    WHERE b.period_id = ${args.periodId} AND b.source = ${args.source}
      AND b.id NOT IN (
        SELECT id FROM salary_import_backups
        WHERE period_id = ${args.periodId} AND source = ${args.source}
        ORDER BY created_at DESC LIMIT 5)`);
  return id;
}

export async function setBackupAfterCount(db: Db, id: string, after: number): Promise<void> {
  await db.execute(sql`UPDATE salary_import_backups SET shifts_after = ${after} WHERE id = ${id}`);
}

export interface LastBackup {
  id: string;
  source: string;
  mode: string;
  actorName: string;
  fileName: string;
  createdAt: string;
  shiftsBefore: number;
  shiftsAfter: number;
}

export async function lastBackups(db: Db, periodId: string): Promise<LastBackup[]> {
  await ensureBackupTable(db);
  const r = await db.execute(sql`
    SELECT DISTINCT ON (source) id, source, mode, actor_name, file_name,
           created_at, shifts_before, shifts_after
    FROM salary_import_backups
    WHERE period_id = ${periodId} AND undone_at IS NULL
    ORDER BY source, created_at DESC`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x["id"]),
    source: String(x["source"]),
    mode: String(x["mode"]),
    actorName: String(x["actor_name"] ?? ""),
    fileName: String(x["file_name"] ?? ""),
    createdAt: new Date(String(x["created_at"])).toISOString(),
    shiftsBefore: Number(x["shifts_before"] ?? 0),
    shiftsAfter: Number(x["shifts_after"] ?? 0),
  }));
}

/** Restore the newest not-yet-undone backup for this period + company. */
export async function undoLastImport(
  db: Db,
  periodId: string,
  source: string,
): Promise<{ restoredShifts: number; backupId: string; createdAt: string }> {
  await ensureBackupTable(db);
  const r = await db.execute(sql`
    SELECT id, created_at FROM salary_import_backups
    WHERE period_id = ${periodId} AND source = ${source} AND undone_at IS NULL
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE`);
  const b = r.rows[0] as { id: string; created_at: string } | undefined;
  if (!b) throw new Error(`There is no ${source} import to undo for this month.`);

  // 1) shifts back exactly as they were
  await db.execute(sql`DELETE FROM salary_shifts WHERE period_id = ${periodId} AND source = ${source}`);
  await db.execute(sql`
    INSERT INTO salary_shifts
      (id, period_id, source, staff_id, employee_id, employee_name, ni, date,
       client_name, site_name, hours, rate, amount, expenses, penalty)
    SELECT x.id, x.period_id, x.source,
           CASE WHEN EXISTS (SELECT 1 FROM payroll_staff p WHERE p.id = x.staff_id) THEN x.staff_id END,
           x.employee_id, x.employee_name, x.ni, x.date, x.client_name, x.site_name,
           x.hours, x.rate, x.amount, x.expenses, x.penalty
    FROM salary_import_backups bk,
         jsonb_to_recordset(bk.shifts) AS x(
           id text, period_id text, source text, staff_id text, employee_id text,
           employee_name text, ni text, date text, client_name text, site_name text,
           hours numeric, rate numeric, amount numeric, expenses numeric, penalty numeric)
    WHERE bk.id = ${b.id}`);

  // 2) totals rebuilt from those shifts, then manual RSS/ESS values put back
  await recomputeFromShifts(db, periodId);
  if (source === "RSS" || source === "ESS") {
    const setSql =
      source === "RSS"
        ? sql`rss_amount = x.amount, rss_hours = x.hours`
        : sql`ess_amount = x.amount, ess_hours = x.hours`;
    await db.execute(sql`
      UPDATE salary_entries e SET ${setSql}
      FROM salary_import_backups bk,
           jsonb_to_recordset(bk.entries) AS x(staff_id text, amount numeric, hours numeric)
      WHERE bk.id = ${b.id} AND e.period_id = ${periodId} AND e.staff_id = x.staff_id`);
    // people who had no line before the import and only got one from it go back to 0
    await db.execute(sql`
      UPDATE salary_entries e SET ${setSql}
      FROM (SELECT 0::numeric AS amount, 0::numeric AS hours) x
      WHERE e.period_id = ${periodId}
        AND NOT EXISTS (
          SELECT 1 FROM salary_import_backups bk,
                 jsonb_to_recordset(bk.entries) AS y(staff_id text)
          WHERE bk.id = ${b.id} AND y.staff_id = e.staff_id)
        AND NOT EXISTS (
          SELECT 1 FROM salary_shifts s
          WHERE s.period_id = ${periodId} AND s.source = ${source} AND s.staff_id = e.staff_id)`);
  }

  await db.execute(sql`UPDATE salary_import_backups SET undone_at = now() WHERE id = ${b.id}`);
  const n = await db.execute(
    sql`SELECT count(*)::int AS n FROM salary_shifts WHERE period_id = ${periodId} AND source = ${source}`,
  );
  return {
    restoredShifts: Number((n.rows[0] as { n: number }).n),
    backupId: b.id,
    createdAt: new Date(String(b.created_at)).toISOString(),
  };
}
