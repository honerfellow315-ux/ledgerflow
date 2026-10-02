/**
 * Core of the shift-export import, kept free of auth / request handling so it
 * can be tested against a real Postgres. `importShiftsChunk` (actions/salary.ts)
 * checks permissions + the period lock and then calls this.
 *
 * Matching order for every shift row: the company's own ID, then NI number,
 * then a UNIQUE name (never when both sides have an NI and the two differ).
 * "Company" = a shift company code: RSS and ESS have their own staff columns,
 * every other code lives in payroll_staff.ext_ids.
 */
import { and, eq, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "../../../drizzle/schema";
import { payrollStaff, salaryShifts } from "../../../drizzle/schema";
import { uid } from "./id";
import { formatNi, normName, normNi } from "../payroll/calc";
import { isBuiltInShift, type ShiftRowInput } from "../payroll/types";

export type Db = NeonHttpDatabase<typeof schema>;

export const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** The staff member's ID inside one shift company ("" when none). */
export function staffIdFor(
  s: { rssId: string; essId: string; extIds?: Record<string, string> | null },
  source: string,
): string {
  if (source === "RSS") return s.rssId;
  if (source === "ESS") return s.essId;
  return s.extIds?.[source] ?? "";
}

export interface ShiftChunkArgs {
  periodId: string;
  source: string;
  rows: ShiftRowInput[];
  /** First chunk of a file: clears what this company imported before. */
  reset: boolean;
  createMissingStaff: boolean;
}

export interface ShiftChunkResult {
  received: number;
  matched: number;
  created: number;
  unmatched: number;
}

export async function importShiftRows(db: Db, data: ShiftChunkArgs): Promise<ShiftChunkResult> {
  if (data.reset) {
    // Zero the source columns of everyone previously fed by this source so
    // people missing from the corrected file don't keep stale amounts.
    if (data.source === "RSS") {
      await db.execute(sql`
        UPDATE salary_entries SET rss_amount = 0, rss_hours = 0
        WHERE period_id = ${data.periodId} AND staff_id IN (
          SELECT DISTINCT staff_id FROM salary_shifts
          WHERE period_id = ${data.periodId} AND source = 'RSS' AND staff_id IS NOT NULL)`);
    } else if (data.source === "ESS") {
      await db.execute(sql`
        UPDATE salary_entries SET ess_amount = 0, ess_hours = 0
        WHERE period_id = ${data.periodId} AND staff_id IN (
          SELECT DISTINCT staff_id FROM salary_shifts
          WHERE period_id = ${data.periodId} AND source = 'ESS' AND staff_id IS NOT NULL)`);
    }
    // Other companies keep their earnings in salary_entries.extra, which
    // recomputeFromShifts rebuilds from the shifts, so deleting is enough.
    await db
      .delete(salaryShifts)
      .where(and(eq(salaryShifts.periodId, data.periodId), eq(salaryShifts.source, data.source)));
  }

  // Lookup tables for matching: company ID first, then NI, then unique name.
  const staffRows = await db.select().from(payrollStaff);
  const byId = new Map<string, string>();
  const byNi = new Map<string, string>();
  const nameCount = new Map<string, number>();
  const byName = new Map<string, string>();
  const have = new Map<string, { sid: string; ni: string }>();
  const register = (s: {
    id: string;
    rssId: string;
    essId: string;
    extIds?: Record<string, string> | null;
    ni: string;
    name: string;
  }) => {
    const sid = staffIdFor(s, data.source);
    if (sid) byId.set(sid, s.id);
    if (s.ni) byNi.set(normNi(s.ni), s.id);
    const n = normName(s.name);
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    byName.set(n, s.id);
    have.set(s.id, { sid, ni: s.ni });
  };
  staffRows.forEach(register);

  const newStaff: (typeof payrollStaff.$inferInsert)[] = [];
  const idBackfill = new Map<string, string>(); // staffId -> company id to fill in
  const niBackfill = new Map<string, string>(); // staffId -> NI to fill in (staff had none)
  let matched = 0;
  let created = 0;
  let unmatched = 0;

  const shiftValues = data.rows.map((r) => {
    let staffId: string | null = null;
    if (r.employeeId && byId.has(r.employeeId)) staffId = byId.get(r.employeeId) ?? null;
    else if (r.ni && byNi.has(normNi(r.ni))) staffId = byNi.get(normNi(r.ni)) ?? null;
    else if (r.employeeName && nameCount.get(normName(r.employeeName)) === 1) {
      const cand = byName.get(normName(r.employeeName)) ?? null;
      const candNi = cand ? normNi(have.get(cand)?.ni) : "";
      const rowNi = normNi(r.ni);
      // Same name but a DIFFERENT NI number is a different person — never merge them.
      if (cand && !(candNi && rowNi && candNi !== rowNi)) staffId = cand;
    }

    if (!staffId && data.createMissingStaff && (r.employeeId || r.employeeName)) {
      const id = uid("st");
      const fresh = {
        id,
        rssId: data.source === "RSS" ? r.employeeId : "",
        essId: data.source === "ESS" ? r.employeeId : "",
        extIds: !isBuiltInShift(data.source) && r.employeeId ? { [data.source]: r.employeeId } : {},
        ni: formatNi(r.ni),
        name: r.employeeName || `Employee ${r.employeeId}`,
        tag: r.tag,
        accountDetail: r.accountDetail,
      };
      newStaff.push(fresh);
      register(fresh);
      staffId = id;
      created++;
    } else if (staffId) {
      matched++;
      const h = have.get(staffId);
      if (r.employeeId && h && !h.sid && !idBackfill.has(staffId)) {
        idBackfill.set(staffId, r.employeeId);
        byId.set(r.employeeId, staffId);
        h.sid = r.employeeId;
      }
      // The file knows this person's NI and we don't yet: keep it, so every
      // later import (any company) can match them by NI.
      const rowNi = normNi(r.ni);
      if (rowNi && h && !normNi(h.ni) && !byNi.has(rowNi)) {
        niBackfill.set(staffId, formatNi(r.ni));
        byNi.set(rowNi, staffId);
        h.ni = formatNi(r.ni);
      }
    } else {
      unmatched++;
    }
    return {
      id: uid("sh"),
      periodId: data.periodId,
      source: data.source,
      staffId,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      ni: formatNi(r.ni),
      date: r.date,
      clientName: r.clientName,
      siteName: r.siteName,
      hours: r.hours,
      rate: r.rate,
      amount: r.amount,
      expenses: r.expenses,
      penalty: r.penalty,
    };
  });

  for (const part of chunk(newStaff, 500)) await db.insert(payrollStaff).values(part);
  if (idBackfill.size > 0) {
    for (const part of chunk([...idBackfill], 500)) {
      const list = sql.join(
        part.map(([sid, v]) => sql`(${sid}::text, ${v}::text)`),
        sql`, `,
      );
      if (data.source === "RSS") {
        await db.execute(sql`
          UPDATE payroll_staff s SET rss_id = v.sys_id
          FROM (VALUES ${list}) AS v(id, sys_id) WHERE s.id = v.id AND s.rss_id = ''`);
      } else if (data.source === "ESS") {
        await db.execute(sql`
          UPDATE payroll_staff s SET ess_id = v.sys_id
          FROM (VALUES ${list}) AS v(id, sys_id) WHERE s.id = v.id AND s.ess_id = ''`);
      } else {
        await db.execute(sql`
          UPDATE payroll_staff s
          SET ext_ids = coalesce(s.ext_ids, '{}'::jsonb) || jsonb_build_object(${data.source}::text, v.sys_id)
          FROM (VALUES ${list}) AS v(id, sys_id)
          WHERE s.id = v.id AND coalesce(s.ext_ids ->> ${data.source}::text, '') = ''`);
      }
    }
  }
  for (const part of chunk([...niBackfill], 500)) {
    const list = sql.join(
      part.map(([sid, v]) => sql`(${sid}::text, ${v}::text)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE payroll_staff s SET ni = v.ni
      FROM (VALUES ${list}) AS v(id, ni) WHERE s.id = v.id AND s.ni = ''`);
  }
  for (const part of chunk(shiftValues, 800)) await db.insert(salaryShifts).values(part);

  return { received: data.rows.length, matched, created, unmatched };
}
