/**
 * Core of Timesheet Check, free of auth / request handling (same idea as shiftImport.ts)
 * so it can be tested against a real Postgres. The server functions in
 * src/lib/actions/timesheets.ts check who is asking and then call this.
 *
 * Matching the person: NI number first, then a name that is UNIQUE in Staff. A name-only
 * match is never trusted by itself: the sheet stays "needs a look" until a person confirms
 * it. Matching asks the database for the one person (never loads all staff), so it stays
 * fast with 10,000+ staff.
 */
import { and, asc, eq, gte, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import * as schema from "../../../drizzle/schema";
import {
  payrollStaff,
  salaryShifts,
  timesheetRows,
  timesheetSheets,
} from "../../../drizzle/schema";
import { formatMonthLabel, normName, normNi, round2 } from "../payroll/calc";
import { filenameStaffName, FILE_NAME_NOTICE } from "../timesheets/fileIdentity";
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

export async function findStaff(db: Db, rawNi: string, rawName: string): Promise<StaffMatch> {
  const niKey = normNi(rawNi);
  const nameKey = normName(rawName).replace(/\s+/g, " ");

  if (niKey.length >= 6) {
    const res = await db.execute(sql`
      SELECT id, name FROM payroll_staff
      WHERE regexp_replace(upper(ni), '[^A-Z0-9]', '', 'g') = ${niKey}
      LIMIT 3`);
    const hits = res.rows as { id: string; name: string }[];
    if (hits.length === 1 && hits[0]) {
      return { staffId: hits[0].id, matchedBy: "ni", staffName: hits[0].name, note: "" };
    }
    if (hits.length > 1) {
      return NO_MATCH("More than one staff member has this NI number. Fix it in Staff first.");
    }
  }

  if (nameKey) {
    const res = await db.execute(sql`
      SELECT id, name, ni FROM payroll_staff
      WHERE trim(regexp_replace(regexp_replace(regexp_replace(lower(name), '[(][^)]*[)]', ' ', 'g'), '[^a-z0-9]+', ' ', 'g'), ' +', ' ', 'g')) = ${nameKey}
      LIMIT 5`);
    const hits = (res.rows as { id: string; name: string; ni: string }[]).filter(
      (h) => normName(h.name).replace(/\s+/g, " ") === nameKey,
    );
    if (hits.length === 1 && hits[0]) {
      const theirNi = normNi(hits[0].ni);
      // Same name but a DIFFERENT NI number is a different person (or a typo): never merge.
      if (niKey && theirNi && niKey !== theirNi) {
        return NO_MATCH(
          "The NI number on the sheet is not in Staff, and the person with this name has a different NI number.",
        );
      }
      return { staffId: hits[0].id, matchedBy: "name", staffName: hits[0].name, note: "" };
    }
    if (hits.length > 1)
      return NO_MATCH("More than one staff member has this name. Add the NI number to the sheet.");
  }
  return NO_MATCH(
    niKey || nameKey ? "This person is not in Staff." : "The sheet has no name and no NI number.",
  );
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
  a: { personName: string; personNi: string; month: string; rows: SheetRowInput[] },
): Promise<Evaluation> {
  const staff = await findStaff(db, a.personNi, a.personName);
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

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505")
      return true;
    e = typeof e === "object" && e !== null ? (e as { cause?: unknown }).cause : undefined;
  }
  return false;
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
  if (!sheet.personName && !sheet.personNi) {
    const hint = filenameStaffName(a.fileName);
    if (hint) {
      sheet.personName = hint;
      sheet.warnings = sheet.warnings.filter(
        (note) => !note.startsWith("No name or NI number was found"),
      );
      sheet.warnings.push(FILE_NAME_NOTICE);
    }
  }
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
    month,
    rows: inputs,
  });

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
      personKey: key,
      statedHours: sheet.statedHours,
      sheetHours: ev.sheetHours,
      recordHours: ev.recordHours,
      rowCount: totalRows,
      issueCount: ev.issues,
      status,
      readNote: sheet.warnings.length > 0 ? sheet.warnings.join(" ") : null,
      comparedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: timesheetSheets.id });

  if (inserted.length === 0) {
    const [same] = await db
      .select({ at: timesheetSheets.uploadedAt })
      .from(timesheetSheets)
      .where(
        and(
          eq(timesheetSheets.fileHash, a.fileHash),
          eq(timesheetSheets.sheetLabel, sheet.sheetLabel.slice(0, 100)),
        ),
      )
      .limit(1);
    if (same) {
      return fail(
        "duplicate",
        `This exact file was already uploaded on ${same.at.toLocaleDateString("en-GB")}. Nothing was added.`,
      );
    }
    return fail(
      "duplicate",
      `There is already a sheet for this person for ${formatMonthLabel(month)}. Delete the old one first if this one replaces it.`,
    );
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
  ev.missing.forEach((m, i) => {
    rowValues.push({
      id: uid("tr"),
      sheetId: id,
      lineNo: 10000 + i,
      fromRecords: true,
      date: m.date,
      site: m.site,
      sheetHours: 0,
      rate: m.rate,
      recordHours: m.recordHours,
      result: "not_on_sheet",
      note: m.note,
    });
  });

  try {
    for (const part of chunk(rowValues, 250)) await db.insert(timesheetRows).values(part);
  } catch (err) {
    // Never leave a half-saved sheet behind.
    await db.delete(timesheetSheets).where(eq(timesheetSheets.id, id));
    throw err;
  }

  return {
    label,
    outcome: "saved",
    message: ev.staff.note,
    sheetId: id,
    status,
    issues: ev.issues + (mismatch ? 1 : 0),
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
 * person again, reloads our records, rewrites each row's answer and the sheet's totals.
 * Safe to run any number of times.
 */
export async function recheckSheet(db: Db, sheetId: string): Promise<RecheckResult | null> {
  const [sheet] = await db
    .select()
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, sheetId))
    .limit(1);
  if (!sheet) return null;
  await assertTimesheetMonthOpen(db, sheet.month);
  const stored = await db
    .select()
    .from(timesheetRows)
    .where(and(eq(timesheetRows.sheetId, sheetId), eq(timesheetRows.fromRecords, false)))
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
  const inferredName =
    !sheet.personName && !sheet.personNi ? filenameStaffName(sheet.fileName) : "";
  const personName = sheet.personName || inferredName;
  // While rechecking, the sheet cannot be locked as ready with old comparison results.
  await db
    .update(timesheetSheets)
    .set({ status: "needs_review", comparedAt: null })
    .where(eq(timesheetSheets.id, sheetId));
  const ev = await evaluate(db, {
    personName,
    personNi: sheet.personNi,
    month: sheet.month,
    rows: inputs,
  });

  // A human's confirmation of a name-only match only survives while it is the same person.
  const keepConfirmed =
    ev.staff.matchedBy === "name" &&
    sheet.staffId === ev.staff.staffId &&
    sheet.staffConfirmedAt !== null;
  const mismatch = statedMismatch(sheet.statedHours, ev.sheetHours);
  const status = decideStatus({
    staffId: ev.staff.staffId,
    matchedBy: ev.staff.matchedBy,
    confirmed: keepConfirmed,
    issues: ev.issues,
    mismatch,
  });

  // 1. each sheet row's answer
  for (const part of chunk(
    stored.map((r, i) => ({ r, a: ev.answers[i]! })),
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
      SET result = v.result, record_hours = v.record_hours, note = v.note
      FROM (VALUES ${list}) AS v(id, result, record_hours, note)
      WHERE t.id = v.id`);
  }
  // 2. the "in our records but not on the sheet" rows are rebuilt
  await db
    .delete(timesheetRows)
    .where(and(eq(timesheetRows.sheetId, sheetId), eq(timesheetRows.fromRecords, true)));
  const extra: (typeof timesheetRows.$inferInsert)[] = ev.missing.map((m, i) => ({
    id: uid("tr"),
    sheetId,
    lineNo: 10000 + i,
    fromRecords: true,
    date: m.date,
    site: m.site,
    sheetHours: 0,
    rate: m.rate,
    recordHours: m.recordHours,
    result: "not_on_sheet",
    note: m.note,
  }));
  for (const part of chunk(extra, 250)) await db.insert(timesheetRows).values(part);

  // 3. the sheet's own line
  const key = personKeyOf(
    ev.staff.staffId,
    sheet.personNi,
    personName,
    sheet.fileHash,
    sheet.sheetLabel,
  );
  const common = {
    personName,
    ...(inferredName
      ? {
          readNote: [
            sheet.readNote?.replace(/No name or NI number was found[^.]*\./, "").trim(),
            FILE_NAME_NOTICE,
          ]
            .filter(Boolean)
            .join(" "),
        }
      : {}),
    staffId: ev.staff.staffId,
    matchedBy: ev.staff.matchedBy,
    staffConfirmedAt: keepConfirmed ? sheet.staffConfirmedAt : null,
    sheetHours: ev.sheetHours,
    recordHours: ev.recordHours,
    rowCount: stored.length + ev.missing.length,
    issueCount: ev.issues,
    status,
    comparedAt: new Date(),
  };
  try {
    await db
      .update(timesheetSheets)
      .set({ ...common, personKey: key })
      .where(eq(timesheetSheets.id, sheetId));
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Keep the comparison reviewable, but never mark a duplicate person/month ready.
    await db
      .update(timesheetSheets)
      .set({ ...common, status: "needs_review", staffConfirmedAt: null })
      .where(eq(timesheetSheets.id, sheetId));
    throw new Error(
      "Another sheet already exists for this staff member and month. Review the duplicate before confirming.",
    );
  }

  return {
    id: sheetId,
    status,
    previousStatus: storedStatus(sheet),
    issues: ev.issues + (mismatch ? 1 : 0),
    note: ev.staff.note,
  };
}

/* ------------------------------ confirming a name-only match ------------------------------ */

export async function confirmNameMatch(db: Db, sheetId: string): Promise<boolean> {
  const [sheet] = await db
    .select()
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, sheetId))
    .limit(1);
  if (!sheet || !sheet.staffId || sheet.matchedBy !== "name") return false;
  await assertTimesheetMonthOpen(db, sheet.month);
  const [duplicate] = await db
    .select({ id: timesheetSheets.id })
    .from(timesheetSheets)
    .where(
      and(
        eq(timesheetSheets.staffId, sheet.staffId),
        eq(timesheetSheets.month, sheet.month),
        ne(timesheetSheets.id, sheet.id),
      ),
    )
    .limit(1);
  if (duplicate)
    throw new Error(
      "Another sheet exists for this staff member and month. Review the duplicate first.",
    );
  const mismatch = statedMismatch(sheet.statedHours, sheet.sheetHours);
  const status = decideStatus({
    staffId: sheet.staffId,
    matchedBy: "name",
    confirmed: true,
    issues: sheet.issueCount,
    mismatch,
  });
  await db
    .update(timesheetSheets)
    .set({ staffConfirmedAt: new Date(), status })
    .where(eq(timesheetSheets.id, sheetId));
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
    diff: round2(s.sheetHours - s.recordHours),
    issues: s.issueCount,
    statedMismatch: statedMismatch(s.statedHours, s.sheetHours),
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
    result: asResult(r.result),
    ...(r.note ? { note: r.note } : {}),
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
    sourceName: s.personName,
    sourceNi: s.personNi,
    rows: mapped,
  };
}
