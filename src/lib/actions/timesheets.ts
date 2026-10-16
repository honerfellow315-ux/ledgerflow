/**
 * Timesheet Check server functions. Every handler checks the "timesheets" permission on the
 * server (the real security boundary; hiding buttons is only UX):
 *   view    - open the list and sheets
 *   create  - upload sheets
 *   edit    - check again, confirm / correct a sheet's staff member
 *   delete  - delete a sheet
 *   approve - accept a difference with a note, lock a month
 * Reopening a locked month is admin-only. Admins pass every check.
 * The work itself lives in src/lib/server/timesheetCheck.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { assertTimesheetMonthOpen } from "../server/timesheetLocks";
import { db } from "../server/db";
import { payrollStaff, timesheetRows, timesheetSheets } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { hasPermission } from "../permissions";
import { recordActivity } from "../server/activity";
import { formatMonthLabel } from "../payroll/calc";
import {
  acceptRow,
  calculateMissingPay,
  confirmNameMatch,
  findStaff,
  setStatedAccepted,
  unacceptRow,
  personKeyOf,
  recheckSheet,
  saveParsedSheet,
  toListItem,
  toTimesheetSheet,
  type SheetWithStaff,
} from "../server/timesheetCheck";
import {
  addStaffPayment,
  deleteStaffPayment,
  editRow,
  getAccountDetails,
  getStaffMonthPay,
  PAYMENT_METHODS,
  saveAccountDetails,
  type AccountDetails,
  type StaffMonthPay,
} from "../server/timesheetEdit";
import { MAX_ROWS_PER_SHEET, MAX_SHEETS_PER_FILE } from "../timesheets/parsed";
import type { SheetListPage, UploadOutcome } from "../timesheets/listTypes";
import type { TimesheetSheet } from "../timesheets/data";

/* ------------------------------ input checks ------------------------------ */

const money = z.number().finite().min(0).max(1_000_000).nullable();

const parsedRow = z.object({
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  site: z.string().max(200),
  siteAlt: z.string().max(200),
  start: z.string().regex(/^(\d{2}:\d{2})?$/),
  end: z.string().regex(/^(\d{2}:\d{2})?$/),
  hours: z.number().finite().min(0).max(100).nullable(),
  rate: money,
  amount: money,
  expense: money,
  uncertain: z.boolean(),
  note: z.string().max(500),
});

const parsedSheet = z.object({
  format: z.enum(["excel", "pdf", "word", "photo"]),
  sheetLabel: z.string().max(100),
  personName: z.string().max(120),
  personNi: z.string().max(20),
  personDob: z.string().max(30).default(""),
  statedHours: z.number().finite().min(0).max(5000).nullable(),
  rows: z.array(parsedRow).min(1).max(MAX_ROWS_PER_SHEET),
  warnings: z.array(z.string().max(300)).max(20),
});

const month = z.string().regex(/^\d{4}-\d{2}$/);
const status = z.enum(["ready", "needs_review", "staff_not_found"]);

const listFilter = z.object({
  /** yyyy-mm, or "all". */
  month: z.union([month, z.literal("all")]),
  search: z.string().trim().max(80).default(""),
  status: z.union([status, z.literal("all")]).default("all"),
});

type Viewer = Awaited<ReturnType<typeof requirePermission>>;

/** NI numbers and dates of birth stay behind the Staff permission, as everywhere else. */
const seesIdentity = (u: Viewer) => hasPermission(u.role, u.permissions, "staff", "view");
const hideSheet = (t: TimesheetSheet): TimesheetSheet => ({
  ...t,
  ni: "",
  sourceNi: "",
  sourceDob: "",
});

const actorName = (u: { displayName: string; username: string }) => u.displayName || u.username;

/* ------------------------------ shared query pieces ------------------------------ */

/** Escapes % and _ so a search for "50%" is not a wildcard. */
const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

function whereOf(f: z.infer<typeof listFilter>): SQL | undefined {
  const parts: SQL[] = [];
  if (f.month !== "all") parts.push(eq(timesheetSheets.month, f.month));
  if (f.status === "staff_not_found") parts.push(isNull(timesheetSheets.staffId));
  else if (f.status !== "all") {
    parts.push(isNotNull(timesheetSheets.staffId), eq(timesheetSheets.status, f.status));
  }
  if (f.search) {
    const like = likeOf(f.search);
    const term = or(
      ilike(timesheetSheets.personName, like),
      ilike(timesheetSheets.fileName, like),
      ilike(payrollStaff.name, like),
    );
    if (term) parts.push(term);
  }
  return parts.length > 0 ? and(...parts) : undefined;
}

const sheetColumns = {
  sheet: timesheetSheets,
  staffName: payrollStaff.name,
  staffNi: payrollStaff.ni,
  staffEmail: payrollStaff.email,
};

/* ------------------------------ upload ------------------------------ */

/**
 * Saves the timesheets that were read from ONE file (the browser reads the file, like the
 * shift import) and compares each one with our records. One call per file keeps every
 * request small however many files are uploaded.
 */
export const uploadTimesheetFile = createServerFn({ method: "POST" })
  .validator(
    z.object({
      fileName: z.string().trim().min(1).max(255),
      fileHash: z.string().regex(/^[0-9a-f]{64}$/),
      sheets: z.array(parsedSheet).min(1).max(MAX_SHEETS_PER_FILE),
    }),
  )
  .handler(async ({ data }): Promise<UploadOutcome[]> => {
    const actor = await requirePermission("timesheets", "create");
    const outcomes: UploadOutcome[] = [];
    for (const sheet of data.sheets) {
      const out = await saveParsedSheet(db, {
        actor: { id: actor.id, name: actorName(actor) },
        fileName: data.fileName,
        fileHash: data.fileHash,
        sheet,
      });
      outcomes.push(out);
      if (out.outcome === "saved" && out.sheetId) {
        await recordActivity({
          actor,
          action: "created",
          module: "timesheets",
          entityId: out.sheetId,
          label: `Timesheet — ${out.staffName || data.fileName} ${formatMonthLabel(out.month)}`,
          details: `Uploaded ${data.fileName}: ${sheet.rows.length} rows, ${out.issues} to look at`,
        });
      }
    }
    return outcomes;
  });

/* ------------------------------ reading ------------------------------ */

export const listTimesheetMonths = createServerFn({ method: "GET" }).handler(async () => {
  await requirePermission("timesheets", "view");
  const res = await db.execute(sql`
    SELECT month, count(*)::int AS sheets FROM timesheet_sheets
    GROUP BY month ORDER BY month DESC LIMIT 48`);
  return (res.rows as { month: string; sheets: number }[]).map((r) => ({
    month: r.month,
    label: formatMonthLabel(r.month),
    sheets: Number(r.sheets),
  }));
});

export const listTimesheetSheets = createServerFn({ method: "GET" })
  .validator(
    listFilter.extend({
      page: z.number().int().min(1).max(10000).default(1),
      pageSize: z.number().int().min(5).max(100).default(25),
    }),
  )
  .handler(async ({ data }): Promise<SheetListPage> => {
    const viewer = await requirePermission("timesheets", "view");
    const where = whereOf(data);
    const rows = await db
      .select(sheetColumns)
      .from(timesheetSheets)
      .leftJoin(payrollStaff, eq(timesheetSheets.staffId, payrollStaff.id))
      .where(where)
      .orderBy(desc(timesheetSheets.uploadedAt), desc(timesheetSheets.id))
      .limit(data.pageSize)
      .offset((data.page - 1) * data.pageSize);

    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(timesheetSheets)
      .leftJoin(payrollStaff, eq(timesheetSheets.staffId, payrollStaff.id))
      .where(where);

    const monthWhere = data.month === "all" ? sql`TRUE` : sql`month = ${data.month}`;
    const sum = await db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE staff_id IS NOT NULL AND status = 'ready')::int AS ready,
             count(*) FILTER (WHERE staff_id IS NOT NULL AND status <> 'ready')::int AS needs_review,
             count(*) FILTER (WHERE staff_id IS NULL)::int AS not_found,
             COALESCE(sum(pay_hours), 0)::float8 AS pay_hours,
             COALESCE(sum(pay_amount), 0)::float8 AS pay_amount,
             count(*) FILTER (WHERE staff_id IS NOT NULL AND pay_amount IS NULL)::int AS pay_missing
      FROM timesheet_sheets WHERE ${monthWhere}`);
    const s = (sum.rows[0] ?? {}) as Record<string, number | undefined>;

    return {
      items: rows.map(toListItem).map((it) => (seesIdentity(viewer) ? it : { ...it, ni: "" })),
      total: count?.n ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      summary: {
        total: Number(s["total"] ?? 0),
        ready: Number(s["ready"] ?? 0),
        needsReview: Number(s["needs_review"] ?? 0),
        notFound: Number(s["not_found"] ?? 0),
        payHours: Number(s["pay_hours"] ?? 0),
        payAmount: Number(s["pay_amount"] ?? 0),
        payMissing: Number(s["pay_missing"] ?? 0),
      },
    };
  });

async function loadWithRows(rows: SheetWithStaff[]): Promise<TimesheetSheet[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.sheet.id);
  const all = await db
    .select()
    .from(timesheetRows)
    .where(inArray(timesheetRows.sheetId, ids))
    .orderBy(
      asc(sql`CASE WHEN ${timesheetRows.date} = '' THEN 1 ELSE 0 END`),
      asc(timesheetRows.date),
      asc(timesheetRows.fromRecords),
      asc(timesheetRows.lineNo),
    );
  const bySheet = new Map<string, (typeof all)[number][]>();
  for (const r of all) {
    const list = bySheet.get(r.sheetId);
    if (list) list.push(r);
    else bySheet.set(r.sheetId, [r]);
  }
  return rows.map((x) => toTimesheetSheet(x, bySheet.get(x.sheet.id) ?? []));
}

export const getTimesheetSheet = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<TimesheetSheet | null> => {
    const viewer = await requirePermission("timesheets", "view");
    const found = await db
      .select(sheetColumns)
      .from(timesheetSheets)
      .leftJoin(payrollStaff, eq(timesheetSheets.staffId, payrollStaff.id))
      .where(eq(timesheetSheets.id, data.id))
      .limit(1);
    const [one] = await loadWithRows(found);
    if (!one) return null;
    return seesIdentity(viewer) ? one : hideSheet(one);
  });

/** Sheets WITH their rows, a page at a time, for the Excel receipt / report download. */
export const getTimesheetReportPage = createServerFn({ method: "GET" })
  .validator(
    listFilter.extend({
      offset: z.number().int().min(0).max(100000),
      limit: z.number().int().min(1).max(50),
    }),
  )
  .handler(async ({ data }): Promise<TimesheetSheet[]> => {
    const viewer = await requirePermission("timesheets", "view");
    const found = await db
      .select(sheetColumns)
      .from(timesheetSheets)
      .leftJoin(payrollStaff, eq(timesheetSheets.staffId, payrollStaff.id))
      .where(whereOf(data))
      .orderBy(asc(timesheetSheets.personName), asc(timesheetSheets.id))
      .limit(data.limit)
      .offset(data.offset);
    const loaded = await loadWithRows(found);
    return seesIdentity(viewer) ? loaded : loaded.map(hideSheet);
  });

/* ------------------------------ changing ------------------------------ */

export const recheckTimesheetSheet = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "edit");
    const res = await recheckSheet(db, data.id);
    if (!res) throw new Error("That sheet no longer exists.");
    await recordActivity({
      actor,
      action: "updated",
      module: "timesheets",
      entityId: data.id,
      label: "Timesheet checked again",
      details: `Result: ${res.status}, ${res.issues} to look at`,
    });
    return res;
  });

/**
 * Re-checks a month in small steps: call it again with `nextCursor` until it is null.
 * (A month can hold thousands of sheets, so one call only does a few.)
 */
export const recheckTimesheetBatch = createServerFn({ method: "POST" })
  .validator(
    z.object({
      month,
      cursor: z.string().max(100).nullable(),
      limit: z.number().int().min(1).max(15).default(10),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "edit");
    const ids = await db
      .select({ id: timesheetSheets.id })
      .from(timesheetSheets)
      .where(
        data.cursor
          ? and(eq(timesheetSheets.month, data.month), gt(timesheetSheets.id, data.cursor))
          : eq(timesheetSheets.month, data.month),
      )
      .orderBy(asc(timesheetSheets.id))
      .limit(data.limit);
    let changed = 0;
    for (const { id } of ids) {
      const res = await recheckSheet(db, id);
      if (res && res.status !== res.previousStatus) changed++;
    }
    const last = ids.at(-1)?.id ?? null;
    if (ids.length > 0) {
      await recordActivity({
        actor,
        action: "updated",
        module: "timesheets",
        label: `Timesheets checked again — ${formatMonthLabel(data.month)}`,
        details: `${ids.length} sheets, ${changed} changed status`,
      });
    }
    return { processed: ids.length, changed, nextCursor: ids.length === data.limit ? last : null };
  });

export const confirmTimesheetStaff = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "edit");
    const ok = await confirmNameMatch(db, data.id);
    if (!ok) throw new Error("There is nothing to confirm on this sheet.");
    await recordActivity({
      actor,
      action: "updated",
      module: "timesheets",
      entityId: data.id,
      label: "Timesheet — name match confirmed",
    });
    return { ok: true };
  });

export const deleteTimesheetSheet = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "delete");
    const [row] = await db
      .select({
        id: timesheetSheets.id,
        month: timesheetSheets.month,
        name: timesheetSheets.personName,
        file: timesheetSheets.fileName,
      })
      .from(timesheetSheets)
      .where(eq(timesheetSheets.id, data.id))
      .limit(1);
    if (!row) return { ok: true };
    await assertTimesheetMonthOpen(db, row.month);
    await db.delete(timesheetSheets).where(eq(timesheetSheets.id, data.id)); // rows cascade
    await recordActivity({
      actor,
      action: "deleted",
      module: "timesheets",
      entityId: row.id,
      label: `Timesheet — ${row.name || row.file} ${formatMonthLabel(row.month)}`,
    });
    return { ok: true };
  });

/** Fix only the identity read from this upload; existing Staff / payroll records are untouched. */
export const correctTimesheetIdentity = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        id: z.string().min(1).max(100),
        name: z.string().trim().max(120),
        ni: z.string().trim().max(20),
        dob: z.string().trim().max(30).default(""),
      })
      .refine((value) => !!value.name || !!value.ni, "Enter the NI number or the staff name."),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "edit");
    // This form reads and writes NI numbers and dates of birth, which sit behind Staff.
    await requirePermission("staff", "view");
    const [sheet] = await db
      .select()
      .from(timesheetSheets)
      .where(eq(timesheetSheets.id, data.id))
      .limit(1);
    if (!sheet) throw new Error("That sheet no longer exists.");
    await assertTimesheetMonthOpen(db, sheet.month);
    const match = await findStaff(db, data.ni, data.name, data.dob);
    if (!match.staffId) throw new Error(match.note);
    const personKey = personKeyOf(
      match.staffId,
      data.ni,
      data.name,
      sheet.fileHash,
      sheet.sheetLabel,
    );
    // Reserve the corrected person/month key before rechecking. A duplicate fails without changing the sheet.
    const changed = await db
      .update(timesheetSheets)
      .set({
        personKey,
        personName: data.name,
        personNi: data.ni,
        personDob: data.dob,
        staffId: null,
        matchedBy: "none",
        staffConfirmedAt: null,
        status: "staff_not_found",
      })
      .where(eq(timesheetSheets.id, data.id))
      .returning({ id: timesheetSheets.id });
    if (!changed.length) throw new Error("That sheet no longer exists.");
    const result = await recheckSheet(db, data.id);
    await recordActivity({
      actor,
      action: "updated",
      module: "timesheets",
      entityId: data.id,
      label: "Timesheet identity corrected and checked again",
      details: `Result: ${result?.status ?? "staff_not_found"}`,
    });
    return result;
  });

/* ------------------------------ accepting a difference ------------------------------ */

/** Accept one difference with a reason (approvers and admins only). */
export const acceptTimesheetRow = createServerFn({ method: "POST" })
  .validator(
    z.object({
      rowId: z.string().min(1).max(100),
      note: z.string().trim().min(3).max(500),
      actualHours: z.number().min(0).max(24),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "approve");
    const res = await acceptRow(db, {
      rowId: data.rowId,
      note: data.note,
      actualHours: data.actualHours,
      actor: { id: actor.id, name: actorName(actor) },
    });
    await recordActivity({
      actor,
      action: "updated",
      module: "timesheets",
      entityId: res.sheetId,
      label: `Timesheet difference accepted — ${formatMonthLabel(res.month)}`,
      details: `${res.label}: actual hours ${data.actualHours}. ${data.note}`,
    });
    return { ok: true };
  });

/**
 * Calculates the pay of sheets uploaded before pay existed. The screen calls it by itself
 * until nothing is left, so nobody has to press "Check again" for it.
 */
export const calculateTimesheetPay = createServerFn({ method: "POST" })
  .validator(z.object({ limit: z.number().int().min(1).max(15).default(10) }))
  .handler(async ({ data }) => {
    await requirePermission("timesheets", "edit");
    return calculateMissingPay(db, data.limit);
  });

/** Take an acceptance back, so the difference counts as an issue again. */
export const unacceptTimesheetRow = createServerFn({ method: "POST" })
  .validator(z.object({ rowId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "approve");
    const res = await unacceptRow(db, data.rowId);
    await recordActivity({
      actor,
      action: "updated",
      module: "timesheets",
      entityId: res.sheetId,
      label: `Timesheet acceptance withdrawn — ${formatMonthLabel(res.month)}`,
    });
    return { ok: true };
  });

/** Accept (or withdraw) that the sheet's own stated total differs from its rows. */
export const setTimesheetStatedAccepted = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1).max(100),
      accept: z.boolean(),
      note: z.string().trim().max(500).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "approve");
    const res = await setStatedAccepted(db, {
      sheetId: data.id,
      accept: data.accept,
      note: data.note,
      actor: { id: actor.id, name: actorName(actor) },
    });
    await recordActivity({
      actor,
      action: "updated",
      module: "timesheets",
      entityId: data.id,
      label: data.accept
        ? `Timesheet stated total accepted — ${formatMonthLabel(res.month)}`
        : `Timesheet stated-total acceptance withdrawn — ${formatMonthLabel(res.month)}`,
      details: data.accept ? data.note : "",
    });
    return { ok: true };
  });

export const timesheetMonthLock = createServerFn({ method: "GET" })
  .validator(z.object({ month }))
  .handler(async ({ data }) => {
    await requirePermission("timesheets", "view");
    const result = await db.execute(
      sql`SELECT locked, changed_by AS "changedBy", changed_at AS "changedAt" FROM timesheet_month_locks WHERE month = ${data.month}`,
    );
    const row = result.rows[0];
    return { locked: row?.["locked"] === true, changedBy: String(row?.["changedBy"] ?? "") };
  });

export const setTimesheetMonthLock = createServerFn({ method: "POST" })
  .validator(z.object({ month, locked: z.boolean() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "approve");
    // Locking is for approvers; REOPENING a locked month is for admins only.
    if (!data.locked && actor.role !== "admin") {
      throw new Response("Only an admin can reopen a locked timesheet month.", { status: 403 });
    }
    try {
      await db.execute(
        sql`SELECT set_timesheet_month_lock(${data.month}, ${data.locked}, ${actorName(actor)})`,
      );
    } catch (err) {
      // Read known business errors from the wrapped database cause; never return its SQL or parameters.
      let cause: unknown = err;
      const seen = new Set<unknown>();
      while (cause && typeof cause === "object" && !seen.has(cause)) {
        seen.add(cause);
        const e = cause as { message?: unknown; cause?: unknown };
        const message = typeof e.message === "string" ? e.message : "";
        if (message.includes("Resolve all unmatched, unconfirmed or incomplete sheets"))
          throw new Error(
            "Review unmatched staff, confirm name-only matches and resolve sheet differences before locking this month.",
          );
        if (message.includes("There are no timesheets in this month"))
          throw new Error("There are no timesheets in this month to lock.");
        if (message.includes("Review duplicate staff sheets"))
          throw new Error("Review duplicate staff sheets before locking this month.");
        cause = e.cause;
      }
      throw new Error(
        "The month could not be updated. Refresh and try again. If it continues, ask your administrator to check the timesheet setup.",
      );
    }
    await recordActivity({
      actor,
      action: "updated",
      module: "timesheets",
      label: `Timesheet month ${data.month} ${data.locked ? "locked" : "reopened"}`,
    });
    return { ok: true };
  });

/* ------------------------------ editing a shift by hand ------------------------------ */

/**
 * Edit the hours and rate of ONE row. The same figures are written to our shift record, so the
 * Salary Sheet shows them too (approvers and admins only: it changes what is paid).
 */
export const editTimesheetRow = createServerFn({ method: "POST" })
  .validator(
    z.object({
      rowId: z.string().min(1).max(100),
      hours: z.number().finite().min(0).max(24),
      rate: z.number().finite().min(0).max(1000),
      note: z.string().trim().max(500).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("timesheets", "approve");
    // The row also changes Salary Sheet figures, so the person needs that permission too.
    await requirePermission("salary", "edit");
    const res = await editRow(db, {
      rowId: data.rowId,
      hours: data.hours,
      rate: data.rate,
      note: data.note,
      actor: { id: actor.id, name: actorName(actor) },
    });
    await recordActivity({
      actor,
      action: "updated",
      module: "timesheets",
      entityId: res.sheetId,
      label: `Timesheet row edited — ${formatMonthLabel(res.month)}`,
      details: `${res.label}: ${data.hours} h at £${data.rate}. ${data.note}`.trim(),
    });
    return { ok: true, salaryUpdated: res.salaryUpdated, salaryNote: res.salaryNote };
  });

/* ------------------------------ account details and payments ------------------------------ */

export interface TimesheetPayInfo {
  staffId: string | null;
  month: string;
  account: AccountDetails | null;
  /** false = the viewer may not see bank details (Staff permission). */
  canSeeAccount: boolean;
  pay: StaffMonthPay | null;
  methods: readonly string[];
}

async function sheetOwner(sheetId: string) {
  const [sheet] = await db
    .select({ staffId: timesheetSheets.staffId, month: timesheetSheets.month })
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, sheetId))
    .limit(1);
  if (!sheet) throw new Error("That sheet no longer exists.");
  return sheet;
}

export const getTimesheetPayInfo = createServerFn({ method: "GET" })
  .validator(z.object({ sheetId: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<TimesheetPayInfo> => {
    const viewer = await requirePermission("timesheets", "view");
    const sheet = await sheetOwner(data.sheetId);
    const canSeeAccount = seesIdentity(viewer);
    if (!sheet.staffId) {
      return {
        staffId: null,
        month: sheet.month,
        account: null,
        canSeeAccount,
        pay: null,
        methods: PAYMENT_METHODS,
      };
    }
    return {
      staffId: sheet.staffId,
      month: sheet.month,
      account: canSeeAccount ? await getAccountDetails(db, sheet.staffId) : null,
      canSeeAccount,
      pay: await getStaffMonthPay(db, sheet.staffId, sheet.month),
      methods: PAYMENT_METHODS,
    };
  });

export const saveTimesheetAccount = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sheetId: z.string().min(1).max(100),
      accountHolderName: z.string().trim().max(120),
      accountNumber: z.string().trim().max(20),
      sortCode: z.string().trim().max(12),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("staff", "edit");
    await requirePermission("timesheets", "edit");
    const sheet = await sheetOwner(data.sheetId);
    if (!sheet.staffId) throw new Error("Match this sheet to a staff member first.");
    await saveAccountDetails(db, sheet.staffId, {
      accountHolderName: data.accountHolderName,
      accountNumber: data.accountNumber,
      sortCode: data.sortCode,
    });
    await recordActivity({
      actor,
      action: "updated",
      module: "staff",
      entityId: sheet.staffId,
      label: "Staff bank details updated (from Timesheet Check)",
    });
    return { ok: true };
  });

export const addTimesheetPayment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sheetId: z.string().min(1).max(100),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amount: z.number().finite().gt(0).max(10_000_000),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().trim().max(120).default(""),
      notes: z.string().trim().max(300).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    await requirePermission("timesheets", "view");
    const sheet = await sheetOwner(data.sheetId);
    if (!sheet.staffId) throw new Error("Match this sheet to a staff member first.");
    const res = await addStaffPayment(db, {
      staffId: sheet.staffId,
      month: sheet.month,
      date: data.date,
      amount: data.amount,
      method: data.method,
      reference: data.reference,
      notes: data.notes,
    });
    await recordActivity({
      actor,
      action: "created",
      module: "salary",
      entityId: res.id,
      label: `Salary payment £${data.amount.toFixed(2)} ${data.method} (${formatMonthLabel(sheet.month)}) — from Timesheet Check`,
    });
    return { ok: true };
  });

export const deleteTimesheetPayment = createServerFn({ method: "POST" })
  .validator(
    z.object({ sheetId: z.string().min(1).max(100), paymentId: z.string().min(1).max(100) }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "delete");
    await requirePermission("timesheets", "view");
    const sheet = await sheetOwner(data.sheetId);
    if (!sheet.staffId) throw new Error("Match this sheet to a staff member first.");
    await deleteStaffPayment(db, sheet.staffId, data.paymentId);
    await recordActivity({
      actor,
      action: "deleted",
      module: "salary",
      entityId: data.paymentId,
      label: `Salary payment removed (${formatMonthLabel(sheet.month)}) — from Timesheet Check`,
    });
    return { ok: true };
  });
