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
  // Once an admin-approved Timesheet Check month is locked, the hours it was checked against
  // must not change underneath it. Reopen the timesheet month first (admins only).
  const locked = await db.execute(sql`
    SELECT l.month FROM timesheet_month_locks l
    JOIN salary_periods p ON p.month = l.month
    WHERE l.locked AND p.id = ${data.periodId} LIMIT 1`);
  const lockedMonth = (locked.rows[0] as { month?: string } | undefined)?.month;
  if (lockedMonth)
    throw new Error(
      `The timesheet check for ${lockedMonth} is locked, so shifts for this month cannot be re-imported. Ask an admin to reopen the month in Timesheet Check first.`,
    );

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
  const ambiguousIds = new Set<string>();
  const ambiguousNis = new Set<string>();
  const byNi = new Map<string, string>();
  const nameCount = new Map<string, number>();
  const byName = new Map<string, string>();
  const idsByName = new Map<string, string[]>(); // every staff record with that name
  // Every staff record behind an ID / NI, so a duplicate can be named in the error.
  const recsById = new Map<string, string[]>();
  const recsByNi = new Map<string, string[]>();
  const recInfo = new Map<string, string>();
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
    recInfo.set(
      s.id,
      `${s.name || "(no name)"} [${[s.rssId && `RSS ${s.rssId}`, s.essId && `ESS ${s.essId}`, s.ni && `NI ${s.ni}`]
        .filter(Boolean)
        .join(", ") || "no ID/NI"}]`,
    );
    if (sid) recsById.set(sid, [...(recsById.get(sid) ?? []), s.id]);
    if (s.ni) recsByNi.set(normNi(s.ni), [...(recsByNi.get(normNi(s.ni)) ?? []), s.id]);
    if (sid) {
      if (byId.has(sid) && byId.get(sid) !== s.id) ambiguousIds.add(sid);
      byId.set(sid, s.id);
    }
    if (s.ni) {
      const ni = normNi(s.ni);
      if (byNi.has(ni) && byNi.get(ni) !== s.id) ambiguousNis.add(ni);
      byNi.set(ni, s.id);
    }
    const n = normName(s.name);
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    byName.set(n, s.id);
    idsByName.set(n, [...(idsByName.get(n) ?? []), s.id]);
    have.set(s.id, { sid, ni: s.ni });
  };
  staffRows.forEach(register);

  const newStaff: (typeof payrollStaff.$inferInsert)[] = [];
  const idBackfill = new Map<string, string>(); // staffId -> company id to fill in
  const niBackfill = new Map<string, string>(); // staffId -> NI to fill in (staff had none)
  let matched = 0;
  let created = 0;
  let unmatched = 0;

  // Report EVERY duplicated staff record this file touches in one go, naming the
  // records, instead of stopping at the first one and making you retry.
  {
    const found = new Map<string, string>();
    for (const r of data.rows) {
      const ni = normNi(r.ni);
      if (r.employeeId && ambiguousIds.has(r.employeeId))
        found.set(
          `ID ${r.employeeId}`,
          (recsById.get(r.employeeId) ?? []).map((id) => recInfo.get(id)).join("  vs  "),
        );
      if (ni && ambiguousNis.has(ni))
        found.set(
          `NI ${formatNi(r.ni)}`,
          (recsByNi.get(ni) ?? []).map((id) => recInfo.get(id)).join("  vs  "),
        );
    }
    if (found.size > 0) {
      const lines = [...found].slice(0, 8).map(([k, v]) => `${k}: ${v}`);
      throw new Error(
        `${found.size} staff ID/NI in this file belong to more than one Staff record. In Staff, delete or fix the extra record for each, then import again. ${lines.join(" | ")}${found.size > 8 ? ` | …and ${found.size - 8} more` : ""}`,
      );
    }
  }

  const shiftValues = data.rows.map((r, rowIndex) => {
    // Say WHICH row and WHO, so one bad row can be found and fixed in the file.
    const where = `Row ${rowIndex + 2}${r.employeeName ? ` (${r.employeeName}` : " ("}${r.employeeId ? `, ID ${r.employeeId}` : ""}${r.ni ? `, NI ${formatNi(r.ni)}` : ""})`;
    let staffId: string | null = null;
    if (ambiguousIds.has(r.employeeId) || ambiguousNis.has(normNi(r.ni)))
      throw new Error(
        `${where}: this staff ID or NI belongs to more than one staff record. Fix the duplicate in Staff, then import again.`,
      );
    let nameIsAmbiguous = false;
    if (r.employeeId && byId.has(r.employeeId)) staffId = byId.get(r.employeeId) ?? null;
    else if (r.ni && byNi.has(normNi(r.ni))) staffId = byNi.get(normNi(r.ni)) ?? null;
    else if (r.employeeName && nameCount.get(normName(r.employeeName)) === 1) {
      const cand = byName.get(normName(r.employeeName)) ?? null;
      const candNi = cand ? normNi(have.get(cand)?.ni) : "";
      const rowNi = normNi(r.ni);
      // Same name but a DIFFERENT NI number is a different person — never merge them.
      if (cand && !(candNi && rowNi && candNi !== rowNi)) staffId = cand;
    } else if (r.employeeName && (nameCount.get(normName(r.employeeName)) ?? 0) > 1) {
      // Several staff share this name. Drop the ones that are provably someone
      // else (different NI, or a different ID for this company). One left =
      // that's them; none left = a new person; several left = can't tell.
      const rowNi = normNi(r.ni);
      const left = (idsByName.get(normName(r.employeeName)) ?? []).filter((sid) => {
        const h = have.get(sid);
        if (!h) return false;
        const hNi = normNi(h.ni);
        if (hNi && rowNi && hNi !== rowNi) return false;
        if (h.sid && r.employeeId && h.sid !== r.employeeId) return false;
        return true;
      });
      if (left.length === 1) staffId = left[0] ?? null;
      else if (left.length > 1) nameIsAmbiguous = true;
    }

    if (staffId) {
      const found = have.get(staffId);
      if (
        found &&
        ((normNi(found.ni) && normNi(r.ni) && normNi(found.ni) !== normNi(r.ni)) ||
          (found.sid && r.employeeId && found.sid !== r.employeeId))
      )
        throw new Error(
          `${where}: the staff ID and the NI point to different people (Staff has "${found.sid || "no ID"}" / "${found.ni || "no NI"}"). Correct the ID or NI in the file or in Staff.`,
        );
    }
    if (!staffId && nameIsAmbiguous)
      throw new Error(
        `${where}: more than one staff record has this name. Add this person's ID or NI to the file (or to Staff) so they can be told apart.`,
      );
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
