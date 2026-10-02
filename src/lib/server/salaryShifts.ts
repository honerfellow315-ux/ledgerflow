/**
 * SQL that turns imported shifts into salary lines, and the statistics behind
 * the reconciliation view. No auth / request handling here, so it can be run
 * against a real Postgres in tests; actions/salary.ts wraps it with permissions.
 */
import { sql } from "drizzle-orm";
import { INCLUDE_EXPENSES_AND_PENALTY } from "../payroll/calc";
import type { Db } from "./shiftImport";

const payExpr = INCLUDE_EXPENSES_AND_PENALTY
  ? sql`round(sum(amount + expenses - penalty), 2)`
  : sql`round(sum(amount), 2)`;

/** Same aggregation Excel did by hand: sum each person's imported shifts per
 * shift company into their RSS / ESS columns (or `extra` for any other company). */
export async function recomputeFromShifts(db: Db, periodId: string): Promise<void> {
  // 1) shifts whose person wasn't known at import time, matched now
  await db.execute(sql`
    UPDATE salary_shifts sh SET staff_id = s.id FROM payroll_staff s
    WHERE sh.period_id = ${periodId} AND sh.staff_id IS NULL AND sh.source = 'RSS'
      AND sh.employee_id <> '' AND s.rss_id = sh.employee_id`);
  await db.execute(sql`
    UPDATE salary_shifts sh SET staff_id = s.id FROM payroll_staff s
    WHERE sh.period_id = ${periodId} AND sh.staff_id IS NULL AND sh.source = 'ESS'
      AND sh.employee_id <> '' AND s.ess_id = sh.employee_id`);
  await db.execute(sql`
    UPDATE salary_shifts sh SET staff_id = s.id FROM payroll_staff s
    WHERE sh.period_id = ${periodId} AND sh.staff_id IS NULL AND sh.source NOT IN ('RSS', 'ESS')
      AND sh.employee_id <> '' AND (s.ext_ids ->> sh.source) = sh.employee_id`);
  await db.execute(sql`
    UPDATE salary_shifts sh SET staff_id = s.id FROM payroll_staff s
    WHERE sh.period_id = ${periodId} AND sh.staff_id IS NULL AND sh.ni <> '' AND s.ni <> ''
      AND upper(regexp_replace(sh.ni, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(s.ni, '[^A-Za-z0-9]', '', 'g'))`);

  // 2) aggregate per person: RSS and ESS have their own columns
  await db.execute(sql`
    INSERT INTO salary_entries (id, period_id, staff_id, rss_amount, rss_hours)
    SELECT 'se-' || substr(md5(random()::text || clock_timestamp()::text || staff_id), 1, 14),
           period_id, staff_id, ${payExpr}, round(sum(hours), 2)
    FROM salary_shifts
    WHERE period_id = ${periodId} AND source = 'RSS' AND staff_id IS NOT NULL
    GROUP BY period_id, staff_id
    ON CONFLICT (period_id, staff_id)
    DO UPDATE SET rss_amount = EXCLUDED.rss_amount, rss_hours = EXCLUDED.rss_hours`);
  await db.execute(sql`
    INSERT INTO salary_entries (id, period_id, staff_id, ess_amount, ess_hours)
    SELECT 'se-' || substr(md5(random()::text || clock_timestamp()::text || staff_id), 1, 14),
           period_id, staff_id, ${payExpr}, round(sum(hours), 2)
    FROM salary_shifts
    WHERE period_id = ${periodId} AND source = 'ESS' AND staff_id IS NOT NULL
    GROUP BY period_id, staff_id
    ON CONFLICT (period_id, staff_id)
    DO UPDATE SET ess_amount = EXCLUDED.ess_amount, ess_hours = EXCLUDED.ess_hours`);

  // 3) every other shift company: a line must exist, then `extra` is rebuilt
  // from the shifts (derived data — shifts are the single source of truth).
  await db.execute(sql`
    INSERT INTO salary_entries (id, period_id, staff_id)
    SELECT 'se-' || substr(md5(random()::text || clock_timestamp()::text || staff_id), 1, 14),
           period_id, staff_id
    FROM salary_shifts
    WHERE period_id = ${periodId} AND source NOT IN ('RSS', 'ESS') AND staff_id IS NOT NULL
    GROUP BY period_id, staff_id
    ON CONFLICT (period_id, staff_id) DO NOTHING`);
  await db.execute(sql`
    UPDATE salary_entries e SET extra = coalesce(agg.extra, '{}'::jsonb)
    FROM (
      SELECT e2.id AS entry_id,
        (SELECT jsonb_object_agg(x.src, jsonb_build_object('amount', x.amt, 'hours', x.hrs))
         FROM (
           SELECT sh.source AS src,
                  ${INCLUDE_EXPENSES_AND_PENALTY
                    ? sql`round(sum(sh.amount + sh.expenses - sh.penalty), 2)`
                    : sql`round(sum(sh.amount), 2)`} AS amt,
                  round(sum(sh.hours), 2) AS hrs
           FROM salary_shifts sh
           WHERE sh.period_id = e2.period_id AND sh.staff_id = e2.staff_id
             AND sh.source NOT IN ('RSS', 'ESS')
           GROUP BY sh.source) x) AS extra
      FROM salary_entries e2 WHERE e2.period_id = ${periodId}) agg
    WHERE e.id = agg.entry_id AND e.extra IS DISTINCT FROM coalesce(agg.extra, '{}'::jsonb)`);
}

/* ------------------------------------------------------------------ */
/* Reconciliation statistics                                            */
/* ------------------------------------------------------------------ */

export interface ShiftStatsRow {
  source: string;
  shifts: number;
  /** Distinct people (matched staff, or the file's own ID / name when unmatched). */
  people: number;
  hours: number;
  amount: number;
  matchedShifts: number;
  matchedHours: number;
  matchedAmount: number;
  unmatchedShifts: number;
  unmatchedHours: number;
  unmatchedAmount: number;
  noRateShifts: number;
  noRateHours: number;
  outsideMonthShifts: number;
}

const f = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const n = (v: unknown) => Number(v ?? 0);

/** What was imported, per shift company, split by matched / unmatched / problem shifts. */
export async function shiftStats(db: Db, periodId: string, month: string): Promise<ShiftStatsRow[]> {
  const amt = INCLUDE_EXPENSES_AND_PENALTY ? sql`(amount + expenses - penalty)` : sql`amount`;
  const res = await db.execute(sql`
    SELECT source,
      count(*)::int AS shifts,
      count(DISTINCT coalesce(staff_id, nullif(employee_id, ''), employee_name))::int AS people,
      coalesce(sum(hours), 0)::float8 AS hours,
      coalesce(sum(${amt}), 0)::float8 AS amount,
      (count(*) FILTER (WHERE staff_id IS NOT NULL))::int AS m_shifts,
      coalesce(sum(hours) FILTER (WHERE staff_id IS NOT NULL), 0)::float8 AS m_hours,
      coalesce(sum(${amt}) FILTER (WHERE staff_id IS NOT NULL), 0)::float8 AS m_amount,
      (count(*) FILTER (WHERE staff_id IS NULL))::int AS u_shifts,
      coalesce(sum(hours) FILTER (WHERE staff_id IS NULL), 0)::float8 AS u_hours,
      coalesce(sum(${amt}) FILTER (WHERE staff_id IS NULL), 0)::float8 AS u_amount,
      (count(*) FILTER (WHERE hours > 0 AND amount = 0))::int AS no_rate,
      coalesce(sum(hours) FILTER (WHERE hours > 0 AND amount = 0), 0)::float8 AS no_rate_hours,
      (count(*) FILTER (WHERE substr(date, 1, 7) <> ${month}))::int AS outside
    FROM salary_shifts WHERE period_id = ${periodId}
    GROUP BY source ORDER BY source`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    source: String(r["source"]),
    shifts: n(r["shifts"]),
    people: n(r["people"]),
    hours: f(r["hours"]),
    amount: f(r["amount"]),
    matchedShifts: n(r["m_shifts"]),
    matchedHours: f(r["m_hours"]),
    matchedAmount: f(r["m_amount"]),
    unmatchedShifts: n(r["u_shifts"]),
    unmatchedHours: f(r["u_hours"]),
    unmatchedAmount: f(r["u_amount"]),
    noRateShifts: n(r["no_rate"]),
    noRateHours: f(r["no_rate_hours"]),
    outsideMonthShifts: n(r["outside"]),
  }));
}

/** What the salary lines carry per shift company (RSS, ESS and every `extra` key). */
export async function sheetSourceTotals(
  db: Db,
  periodId: string,
): Promise<Record<string, { amount: number; hours: number }>> {
  const out: Record<string, { amount: number; hours: number }> = {};
  const base = await db.execute(sql`
    SELECT coalesce(sum(rss_amount), 0)::float8 AS ra, coalesce(sum(rss_hours), 0)::float8 AS rh,
           coalesce(sum(ess_amount), 0)::float8 AS ea, coalesce(sum(ess_hours), 0)::float8 AS eh
    FROM salary_entries WHERE period_id = ${periodId}`);
  const b = (base.rows[0] ?? {}) as Record<string, unknown>;
  out["RSS"] = { amount: f(b["ra"]), hours: f(b["rh"]) };
  out["ESS"] = { amount: f(b["ea"]), hours: f(b["eh"]) };
  const extra = await db.execute(sql`
    SELECT kv.key AS code,
           coalesce(sum((kv.value ->> 'amount')::numeric), 0)::float8 AS amount,
           coalesce(sum((kv.value ->> 'hours')::numeric), 0)::float8 AS hours
    FROM salary_entries e, jsonb_each(e.extra) AS kv
    WHERE e.period_id = ${periodId} GROUP BY kv.key`);
  for (const r of extra.rows as Record<string, unknown>[]) {
    out[String(r["code"])] = { amount: f(r["amount"]), hours: f(r["hours"]) };
  }
  return out;
}

/** Exact duplicate shifts (same person, date, site, hours, amount) and people who worked but earn £0. */
export async function shiftProblems(
  db: Db,
  periodId: string,
): Promise<{ duplicateShifts: number; zeroPayPeople: string[] }> {
  const dup = await db.execute(sql`
    SELECT coalesce(sum(c - 1), 0)::int AS dupes FROM (
      SELECT count(*) AS c FROM salary_shifts WHERE period_id = ${periodId}
      GROUP BY source, coalesce(nullif(employee_id, ''), employee_name), date, site_name, hours, amount
      HAVING count(*) > 1) t`);
  const zero = await db.execute(sql`
    SELECT coalesce(s.name, sh.employee_name) AS name
    FROM salary_shifts sh LEFT JOIN payroll_staff s ON s.id = sh.staff_id
    WHERE sh.period_id = ${periodId}
    GROUP BY coalesce(s.name, sh.employee_name)
    HAVING sum(sh.hours) > 0 AND sum(sh.amount) = 0
    ORDER BY 1 LIMIT 50`);
  return {
    duplicateShifts: n((dup.rows[0] as Record<string, unknown> | undefined)?.["dupes"]),
    zeroPayPeople: (zero.rows as Record<string, unknown>[]).map((r) => String(r["name"] ?? "")),
  };
}
