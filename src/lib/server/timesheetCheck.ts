/**
 * Core of Timesheet Check, free of auth / request handling (same idea as shiftImport.ts)
 * so it can be tested against a real Postgres. The server functions in
 * src/lib/actions/timesheets.ts check who is asking and then call this.
 *
 * The NI number identifies the person (final). Without one, the name (and date of birth) only
 * suggests a staff member, and a person must approve it. See findStaff.
 * Matching queries the NI candidates rather than loading every staff record.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import * as schema from "../../../drizzle/schema";
import {
  payrollStaff,
  salaryShifts,
  timesheetAcceptances,
  timesheetRows,
  timesheetSheets,
} from "../../../drizzle/schema";
import { formatMonthLabel, isValidNi, normName, normNi, round2 } from "../payroll/calc";
import { normalizeDob } from "../timesheets/identity";
import { payForRow } from "../timesheets/pay";
import { assertTimesheetMonthOpen } from "./timesheetLocks";
import { uid } from "./id";
import { chunk, type Db } from "./shiftImport";
import {
  compareRows,
  type RecordShift,
  type RowAnswer,
  type SheetRowInput,
} from "../timesheets/compare";
import type { ParsedSheet } from "../timesheets/parsed";
import type {
  RowResult,
  SheetFormat,
  SheetRow,
  SheetStatus,
  TimesheetSheet,
} from "../timesheets/data";
import type { SheetListItem, UploadOutcome } from "../timesheets/listTypes";

export type { Db };
type SheetRec = typeof schema.timesheetSheets.$inferSelect;
type RowRec = typeof schema.timesheetRows.$inferSelect;

const cents = (n: number) => Math.round(n * 100);
const sumHours = (list: readonly (number | null)[]): number =>
  list.reduce<number>((s, n) => s + (n === null ? 0 : cents(n)), 0) / 100;

/* ------------------------------ matching the person ------------------------------ */

export interface StaffMatch {
  staffId: string | null;
  matchedBy: "ni" | "name" | "none";
  staffName: string;
  /** Why nobody was matched, in plain words (never contains an NI number). */
  note: string;
}

const NO_MATCH = (note: string): StaffMatch => ({
  staffId: null,
  matchedBy: "none",
  staffName: "",
  note,
});

/** Every identity message starts with this, so it can be replaced when a sheet is checked again. */
export const IDENTITY_NOTE_PREFIX = "Staff check: ";
const SAME_NAME_SQL = (key: string) =>
  sql`trim(regexp_replace(regexp_replace(regexp_replace(lower(name), '[(][^)]*[)]', ' ', 'g'), '[^a-z0-9]+', ' ', 'g'), ' +', ' ', 'g')) = ${key}`;

/**
 * Who is this sheet for?
 *  1. NI number found in Staff  -> matched (final). The Staff name is suggested/shown; a different
 *     name or date of birth on the sheet only adds a warning, because the NI number is unique.
 *  2. No NI number (or not valid / not in Staff) -> the NAME is looked up, and the date of birth
 *     (when the sheet has one) narrows or rejects the candidates. A name/DOB match is only a
 *     SUGGESTION: matchedBy "name" keeps the sheet on "needs review" until a person approves it,
 *     because two people can share a name or even a birthday.
 */
export async function findStaff(
  db: Db,
  rawNi: string,
  rawName: string,
  rawDob = "",
): Promise<StaffMatch> {
  const P = IDENTITY_NOTE_PREFIX;
  const niKey = normNi(rawNi);
  const nameKey = normName(rawName).replace(/\s+/g, " ");
  const sheetDob = normalizeDob(rawDob);
  if (!niKey && !nameKey)
    return NO_MATCH(
      `${P}the sheet has no NI number and no staff name. Enter at least one in "Staff identity" below.`,
    );

  let niProblem = "";
  if (niKey) {
    if (!isValidNi(rawNi)) {
      niProblem = "The NI number on the sheet is not a valid NI number.";
    } else {
      const res = await db.execute(sql`
        SELECT id, name, dob FROM payroll_staff
        WHERE regexp_replace(upper(ni), '[^A-Z0-9]', '', 'g') = ${niKey}
        LIMIT 3`);
      const hits = res.rows as { id: string; name: string; dob: string | null }[];
      if (hits.length > 1)
        return NO_MATCH(
          `${P}more than one staff member has this NI number. Fix it in Staff first.`,
        );
      const hit = hits[0];
      if (hit) {
        const warnings: string[] = [];
        if (nameKey && normName(hit.name).replace(/\s+/g, " ") !== nameKey)
          warnings.push(
            `The name on the sheet ("${rawName.trim()}") is different from the Staff name.`,
          );
        const staffDob = normalizeDob(hit.dob ?? "");
        if (sheetDob && staffDob && sheetDob !== staffDob)
          warnings.push("The date of birth on the sheet is different from the one in Staff.");
        return {
          staffId: hit.id,
          matchedBy: "ni",
          staffName: hit.name,
          note: `${P}matched by NI number to ${hit.name}.${warnings.length ? " " + warnings.join(" ") + " Check it is the right person." : ""}`,
        };
      }
      niProblem = "No staff member has the NI number on the sheet.";
    }
  }

  if (!nameKey)
    return NO_MATCH(
      `${P}${niProblem} Add the staff name in "Staff identity" below so the person can be looked up by name.`,
    );

  const res = await db.execute(sql`
    SELECT id, name, dob FROM payroll_staff WHERE ${SAME_NAME_SQL(nameKey)} LIMIT 6`);
  let cands = res.rows as { id: string; name: string; dob: string | null }[];
  const lead = niProblem ? `${niProblem} ` : "";
  if (cands.length === 0)
    return NO_MATCH(
      `${P}${lead}No staff member has the name "${rawName.trim()}". Check the spelling, or add the person in Staff first.`,
    );
  if (sheetDob) {
    const sameDob = cands.filter((c) => normalizeDob(c.dob ?? "") === sheetDob);
    const noDob = cands.filter((c) => !normalizeDob(c.dob ?? ""));
    if (sameDob.length > 0) cands = sameDob;
    else if (noDob.length > 0) cands = noDob;
    else
      return NO_MATCH(
        `${P}${lead}A staff member has this name, but the date of birth on the sheet is different from Staff. Check both before matching.`,
      );
  }
  if (cands.length > 1)
    return NO_MATCH(
      `${P}${lead}More than one staff member has the name "${rawName.trim()}". Add the NI number (or date of birth) in "Staff identity" below.`,
    );
  const hit = cands[0]!;
  const dobAgrees = !!sheetDob && normalizeDob(hit.dob ?? "") === sheetDob;
  return {
    staffId: hit.id,
    matchedBy: "name",
    staffName: hit.name,
    note: `${P}${lead}Suggested by name${dobAgrees ? " and date of birth" : ""}: ${hit.name}. Approve this staff member before the sheet can be marked ready.`,
  };
}

/** The identity line first, then anything the file reader noted. */
export function composeReadNote(identityNote: string, others: string | null): string | null {
  const text = [identityNote.trim(), (others ?? "").trim()].filter(Boolean).join("\n");
  return text ? text.slice(0, 700) : null;
}

const LEGACY_IDENTITY_NOTE =
  /^(The sheet is missing the staff|No staff member has this NI|More than one staff member has this NI|The name on the sheet|The Staff record for|The date of birth on the sheet does not match|Enter a valid (NI|date of birth))/;

/** Drops an earlier identity message (new or older wording) so a fresh check can replace it. */
export function stripIdentityNote(note: string | null): string | null {
  if (!note) return null;
  const [first = "", ...rest] = note.split("\n");
  const isIdentity = first.startsWith(IDENTITY_NOTE_PREFIX) || LEGACY_IDENTITY_NOTE.test(first);
  const kept = (isIdentity ? rest : [first, ...rest]).join("\n").trim();
  return kept || null;
}

/* ------------------------------ our own records ------------------------------ */

/**
 * This person's shifts in our records for the sheet's dates.
 *
 * A shift normally carries the staff member's id (it was matched when the shifts were
 * imported). Some do not: the person was added to Staff after the import, a name was spelt
 * differently then, or the staff record was deleted and restored (deleting sets the shifts'
 * staff to empty). Looking only at the id would then say "No shift on this date in our
 * records" for every row. So shifts with NO staff id are also taken, but only on strong
 * evidence that they are this person's:
 *   - the same NI number, or
 *   - the same company ID IN THE SAME SHIFT COMPANY (RSS id with RSS shifts, ESS id with ESS
 *     shifts: employee numbers of two companies overlap, so the company must match), or
 *   - the same name, only when the shift carries no NI number and no company ID at all.
 * Shifts that belong to ANOTHER staff member are never taken. Such shifts are marked
 * `unlinked` so the sheet says so. As a last guard, on any date where the total would pass
 * 24 hours, the unlinked shifts of that date are left out (nobody works more than 24 hours a
 * day, so those cannot all be this person's).
 *
 * Shifts with 0 hours cannot be compared; only their dates are returned, so the note can
 * say "a shift exists on this date, but with 0 hours".
 */
async function loadRecords(
  db: Db,
  staffId: string,
  month: string,
  dates: readonly string[],
): Promise<{ records: RecordShift[]; zeroHourDates: Set<string> }> {
  const real = dates.filter((d) => d !== "");
  const from = [`${month}-01`, ...real].sort()[0]!;
  const to = [`${month}-31`, ...real].sort().at(-1)!;

  const [person] = await db
    .select({
      ni: payrollStaff.ni,
      name: payrollStaff.name,
      rssId: payrollStaff.rssId,
      essId: payrollStaff.essId,
      extIds: payrollStaff.extIds,
    })
    .from(payrollStaff)
    .where(eq(payrollStaff.id, staffId))
    .limit(1);
  const niKey = normNi(person?.ni ?? "");
  const nameKey = normName(person?.name ?? "").replace(/\s+/g, " ");
  const idPairs: { source: string; id: string }[] = [];
  if (person?.rssId) idPairs.push({ source: "RSS", id: person.rssId });
  if (person?.essId) idPairs.push({ source: "ESS", id: person.essId });
  for (const [source, id] of Object.entries(person?.extIds ?? {})) {
    if (typeof id === "string" && id !== "") idPairs.push({ source, id });
  }

  const shiftNi = sql`regexp_replace(upper(${salaryShifts.ni}), '[^A-Z0-9]', '', 'g')`;
  const shiftName = sql`trim(regexp_replace(regexp_replace(regexp_replace(lower(${salaryShifts.employeeName}), '[(][^)]*[)]', ' ', 'g'), '[^a-z0-9]+', ' ', 'g'), ' +', ' ', 'g'))`;
  const unlinkedBy: SQL[] = [];
  if (niKey.length >= 6) unlinkedBy.push(sql`${shiftNi} = ${niKey}`);
  for (const p of idPairs) {
    unlinkedBy.push(
      sql`(${salaryShifts.source} = ${p.source} AND ${salaryShifts.employeeId} = ${p.id})`,
    );
  }
  if (nameKey) {
    unlinkedBy.push(
      sql`(${shiftName} = ${nameKey} AND ${shiftNi} = '' AND ${salaryShifts.employeeId} = '')`,
    );
  }
  const unlinkedAny = unlinkedBy.length > 0 ? or(...unlinkedBy) : undefined;
  const whose = unlinkedAny
    ? or(eq(salaryShifts.staffId, staffId), and(isNull(salaryShifts.staffId), unlinkedAny))
    : eq(salaryShifts.staffId, staffId);

  const rows = await db
    .select({
      id: salaryShifts.id,
      staffId: salaryShifts.staffId,
      date: salaryShifts.date,
      clientName: salaryShifts.clientName,
      siteName: salaryShifts.siteName,
      hours: salaryShifts.hours,
      rate: salaryShifts.rate,
    })
    .from(salaryShifts)
    .where(and(whose, gte(salaryShifts.date, from), lte(salaryShifts.date, to)));

  const dayTotal = new Map<string, number>();
  for (const r of rows)
    if (r.hours > 0) dayTotal.set(r.date, (dayTotal.get(r.date) ?? 0) + r.hours);

  const records: RecordShift[] = [];
  const zeroHourDates = new Set<string>();
  for (const r of rows) {
    // Over 24 hours in one day cannot all be one person's: leave out the unlinked ones.
    if (r.staffId === null && (dayTotal.get(r.date) ?? 0) > 24) continue;
    if (r.hours > 0) {
      records.push({
        id: r.id,
        date: r.date,
        clientName: r.clientName,
        siteName: r.siteName,
        hours: r.hours,
        rate: r.rate,
        ...(r.staffId === null ? { unlinked: true } : {}),
      });
    } else {
      zeroHourDates.add(r.date);
    }
  }
  return { records, zeroHourDates };
}

/* ------------------------------ one full check ------------------------------ */

export interface Evaluation {
  staff: StaffMatch;
  answers: RowAnswer[];
  missing: ReturnType<typeof compareRows>["missing"];
  sheetHours: number;
  recordHours: number;
  issues: number;
}

export async function evaluate(
  db: Db,
  a: {
    personName: string;
    personNi: string;
    personDob?: string;
    month: string;
    rows: SheetRowInput[];
  },
): Promise<Evaluation> {
  const staff = await findStaff(db, a.personNi, a.personName, a.personDob);
  const loaded = staff.staffId
    ? await loadRecords(
        db,
        staff.staffId,
        a.month,
        a.rows.map((r) => r.date),
      )
    : { records: [], zeroHourDates: new Set<string>() };
  const { answers, missing } = compareRows({
    staffFound: staff.staffId !== null,
    month: a.month,
    rows: a.rows,
    records: loaded.records,
    zeroHourDates: loaded.zeroHourDates,
  });
  const sheetHours = sumHours(a.rows.map((r) => r.hours));
  const recordHours =
    sumHours(answers.map((x) => x.recordHours)) + sumHours(missing.map((m) => m.recordHours));
  const issues = answers.filter((x) => x.result !== "match").length + missing.length;
  return { staff, answers, missing, sheetHours, recordHours: round2(recordHours), issues };
}

export function statedMismatch(stated: number | null, sheetHours: number): boolean {
  return stated !== null && Math.abs(stated - sheetHours) > 0.001;
}

export function decideStatus(a: {
  staffId: string | null;
  matchedBy: "ni" | "name" | "none";
  confirmed: boolean;
  issues: number;
  mismatch: boolean;
}): SheetStatus {
  if (a.staffId === null) return "staff_not_found";
  if (a.matchedBy === "name" && !a.confirmed) return "needs_review";
  return a.issues > 0 || a.mismatch ? "needs_review" : "ready";
}

/** Who this sheet is for. One sheet per person per month is allowed. */
export function personKeyOf(
  staffId: string | null,
  ni: string,
  name: string,
  fileHash: string,
  label: string,
): string {
  if (staffId) return `staff:${staffId}`;
  const n = normNi(ni);
  if (n) return `ni:${n}`;
  const nm = normName(name);
  if (nm) return `name:${nm}`;
  return `file:${fileHash}:${label}`;
}

/** The month most of the sheet's dated rows fall in (ties: the later month). */
export function dominantMonth(dates: readonly string[]): string {
  const count = new Map<string, number>();
  for (const d of dates) if (d) count.set(d.slice(0, 7), (count.get(d.slice(0, 7)) ?? 0) + 1);
  let best = "";
  let bestN = 0;
  for (const [m, n] of count) {
    if (n > bestN || (n === bestN && m > best)) {
      best = m;
      bestN = n;
    }
  }
  return best;
}

/* ------------------------------ accepting a difference ------------------------------ */

/**
 * Fingerprint of one difference: what kind it is, the day, the site and both hour figures.
 * An acceptance is stored against this fingerprint, so if the sheet or our records change
 * (a different hour figure, another site...) the fingerprint changes and the acceptance
 * lapses by itself. A purely cosmetic re-check keeps it.
 */
export function acceptKey(a: {
  result: string;
  date: string;
  site: string;
  sheetHours: number | null;
  recordHours: number | null;
}): string {
  const h = (n: number | null) => (n === null ? "-" : n.toFixed(2));
  return [a.result, a.date, a.site.trim().toLowerCase(), h(a.sheetHours), h(a.recordHours)].join(
    "|",
  );
}

/**
 * The rate to use for a row that has no record shift: the staff member's own Salary Sheet
 * rate for the month (the most used rate of their shifts), else their Payroll sheet rate.
 */
async function staffMonthRate(
  db: Db,
  staffId: string,
  month: string,
  records: readonly RecordShift[],
): Promise<number> {
  const used = new Map<number, number>();
  for (const r of records) if (r.rate > 0) used.set(r.rate, (used.get(r.rate) ?? 0) + 1);
  let best = 0;
  let bestN = 0;
  for (const [rate, n] of used) {
    if (n > bestN) {
      best = rate;
      bestN = n;
    }
  }
  if (best > 0) return best;
  const res = await db.execute(sql`
    SELECT l.rate::float8 AS rate FROM payroll_lines l
    JOIN payroll_sheets p ON p.id = l.sheet_id
    WHERE l.staff_id = ${staffId} AND p.month = ${month} AND l.rate > 0
    ORDER BY l.rate DESC LIMIT 1`);
  return Number((res.rows[0] as { rate?: number } | undefined)?.rate ?? 0);
}

/**
 * Fills in the pay of sheets that were uploaded before pay existed (pay not calculated yet).
 * Locked months are left alone. Call again until `remaining` is 0 (or `processed` is 0).
 */
export async function calculateMissingPay(
  db: Db,
  limit: number,
): Promise<{ processed: number; remaining: number }> {
  const todo = sql`s.staff_id IS NOT NULL AND s.pay_amount IS NULL
    AND NOT EXISTS (SELECT 1 FROM timesheet_month_locks l WHERE l.month = s.month AND l.locked)`;
  const pairs = await db.execute(
    sql`SELECT DISTINCT s.staff_id, s.month FROM timesheet_sheets s WHERE ${todo} LIMIT ${limit}`,
  );
  let processed = 0;
  for (const p of pairs.rows as { staff_id: string; month: string }[]) {
    try {
      await recomputeStaffMonth(db, p.staff_id, p.month);
      processed++;
    } catch {
      // One person's problem must not stop the others; they stay "not calculated".
    }
  }
  const left = await db.execute(
    sql`SELECT count(*)::int AS n FROM (SELECT DISTINCT s.staff_id, s.month FROM timesheet_sheets s WHERE ${todo}) x`,
  );
  return { processed, remaining: Number((left.rows[0] as { n?: number } | undefined)?.n ?? 0) };
}

/** Fingerprint of "the sheet's stated total differs from its rows". */
export const statedKey = (stated: number | null, sheetHours: number): string =>
  `${stated === null ? "-" : stated.toFixed(2)}|${sheetHours.toFixed(2)}`;

/* ------------------------------ one person, one month, any number of sheets ------------------------------ */

type ItemRef = { sheet: SheetRec; row: RowRec; overlap: boolean; key: number };

/**
 * Compares EVERYTHING one person sent for one month against our records, in one go.
 *
 * A person may have several sheets in a month (weekly sheets, a late correction...). Checking
 * each sheet alone would call the days on the other sheets "missing" and could count the same
 * day twice. So all of the person's sheets are merged first:
 *   - a row that is identical (day, site, start, end, hours) to a row on an EARLIER sheet is
 *     the same work and is counted ONCE (it is marked "counted once"); two identical rows on
 *     the SAME sheet are still reported (a genuine duplicate);
 *   - the merged rows are compared with our records once, so a day is never counted twice;
 *   - "in our records but not on any sheet" rows are listed once, on the newest sheet.
 * Differences an approver accepted (and that have not changed since) do not count as issues.
 * Safe to run any number of times.
 */
export async function recomputeStaffMonth(db: Db, staffId: string, month: string): Promise<void> {
  const sheets = await db
    .select()
    .from(timesheetSheets)
    .where(and(eq(timesheetSheets.staffId, staffId), eq(timesheetSheets.month, month)))
    .orderBy(asc(timesheetSheets.uploadedAt), asc(timesheetSheets.id));
  if (sheets.length === 0) return;
  const ids = sheets.map((x) => x.id);

  const stored = await db
    .select()
    .from(timesheetRows)
    .where(and(inArray(timesheetRows.sheetId, ids), eq(timesheetRows.fromRecords, false)))
    .orderBy(asc(timesheetRows.sheetId), asc(timesheetRows.lineNo));
  const bySheet = new Map<string, RowRec[]>();
  for (const r of stored) {
    const list = bySheet.get(r.sheetId);
    if (list) list.push(r);
    else bySheet.set(r.sheetId, [r]);
  }

  // 1. merge: rows already seen on an earlier sheet are counted once
  const earlier = new Map<string, number>();
  const items: ItemRef[] = [];
  const inputs: SheetRowInput[] = [];
  for (const sh of sheets) {
    const seenHere = new Map<string, number>();
    for (const r of bySheet.get(sh.id) ?? []) {
      const sig = [
        r.date,
        r.site.trim().toLowerCase(),
        r.startTime,
        r.endTime,
        r.sheetHours === null ? "-" : r.sheetHours.toFixed(2),
      ].join("|");
      const nth = seenHere.get(sig) ?? 0;
      seenHere.set(sig, nth + 1);
      const overlap = nth < (earlier.get(sig) ?? 0);
      let key = -1;
      if (!overlap) {
        key = inputs.length;
        inputs.push({
          key,
          date: r.date,
          site: r.site,
          siteAlt: r.siteAlt,
          hours: r.sheetHours,
          uncertain: r.uncertain,
          parseNote: r.parseNote,
        });
      }
      items.push({ sheet: sh, row: r, overlap, key });
    }
    for (const [sig, n] of seenHere) earlier.set(sig, Math.max(earlier.get(sig) ?? 0, n));
  }

  // 2. compare once
  const loaded = await loadRecords(
    db,
    staffId,
    month,
    inputs.map((i) => i.date),
  );
  const { answers, missing } = compareRows({
    staffFound: true,
    month,
    rows: inputs,
    records: loaded.records,
    zeroHourDates: loaded.zeroHourDates,
  });

  // 3. what an approver already accepted
  const accepted = await db
    .select()
    .from(timesheetAcceptances)
    .where(and(eq(timesheetAcceptances.staffId, staffId), eq(timesheetAcceptances.month, month)));
  const acceptedBy = new Map(accepted.map((x) => [x.rowKey, x]));
  const acceptance = (
    result: string,
    date: string,
    site: string,
    sheetHours: number | null,
    recordHours: number | null,
  ) =>
    result === "match"
      ? undefined
      : acceptedBy.get(acceptKey({ result, date, site, sheetHours, recordHours }));

  // 4. write every row's answer
  type Out = {
    id: string;
    result: string;
    recordHours: number | null;
    note: string;
    accNote: string;
    accBy: string;
    accAt: string | null;
    accHours: number | null;
    recordId: string | null;
    payRate: number;
    payHours: number;
    payAmount: number;
  };
  const outs: Out[] = [];
  // What each sheet is paid, and which accepted differences leave its "difference" figure.
  const fallbackRate = await staffMonthRate(db, staffId, month, loaded.records);
  const aggs = new Map<string, { hours: number[]; amount: number[]; accepted: number[] }>();
  const aggOf = (sheetId: string) => {
    let a = aggs.get(sheetId);
    if (!a) {
      a = { hours: [], amount: [], accepted: [] };
      aggs.set(sheetId, a);
    }
    return a;
  };
  const issuesBySheet = new Map<string, number>();
  const bump = (sheetId: string) =>
    issuesBySheet.set(sheetId, (issuesBySheet.get(sheetId) ?? 0) + 1);
  for (const it of items) {
    if (it.overlap) {
      outs.push({
        id: it.row.id,
        result: "match",
        recordHours: it.row.sheetHours,
        note: "Counted once: the same row is on another sheet for this month.",
        accNote: "",
        accBy: "",
        accAt: null,
        accHours: null,
        recordId: null,
        payRate: 0,
        payHours: 0,
        payAmount: 0,
      });
      continue;
    }
    const ans = answers[it.key]!;
    const acc = acceptance(
      ans.result,
      it.row.date,
      it.row.site,
      it.row.sheetHours,
      ans.recordHours,
    );
    const edited = it.row.editHours !== null;
    if (ans.result !== "match" && !acc && !edited) bump(it.sheet.id);
    const pay = payForRow({
      result: ans.result,
      sheetHours: it.row.sheetHours,
      recordHours: ans.recordHours,
      recordRate: ans.recordRate,
      sheetRate: it.row.rate,
      fallbackRate,
      accepted: Boolean(acc),
      actualHours: acc?.actualHours ?? null,
      editHours: it.row.editHours,
      editRate: it.row.editRate,
    });
    const own = aggOf(it.sheet.id);
    own.hours.push(pay.hours);
    own.amount.push(pay.amount);
    // An accepted (or hand-edited) difference no longer counts as a difference.
    if (acc || edited) own.accepted.push((it.row.sheetHours ?? 0) - (ans.recordHours ?? 0));
    outs.push({
      id: it.row.id,
      result: ans.result,
      recordHours: ans.recordHours,
      note: ans.note,
      accNote: acc?.note ?? "",
      accBy: acc?.acceptedByName ?? "",
      accAt: acc ? acc.acceptedAt.toISOString() : null,
      accHours: acc?.actualHours ?? null,
      recordId: ans.recordId ?? null,
      payRate: pay.rate,
      payHours: pay.hours,
      payAmount: pay.amount,
    });
  }
  for (const part of chunk(outs, 200)) {
    const list = sql.join(
      part.map(
        (o) =>
          sql`(${o.id}::text, ${o.result}::text, ${o.recordHours}::numeric, ${o.note}::text, ${o.accNote}::text, ${o.accBy}::text, ${o.accAt}::timestamptz, ${o.accHours}::numeric, ${o.recordId}::text, ${o.payRate}::numeric, ${o.payHours}::numeric, ${o.payAmount}::numeric)`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE timesheet_rows t
      SET result = v.result, record_hours = v.record_hours, note = v.note,
          accepted_note = v.accepted_note, accepted_by_name = v.accepted_by_name,
          accepted_at = v.accepted_at, accepted_hours = v.accepted_hours, record_shift_id = v.record_shift_id,
          pay_rate = v.pay_rate, pay_hours = v.pay_hours, pay_amount = v.pay_amount
      FROM (VALUES ${list}) AS v(id, result, record_hours, note, accepted_note, accepted_by_name, accepted_at, accepted_hours, record_shift_id, pay_rate, pay_hours, pay_amount)
      WHERE t.id = v.id`);
  }

  // 5. "in our records but on no sheet" rows live on the newest sheet only
  const latest = sheets[sheets.length - 1]!;
  // Hand edits of these rows are kept (they are matched again by the record shift's id).
  const oldMissing = await db
    .select()
    .from(timesheetRows)
    .where(and(inArray(timesheetRows.sheetId, ids), eq(timesheetRows.fromRecords, true)));
  const editOf = new Map(
    oldMissing
      .filter((x) => x.recordShiftId && x.editHours !== null)
      .map((x) => [x.recordShiftId!, x]),
  );
  await db
    .delete(timesheetRows)
    .where(and(inArray(timesheetRows.sheetId, ids), eq(timesheetRows.fromRecords, true)));
  const extra: (typeof timesheetRows.$inferInsert)[] = missing.map((m, i) => {
    const acc = acceptance("not_on_sheet", m.date, m.site, 0, m.recordHours);
    const was = m.recordId ? editOf.get(m.recordId) : undefined;
    if (!acc && !was) bump(latest.id);
    const pay = payForRow({
      result: "not_on_sheet",
      sheetHours: 0,
      recordHours: m.recordHours,
      recordRate: m.rate,
      sheetRate: null,
      fallbackRate,
      accepted: Boolean(acc),
      actualHours: acc?.actualHours ?? null,
      editHours: was?.editHours ?? null,
      editRate: was?.editRate ?? null,
    });
    const own = aggOf(latest.id);
    own.hours.push(pay.hours);
    own.amount.push(pay.amount);
    if (acc || was) own.accepted.push(0 - m.recordHours);
    return {
      id: uid("tr"),
      sheetId: latest.id,
      lineNo: 10000 + i,
      fromRecords: true,
      date: m.date,
      site: m.site,
      sheetHours: 0,
      rate: m.rate,
      recordHours: m.recordHours,
      result: "not_on_sheet",
      note: m.note,
      acceptedNote: acc?.note ?? "",
      acceptedByName: acc?.acceptedByName ?? "",
      acceptedAt: acc?.acceptedAt ?? null,
      acceptedHours: acc?.actualHours ?? null,
      recordShiftId: m.recordId ?? null,
      editHours: was?.editHours ?? null,
      editRate: was?.editRate ?? null,
      editNote: was?.editNote ?? "",
      editedByName: was?.editedByName ?? "",
      editedAt: was?.editedAt ?? null,
      payRate: pay.rate,
      payHours: pay.hours,
      payAmount: pay.amount,
    };
  });
  for (const part of chunk(extra, 250)) await db.insert(timesheetRows).values(part);

  // 6. each sheet's own line (totals, issues, status)
  for (const sh of sheets) {
    const own = items.filter((i) => i.sheet.id === sh.id);
    const isLatest = sh.id === latest.id;
    const sheetHours = sumHours(own.map((i) => i.row.sheetHours));
    const recordHours = round2(
      sumHours(own.map((i) => (i.overlap ? i.row.sheetHours : answers[i.key]!.recordHours))) +
        (isLatest ? sumHours(missing.map((m) => m.recordHours)) : 0),
    );
    const mismatch = statedMismatch(sh.statedHours, sheetHours);
    // An approver may accept a stated total that differs from the rows; it lapses if either figure changes.
    const statedOk = mismatch && sh.statedAcceptedKey === statedKey(sh.statedHours, sheetHours);
    const rowIssues = issuesBySheet.get(sh.id) ?? 0;
    const issues = rowIssues + (mismatch && !statedOk ? 1 : 0);
    const status = decideStatus({
      staffId,
      matchedBy: sh.matchedBy as "ni" | "name" | "none",
      confirmed: sh.staffConfirmedAt !== null,
      issues,
      mismatch: false,
    });
    await db
      .update(timesheetSheets)
      .set({
        sheetHours,
        recordHours,
        rowCount: own.length + (isLatest ? missing.length : 0),
        issueCount: issues,
        status,
        comparedAt: new Date(),
        payHours: sumHours(aggOf(sh.id).hours),
        payAmount: sumHours(aggOf(sh.id).amount),
        openDiff: round2(sheetHours - recordHours - sumHours(aggOf(sh.id).accepted)),
        // An acceptance only counts while both figures are unchanged; otherwise it lapses.
        ...(statedOk
          ? {}
          : {
              statedAcceptedKey: "",
              statedAcceptedNote: "",
              statedAcceptedByName: "",
              statedAcceptedAt: null,
            }),
      })
      .where(eq(timesheetSheets.id, sh.id));
  }
}

/** The state of a saved difference as the screens need it, for accepting it. */
async function loadRowForAccept(db: Db, rowId: string) {
  const [row] = await db.select().from(timesheetRows).where(eq(timesheetRows.id, rowId)).limit(1);
  if (!row) throw new Error("That row no longer exists.");
  const [sheet] = await db
    .select()
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, row.sheetId))
    .limit(1);
  if (!sheet) throw new Error("That sheet no longer exists.");
  if (!sheet.staffId)
    throw new Error("Match this sheet to a staff member before accepting a difference.");
  await assertTimesheetMonthOpen(db, sheet.month);
  return { row, sheet, staffId: sheet.staffId };
}

/** Accept one difference with a reason. The reason is required. */
export async function acceptRow(
  db: Db,
  a: {
    rowId: string;
    note: string;
    /** The hours really worked. Pay is calculated on this figure. */
    actualHours: number;
    actor: { id: string; name: string };
  },
): Promise<{ sheetId: string; month: string; label: string }> {
  const note = a.note.trim();
  if (note.length < 3) throw new Error("Write the reason for accepting this difference.");
  if (!Number.isFinite(a.actualHours) || a.actualHours < 0 || a.actualHours > 24)
    throw new Error("Write the actual hours worked (between 0 and 24).");
  const actualHours = round2(a.actualHours);
  const { row, sheet, staffId } = await loadRowForAccept(db, a.rowId);
  if (row.result === "match")
    throw new Error("This row already matches; there is nothing to accept.");
  const key = acceptKey({
    result: row.result,
    date: row.date,
    site: row.site,
    sheetHours: row.sheetHours,
    recordHours: row.recordHours,
  });
  await db
    .insert(timesheetAcceptances)
    .values({
      id: uid("tsa"),
      staffId,
      month: sheet.month,
      rowKey: key,
      note: note.slice(0, 500),
      actualHours,
      acceptedBy: a.actor.id,
      acceptedByName: a.actor.name,
    })
    .onConflictDoUpdate({
      target: [
        timesheetAcceptances.staffId,
        timesheetAcceptances.month,
        timesheetAcceptances.rowKey,
      ],
      set: {
        note: note.slice(0, 500),
        actualHours,
        acceptedBy: a.actor.id,
        acceptedByName: a.actor.name,
        acceptedAt: new Date(),
      },
    });
  await recomputeStaffMonth(db, staffId, sheet.month);
  return { sheetId: sheet.id, month: sheet.month, label: `${row.date} ${row.site}`.trim() };
}

/** Take an acceptance back, so the difference counts as an issue again. */
export async function unacceptRow(
  db: Db,
  rowId: string,
): Promise<{ sheetId: string; month: string }> {
  const { row, sheet, staffId } = await loadRowForAccept(db, rowId);
  const key = acceptKey({
    result: row.result,
    date: row.date,
    site: row.site,
    sheetHours: row.sheetHours,
    recordHours: row.recordHours,
  });
  await db
    .delete(timesheetAcceptances)
    .where(
      and(
        eq(timesheetAcceptances.staffId, staffId),
        eq(timesheetAcceptances.month, sheet.month),
        eq(timesheetAcceptances.rowKey, key),
      ),
    );
  await recomputeStaffMonth(db, staffId, sheet.month);
  return { sheetId: sheet.id, month: sheet.month };
}

/** Accept (or take back) that a sheet's own stated total differs from its rows. */
export async function setStatedAccepted(
  db: Db,
  a: { sheetId: string; accept: boolean; note: string; actor: { id: string; name: string } },
): Promise<{ month: string }> {
  const [sheet] = await db
    .select()
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, a.sheetId))
    .limit(1);
  if (!sheet) throw new Error("That sheet no longer exists.");
  if (!sheet.staffId) throw new Error("Match this sheet to a staff member first.");
  await assertTimesheetMonthOpen(db, sheet.month);
  if (a.accept) {
    const note = a.note.trim();
    if (note.length < 3) throw new Error("Write the reason for accepting this difference.");
    if (!statedMismatch(sheet.statedHours, sheet.sheetHours))
      throw new Error("The sheet's total already matches its rows.");
    await db
      .update(timesheetSheets)
      .set({
        statedAcceptedKey: statedKey(sheet.statedHours, sheet.sheetHours),
        statedAcceptedNote: note.slice(0, 500),
        statedAcceptedByName: a.actor.name,
        statedAcceptedAt: new Date(),
      })
      .where(eq(timesheetSheets.id, sheet.id));
  } else {
    await db
      .update(timesheetSheets)
      .set({
        statedAcceptedKey: "",
        statedAcceptedNote: "",
        statedAcceptedByName: "",
        statedAcceptedAt: null,
      })
      .where(eq(timesheetSheets.id, sheet.id));
  }
  await recomputeStaffMonth(db, sheet.staffId, sheet.month);
  return { month: sheet.month };
}

/* ------------------------------ saving a new sheet ------------------------------ */

export async function saveParsedSheet(
  db: Db,
  a: {
    actor: { id: string; name: string };
    fileName: string;
    fileHash: string;
    sheet: ParsedSheet;
  },
): Promise<UploadOutcome> {
  const sheet = { ...a.sheet, warnings: [...a.sheet.warnings] };
  const label = sheet.sheetLabel || a.fileName;
  const fail = (outcome: "duplicate" | "rejected", message: string): UploadOutcome => ({
    label,
    outcome,
    message,
    sheetId: null,
    status: null,
    issues: 0,
    staffName: sheet.personName,
    matchedBy: "none",
    month: "",
  });

  const month = dominantMonth(sheet.rows.map((r) => r.date));
  if (!month)
    return fail("rejected", "None of the rows has a readable date, so the month is unknown.");

  await assertTimesheetMonthOpen(db, month);
  const inputs: SheetRowInput[] = sheet.rows.map((r, i) => ({
    key: i,
    date: r.date,
    site: r.site,
    siteAlt: r.siteAlt,
    hours: r.hours,
    uncertain: r.uncertain,
    parseNote: r.note,
  }));
  const ev = await evaluate(db, {
    personName: sheet.personName,
    personNi: sheet.personNi,
    personDob: sheet.personDob ?? "",
    month,
    rows: inputs,
  });

  if (!ev.staff.staffId) {
    // Nobody matched (for example a name or NI number that does not match Staff). Keep the sheet
    // as "staff not found" instead of throwing the upload away: fix Staff, press Check again,
    // and nothing has to be uploaded a second time. A sheet like this can never be locked.
    const holdingId = uid("ts");
    const held = await db
      .insert(timesheetSheets)
      .values({
        id: holdingId,
        month,
        fileName: a.fileName.slice(0, 255),
        sheetLabel: sheet.sheetLabel.slice(0, 100),
        fileHash: a.fileHash,
        format: sheet.format,
        uploadedBy: a.actor.id,
        uploadedByName: a.actor.name,
        staffId: null,
        matchedBy: "none",
        personName: sheet.personName,
        personNi: sheet.personNi,
        personDob: normalizeDob(sheet.personDob ?? ""),
        personKey: personKeyOf(
          null,
          sheet.personNi,
          sheet.personName,
          a.fileHash,
          sheet.sheetLabel,
        ),
        statedHours: sheet.statedHours,
        sheetHours: ev.sheetHours,
        recordHours: 0,
        rowCount: sheet.rows.length,
        issueCount: ev.answers.filter((x) => x.result !== "match").length,
        status: "staff_not_found",
        readNote: composeReadNote(
          ev.staff.note,
          sheet.warnings.length > 0 ? sheet.warnings.join(" ") : null,
        ),
        comparedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: timesheetSheets.id });
    if (held.length === 0)
      return fail("duplicate", "This file was already uploaded, so nothing was added twice.");
    try {
      for (const part of chunk(
        sheet.rows.map((r, i) => ({ r, ans: ev.answers[i]! })),
        250,
      ))
        await db.insert(timesheetRows).values(
          part.map(({ r, ans }, k) => ({
            id: uid("tr"),
            sheetId: holdingId,
            lineNo: sheet.rows.indexOf(r) + 1 || k + 1,
            fromRecords: false,
            date: r.date,
            site: r.site,
            siteAlt: r.siteAlt,
            startTime: r.start,
            endTime: r.end,
            sheetHours: r.hours,
            rate: r.rate,
            amount: r.amount,
            expense: r.expense,
            uncertain: r.uncertain,
            parseNote: r.note,
            recordHours: ans.recordHours,
            result: ans.result,
            note: ans.note,
          })),
        );
    } catch (err) {
      await db.delete(timesheetSheets).where(eq(timesheetSheets.id, holdingId));
      throw err;
    }
    return {
      label,
      outcome: "saved",
      message: `${ev.staff.note} The sheet is saved as "staff not found": fix the staff record, then press Check again.`,
      sheetId: holdingId,
      status: "staff_not_found",
      issues: ev.answers.filter((x) => x.result !== "match").length,
      staffName: sheet.personName,
      matchedBy: "none",
      month,
    };
  }

  const mismatch = statedMismatch(sheet.statedHours, ev.sheetHours);
  const status = decideStatus({
    staffId: ev.staff.staffId,
    matchedBy: ev.staff.matchedBy,
    confirmed: false,
    issues: ev.issues,
    mismatch,
  });
  const id = uid("ts");
  const key = personKeyOf(
    ev.staff.staffId,
    sheet.personNi,
    sheet.personName,
    a.fileHash,
    sheet.sheetLabel,
  );
  const totalRows = sheet.rows.length + ev.missing.length;

  const inserted = await db
    .insert(timesheetSheets)
    .values({
      id,
      month,
      fileName: a.fileName.slice(0, 255),
      sheetLabel: sheet.sheetLabel.slice(0, 100),
      fileHash: a.fileHash,
      format: sheet.format,
      uploadedBy: a.actor.id,
      uploadedByName: a.actor.name,
      staffId: ev.staff.staffId,
      matchedBy: ev.staff.matchedBy,
      personName: sheet.personName,
      personNi: sheet.personNi,
      personDob: normalizeDob(sheet.personDob ?? ""),
      personKey: key,
      statedHours: sheet.statedHours,
      sheetHours: ev.sheetHours,
      recordHours: ev.recordHours,
      rowCount: totalRows,
      issueCount: ev.issues + (mismatch ? 1 : 0),
      status,
      readNote: composeReadNote(
        ev.staff.note,
        sheet.warnings.length > 0 ? sheet.warnings.join(" ") : null,
      ),
      comparedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: timesheetSheets.id });

  if (inserted.length === 0) {
    // Only the SAME FILE (same content and sheet) can clash now: several different sheets
    // for one person and month are allowed.
    const [existing] = await db
      .select()
      .from(timesheetSheets)
      .where(
        and(
          eq(timesheetSheets.fileHash, a.fileHash),
          eq(timesheetSheets.sheetLabel, sheet.sheetLabel.slice(0, 100)),
        ),
      )
      .limit(1);
    if (!existing)
      return fail("rejected", "The upload could not be saved. Refresh the list and try again.");
    return {
      ...fail(
        "duplicate",
        `This file was already uploaded for ${formatMonthLabel(existing.month)}, so nothing was added twice. Open it to review it.`,
      ),
      sheetId: existing.id,
      month: existing.month,
      staffName: existing.personName,
    };
  }

  const rowValues: (typeof timesheetRows.$inferInsert)[] = sheet.rows.map((r, i) => {
    const ans = ev.answers[i]!;
    return {
      id: uid("tr"),
      sheetId: id,
      lineNo: i + 1,
      fromRecords: false,
      date: r.date,
      site: r.site,
      siteAlt: r.siteAlt,
      startTime: r.start,
      endTime: r.end,
      sheetHours: r.hours,
      rate: r.rate,
      amount: r.amount,
      expense: r.expense,
      uncertain: r.uncertain,
      parseNote: r.note,
      recordHours: ans.recordHours,
      result: ans.result,
      note: ans.note,
    };
  });

  try {
    for (const part of chunk(rowValues, 250)) await db.insert(timesheetRows).values(part);
    // Merge with the person's other sheets for this month and compare everything once.
    await recomputeStaffMonth(db, ev.staff.staffId, month);
  } catch (err) {
    // Never leave a half-saved sheet behind.
    await db.delete(timesheetSheets).where(eq(timesheetSheets.id, id));
    throw err;
  }

  const [saved] = await db
    .select({ status: timesheetSheets.status, issues: timesheetSheets.issueCount })
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, id))
    .limit(1);

  return {
    label,
    outcome: "saved",
    message: ev.staff.note,
    sheetId: id,
    status: saved ? storedStatus({ staffId: ev.staff.staffId, status: saved.status }) : status,
    // The same figure the list shows: the sheet's own stated-total difference is included.
    issues: saved?.issues ?? ev.issues + (mismatch ? 1 : 0),
    staffName: ev.staff.staffName || sheet.personName,
    matchedBy: ev.staff.matchedBy,
    month,
  };
}

/* ------------------------------ checking a saved sheet again ------------------------------ */

export interface RecheckResult {
  id: string;
  status: SheetStatus;
  previousStatus: SheetStatus;
  issues: number;
  note: string;
}

/**
 * Runs the comparison again for one saved sheet (after Staff or shifts changed): finds the
 * person again, then re-compares everything that person sent for the month (their other
 * sheets included, so nothing is counted twice). Safe to run any number of times.
 */
export async function recheckSheet(db: Db, sheetId: string): Promise<RecheckResult | null> {
  const [sheet] = await db
    .select()
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, sheetId))
    .limit(1);
  if (!sheet) return null;
  await assertTimesheetMonthOpen(db, sheet.month);

  // While rechecking, the sheet cannot be locked as ready with old comparison results.
  await db
    .update(timesheetSheets)
    .set({ status: "needs_review", comparedAt: null })
    .where(eq(timesheetSheets.id, sheetId));

  const staff = await findStaff(db, sheet.personNi, sheet.personName, sheet.personDob ?? "");
  // A human's confirmation of a name-only match only survives while it is the same person.
  const keepConfirmed =
    staff.matchedBy === "name" &&
    sheet.staffId === staff.staffId &&
    sheet.staffConfirmedAt !== null;
  const key = personKeyOf(
    staff.staffId,
    sheet.personNi,
    sheet.personName,
    sheet.fileHash,
    sheet.sheetLabel,
  );
  await db
    .update(timesheetSheets)
    .set({
      staffId: staff.staffId,
      matchedBy: staff.matchedBy,
      staffConfirmedAt: keepConfirmed ? sheet.staffConfirmedAt : null,
      personKey: key,
      readNote: composeReadNote(staff.note, stripIdentityNote(sheet.readNote)),
    })
    .where(eq(timesheetSheets.id, sheetId));

  if (staff.staffId) {
    await recomputeStaffMonth(db, staff.staffId, sheet.month);
  } else {
    await recheckUnmatched(db, sheet);
  }
  // The person this sheet used to belong to may have lost (or regained) a sheet.
  if (sheet.staffId && sheet.staffId !== staff.staffId) {
    await recomputeStaffMonth(db, sheet.staffId, sheet.month);
  }

  const [after] = await db
    .select()
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, sheetId))
    .limit(1);
  return {
    id: sheetId,
    status: after ? storedStatus(after) : "needs_review",
    previousStatus: storedStatus(sheet),
    issues: after?.issueCount ?? 0,
    note: staff.note,
  };
}

/** A sheet nobody could be matched to: its rows cannot be compared, only listed. */
async function recheckUnmatched(db: Db, sheet: SheetRec): Promise<void> {
  const stored = await db
    .select()
    .from(timesheetRows)
    .where(and(eq(timesheetRows.sheetId, sheet.id), eq(timesheetRows.fromRecords, false)))
    .orderBy(asc(timesheetRows.lineNo));
  const inputs: SheetRowInput[] = stored.map((r, i) => ({
    key: i,
    date: r.date,
    site: r.site,
    siteAlt: r.siteAlt,
    hours: r.sheetHours,
    uncertain: r.uncertain,
    parseNote: r.parseNote,
  }));
  const { answers, missing } = compareRows({
    staffFound: false,
    month: sheet.month,
    rows: inputs,
    records: [],
    zeroHourDates: new Set<string>(),
  });
  for (const part of chunk(
    stored.map((r, i) => ({ r, a: answers[i]! })),
    200,
  )) {
    const list = sql.join(
      part.map(
        ({ r, a }) =>
          sql`(${r.id}::text, ${a.result}::text, ${a.recordHours}::numeric, ${a.note}::text)`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE timesheet_rows t
      SET result = v.result, record_hours = v.record_hours, note = v.note,
          accepted_note = '', accepted_by_name = '', accepted_at = NULL
      FROM (VALUES ${list}) AS v(id, result, record_hours, note)
      WHERE t.id = v.id`);
  }
  await db
    .delete(timesheetRows)
    .where(and(eq(timesheetRows.sheetId, sheet.id), eq(timesheetRows.fromRecords, true)));
  const sheetHours = sumHours(stored.map((r) => r.sheetHours));
  await db
    .update(timesheetSheets)
    .set({
      sheetHours,
      recordHours: 0,
      rowCount: stored.length + missing.length,
      issueCount: answers.filter((x) => x.result !== "match").length,
      status: "staff_not_found",
      comparedAt: new Date(),
    })
    .where(eq(timesheetSheets.id, sheet.id));
}

/* ------------------------------ confirming a name-only match ------------------------------ */

export async function confirmNameMatch(db: Db, sheetId: string): Promise<boolean> {
  const [sheet] = await db
    .select()
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, sheetId))
    .limit(1);
  if (!sheet || !sheet.staffId || sheet.matchedBy !== "name") return false;
  const identity = await findStaff(db, sheet.personNi, sheet.personName, sheet.personDob);
  if (!identity.staffId || identity.staffId !== sheet.staffId)
    throw new Error(identity.note || "Use Correct identity to verify this staff member first.");
  await assertTimesheetMonthOpen(db, sheet.month);
  await db
    .update(timesheetSheets)
    .set({
      staffConfirmedAt: new Date(),
      readNote: composeReadNote(
        `${IDENTITY_NOTE_PREFIX}${identity.staffName} was approved as the staff member for this sheet.`,
        stripIdentityNote(sheet.readNote),
      ),
    })
    .where(eq(timesheetSheets.id, sheetId));
  await recomputeStaffMonth(db, sheet.staffId, sheet.month);
  return true;
}

/* ------------------------------ database rows -> what the screens use ------------------------------ */

const RESULTS: readonly RowResult[] = [
  "match",
  "hours_over",
  "hours_under",
  "not_in_records",
  "not_on_sheet",
  "check_reading",
];
const asResult = (v: string): RowResult =>
  (RESULTS as readonly string[]).includes(v) ? (v as RowResult) : "check_reading";
const asFormat = (v: string): SheetFormat =>
  v === "pdf" || v === "word" || v === "photo" ? v : "excel";

/** A deleted staff member leaves staff_id empty: the sheet is then "staff not found". */
export function storedStatus(s: Pick<SheetRec, "staffId" | "status">): SheetStatus {
  if (s.staffId === null) return "staff_not_found";
  return s.status === "ready" ? "ready" : "needs_review";
}

export interface SheetWithStaff {
  sheet: SheetRec;
  staffName: string | null;
  staffNi: string | null;
  staffEmail: string | null;
}

const stem = (file: string) => file.replace(/\.[^.]+$/, "");

function displayName(x: SheetWithStaff): string {
  return x.staffName || x.sheet.personName || stem(x.sheet.fileName);
}

export function toListItem(x: SheetWithStaff): SheetListItem {
  const s = x.sheet;
  return {
    id: s.id,
    staffName: displayName(x),
    ni: x.staffNi || s.personNi,
    matchedBy: s.staffId === null ? "none" : (s.matchedBy as "ni" | "name" | "none"),
    staffConfirmed: s.staffConfirmedAt !== null,
    fileName: s.fileName,
    sheetLabel: s.sheetLabel,
    format: asFormat(s.format),
    uploadedAt: s.uploadedAt.toISOString(),
    uploadedByName: s.uploadedByName,
    month: s.month,
    monthLabel: formatMonthLabel(s.month),
    sheetHours: s.sheetHours,
    recordHours: s.recordHours,
    // Accepted differences are gone from the difference; old sheets fall back to the plain figure.
    diff: s.openDiff ?? round2(s.sheetHours - s.recordHours),
    payHours: s.payHours,
    payAmount: s.payAmount,
    issues: s.issueCount,
    statedMismatch:
      statedMismatch(s.statedHours, s.sheetHours) &&
      s.statedAcceptedKey !== statedKey(s.statedHours, s.sheetHours),
    status: storedStatus(s),
  };
}

export function toTimesheetSheet(x: SheetWithStaff, rows: readonly RowRec[]): TimesheetSheet {
  const s = x.sheet;
  const mapped: SheetRow[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    site: r.site,
    start: r.fromRecords || !r.startTime ? "—" : r.startTime,
    end: r.fromRecords || !r.endTime ? "—" : r.endTime,
    sheetHours: r.sheetHours ?? 0,
    recordHours: r.recordHours,
    rate: r.rate ?? 0,
    payRate: r.payRate,
    payHours: r.payHours,
    payAmount: r.payAmount,
    result: asResult(r.result),
    ...(r.note ? { note: r.note } : {}),
    ...(r.editHours !== null && r.editedAt
      ? {
          edited: {
            hours: r.editHours,
            rate: r.editRate ?? 0,
            note: r.editNote,
            by: r.editedByName,
            at: r.editedAt.toISOString(),
          },
        }
      : {}),
    ...(r.acceptedAt
      ? {
          accepted: {
            note: r.acceptedNote,
            by: r.acceptedByName,
            at: r.acceptedAt.toISOString(),
            actualHours: r.acceptedHours,
          },
        }
      : {}),
  }));
  const label = s.sheetLabel ? `${s.fileName} (${s.sheetLabel})` : s.fileName;
  return {
    id: s.id,
    staffName: displayName(x),
    email: x.staffEmail ?? "",
    ni: x.staffNi || s.personNi,
    matchedBy: s.staffId === null ? "none" : (s.matchedBy as "ni" | "name" | "none"),
    fileName: label,
    format: asFormat(s.format),
    uploadedAt: s.uploadedAt.toISOString(),
    month: s.month,
    monthLabel: formatMonthLabel(s.month),
    // The screens only show the stated total when it differs from the rows, so a sheet
    // with no stated total reports its own total (no false "total is wrong" warning).
    statedHours: s.statedHours ?? s.sheetHours,
    status: storedStatus(s),
    staffConfirmed: s.staffConfirmedAt !== null,
    ...(s.readNote ? { readNote: s.readNote } : {}),
    ...(s.statedAcceptedAt && s.statedAcceptedKey === statedKey(s.statedHours, s.sheetHours)
      ? {
          statedAccepted: {
            note: s.statedAcceptedNote,
            by: s.statedAcceptedByName,
            at: s.statedAcceptedAt.toISOString(),
          },
        }
      : {}),
    sourceName: s.personName,
    sourceNi: s.personNi,
    sourceDob: s.personDob,
    rows: mapped,
  };
}
