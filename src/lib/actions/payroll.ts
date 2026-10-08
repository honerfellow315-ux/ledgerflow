import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../server/db";
import {
  payrollCompanies,
  payrollCompanyStaff,
  payrollLines,
  payrollSheets,
  payrollStaff,
  salaryEntries,
  salaryPeriods,
  salaryShifts,
} from "../../../drizzle/schema";
import { requireAdmin, requirePermission } from "../server/auth";
import { moveStaffToTrash } from "../server/staffTrash";
import { hasPermission } from "../permissions";
import { uid } from "../server/id";
import { recordActivity, changedFieldsSummary } from "../server/activity";
import { formatMonthLabel, formatNi, normName, normNi, round2 } from "../payroll/calc";
import { lineTotals } from "../payroll/sheetCalc";
import { STAFF_DETAIL_FIELDS } from "../payroll/types";
import type { ContractStatus, PeriodStatus, Staff, StaffDetailField, StaffDetails } from "../payroll/types";
import { cleanDetail } from "../payroll/sheetImport";
import type { PayrollImportResult, PayrollImportRowResult } from "../payroll/sheetImport";
import type {
  CompanyStaffLink,
  PayrollLine,
  PayrollSheetCompany,
  PayrollSheetData,
  PayrollSheetInfo,
  PushToSalaryResult,
} from "../payroll/sheetTypes";

/* ------------------------------------------------------------------ */
/* Mappers                                                              */
/* ------------------------------------------------------------------ */

const STATUSES: PeriodStatus[] = ["draft", "reviewed", "verified", "closed"];

const toSheetInfo = (r: typeof payrollSheets.$inferSelect): PayrollSheetInfo => ({
  id: r.id,
  companyId: r.companyId,
  month: r.month,
  status: (STATUSES as string[]).includes(r.status) ? (r.status as PeriodStatus) : "draft",
  ...(r.notes ? { notes: r.notes } : {}),
});

const toLine = (r: typeof payrollLines.$inferSelect): PayrollLine => ({
  id: r.id,
  sheetId: r.sheetId,
  staffId: r.staffId,
  unitsHours: r.unitsHours,
  bankHolidayHours: r.bankHolidayHours,
  holidayEntitlement: r.holidayEntitlement,
  comment: r.comment,
  rate: r.rate,
  fixedAmount: r.fixedAmount ?? null,
  holidayRate: r.holidayRate ?? null,
});

const toLink = (r: typeof payrollCompanyStaff.$inferSelect): CompanyStaffLink => ({
  id: r.id,
  companyId: r.companyId,
  staffId: r.staffId,
  active: r.active,
  rate: r.rate,
  ...(r.startDate ? { startDate: r.startDate } : {}),
  ...(r.endDate ? { endDate: r.endDate } : {}),
  ...(r.contractStatus ? { contractStatus: r.contractStatus } : {}),
});

/**
 * Contract status and end date belong to a person's place in ONE company (someone can be on a P45
 * in company A and still working in company B). The sheet therefore shows this company's own values
 * and falls back to the staff record only when the company has none.
 */
function withCompanyStatus(
  s: Staff,
  link: typeof payrollCompanyStaff.$inferSelect | undefined,
  full: boolean,
): Staff {
  if (!link) return s;
  const out: Staff = { ...s };
  if (link.contractStatus) out.contractStatus = link.contractStatus as ContractStatus;
  if (full && link.endDate) out.employmentEndDate = link.endDate;
  return out;
}

const toCompany = (
  r: typeof payrollCompanies.$inferSelect,
  staffCount: number,
): PayrollSheetCompany => ({
  id: r.id,
  name: r.name,
  orderIndex: r.orderIndex,
  active: r.active,
  defaultRate: r.defaultRate,
  ...(r.address ? { address: r.address } : {}),
  ...(r.notes ? { notes: r.notes } : {}),
  staffCount,
});

/** Non-sensitive part of a staff record (what a payroll operator without the "staff" permission sees). */
const LIGHT_FIELDS = ["contractStatus", "role", "serviceType", "hoursAllowed", "gender"] as const;

function toPayrollStaff(r: typeof payrollStaff.$inferSelect, full: boolean): Staff {
  const base: Staff = {
    id: r.id,
    rssId: "",
    essId: "",
    extIds: {},
    ni: "",
    name: r.name,
    tag: "",
    accountDetail: "",
    area: "",
    active: r.active,
  };
  const details: StaffDetails = {};
  if (full) {
    base.rssId = r.rssId;
    base.essId = r.essId;
    base.extIds = r.extIds ?? {};
    base.ni = r.ni;
    base.tag = r.tag;
    base.accountDetail = r.accountDetail;
    base.area = r.area;
    if (r.notes) base.notes = r.notes;
    for (const k of STAFF_DETAIL_FIELDS) {
      const v = r[k];
      if (v) details[k] = v;
    }
  } else {
    for (const k of LIGHT_FIELDS) {
      const v = r[k];
      if (v) details[k] = v;
    }
  }
  return { ...base, ...details };
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/* ------------------------------------------------------------------ */
/* Guards                                                               */
/* ------------------------------------------------------------------ */

async function getSheetOrThrow(sheetId: string) {
  const [row] = await db.select().from(payrollSheets).where(eq(payrollSheets.id, sheetId)).limit(1);
  if (!row) throw new Error("This payroll sheet no longer exists.");
  return row;
}

/** Closed sheets are locked — every mutation goes through this first. */
async function assertOpen(sheetId: string) {
  const sheet = await getSheetOrThrow(sheetId);
  if (sheet.status === "closed") {
    throw new Error(
      `${formatMonthLabel(sheet.month)} is closed. Reopen it (needs approve permission) to make changes.`,
    );
  }
  return sheet;
}

async function getCompanyOrThrow(companyId: string) {
  const [row] = await db
    .select()
    .from(payrollCompanies)
    .where(eq(payrollCompanies.id, companyId))
    .limit(1);
  if (!row) throw new Error("That payroll company no longer exists.");
  return row;
}

async function sheetLabel(sheet: typeof payrollSheets.$inferSelect) {
  const company = await getCompanyOrThrow(sheet.companyId);
  return `Payroll sheet — ${company.name} (${formatMonthLabel(sheet.month)})`;
}

/* ------------------------------------------------------------------ */
/* Payroll companies                                                    */
/* ------------------------------------------------------------------ */

async function activeStaffCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ companyId: payrollCompanyStaff.companyId, n: sql<number>`count(*)::int` })
    .from(payrollCompanyStaff)
    .where(eq(payrollCompanyStaff.active, true))
    .groupBy(payrollCompanyStaff.companyId);
  return new Map(rows.map((r) => [r.companyId, Number(r.n)]));
}

/** Every payroll company (incl. archived), with its rate and active head-count. */
export const listSheetCompanies = createServerFn({ method: "POST" }).handler(async () => {
  await requirePermission("payroll", "view");
  const [rows, counts] = await Promise.all([
    db.select().from(payrollCompanies).orderBy(asc(payrollCompanies.orderIndex)),
    activeStaffCounts(),
  ]);
  return rows.map((r) => toCompany(r, counts.get(r.id) ?? 0));
});

const companyFields = {
  name: z.string().trim().min(1, "Company name is required."),
  defaultRate: z.number().min(0).max(10000),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
};

export const createSheetCompany = createServerFn({ method: "POST" })
  .validator(z.object(companyFields))
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "create");
    const all = await db.select().from(payrollCompanies);
    const dupe = all.find((c) => c.name.toLowerCase() === data.name.toLowerCase());
    if (dupe) {
      if (dupe.active) throw new Error(`"${dupe.name}" already exists.`);
      const [row] = await db
        .update(payrollCompanies)
        .set({ active: true, defaultRate: data.defaultRate })
        .where(eq(payrollCompanies.id, dupe.id))
        .returning();
      return row ? toCompany(row, 0) : undefined;
    }
    const orderIndex = all.reduce((m, c) => Math.max(m, c.orderIndex), -1) + 1;
    const [row] = await db
      .insert(payrollCompanies)
      .values({
        id: uid("pc"),
        name: data.name,
        orderIndex,
        defaultRate: data.defaultRate,
        address: data.address || null,
        notes: data.notes || null,
      })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "payroll",
        entityId: row.id,
        label: `Payroll company — ${row.name}`,
      });
    }
    return row ? toCompany(row, 0) : undefined;
  });

export const updateSheetCompany = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      patch: z
        .object({
          name: companyFields.name,
          defaultRate: companyFields.defaultRate,
          address: z.string().trim().max(500),
          notes: z.string().trim().max(1000),
          active: z.boolean(),
        })
        .partial(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "edit");
    const { address, notes, ...rest } = data.patch;
    if (rest.name) {
      const all = await db.select().from(payrollCompanies);
      const dupe = all.find(
        (c) => c.id !== data.id && c.name.toLowerCase() === rest.name?.toLowerCase(),
      );
      if (dupe) throw new Error(`"${dupe.name}" already exists.`);
    }
    const [row] = await db
      .update(payrollCompanies)
      .set({
        ...rest,
        ...(address !== undefined ? { address: address || null } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
      })
      .where(eq(payrollCompanies.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "payroll",
        entityId: row.id,
        label: `Payroll company — ${row.name}`,
        details: changedFieldsSummary(data.patch),
      });
    }
    const counts = await activeStaffCounts();
    return row ? toCompany(row, counts.get(row.id) ?? 0) : undefined;
  });

/* ------------------------------------------------------------------ */
/* Sheets (company x month)                                             */
/* ------------------------------------------------------------------ */

export interface PayrollSheetListItem extends PayrollSheetInfo {
  lines: number;
  totalHours: number;
  amount: number;
}

export const listPayrollSheets = createServerFn({ method: "POST" })
  .validator(z.object({ companyId: z.string() }))
  .handler(async ({ data }): Promise<PayrollSheetListItem[]> => {
    await requirePermission("payroll", "view");
    const res = await db.execute(sql`
      SELECT s.id, s.company_id, s.month, s.status, s.notes,
             count(l.id)::int AS lines,
             COALESCE(sum(l.units_hours + l.bank_holiday_hours), 0)::float AS total_hours,
             COALESCE(sum(COALESCE(l.fixed_amount, round((l.units_hours + l.bank_holiday_hours) * l.rate + CASE WHEN l.holiday_rate IS NULL THEN 0 ELSE l.holiday_entitlement * l.holiday_rate END, 2))), 0)::float AS amount
      FROM payroll_sheets s LEFT JOIN payroll_lines l ON l.sheet_id = s.id
      WHERE s.company_id = ${data.companyId}
      GROUP BY s.id ORDER BY s.month DESC`);
    return (
      res.rows as {
        id: string;
        company_id: string;
        month: string;
        status: string;
        notes: string | null;
        lines: number;
        total_hours: number;
        amount: number;
      }[]
    ).map((r) => ({
      ...toSheetInfo({
        id: r.id,
        companyId: r.company_id,
        month: r.month,
        status: r.status,
        notes: r.notes,
        closedAt: null,
        createdAt: new Date(),
      }),
      lines: Number(r.lines),
      totalHours: round2(Number(r.total_hours)),
      amount: round2(Number(r.amount)),
    }));
  });

/**
 * Starts a month for a company. With `copyStaff` every ACTIVE member of the company comes
 * across with 0 hours and their rate; people on a P45, inactive staff and members whose end
 * date is before this month are left out (their history stays on the older sheets).
 */
export const createPayrollSheet = createServerFn({ method: "POST" })
  .validator(
    z.object({ companyId: z.string(), month: monthSchema, copyStaff: z.boolean().default(true) }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "create");
    const company = await getCompanyOrThrow(data.companyId);
    const [existing] = await db
      .select()
      .from(payrollSheets)
      .where(and(eq(payrollSheets.companyId, data.companyId), eq(payrollSheets.month, data.month)))
      .limit(1);
    if (existing)
      throw new Error(`${company.name} already has a sheet for ${formatMonthLabel(data.month)}.`);

    const [sheet] = await db
      .insert(payrollSheets)
      .values({ id: uid("ps"), companyId: data.companyId, month: data.month })
      .returning();
    if (!sheet) throw new Error("Could not create the sheet.");

    let copied = 0;
    if (data.copyStaff) {
      const members = await db
        .select({ link: payrollCompanyStaff, staff: payrollStaff })
        .from(payrollCompanyStaff)
        .innerJoin(payrollStaff, eq(payrollStaff.id, payrollCompanyStaff.staffId))
        .where(
          and(
            eq(payrollCompanyStaff.companyId, data.companyId),
            eq(payrollCompanyStaff.active, true),
            eq(payrollStaff.active, true),
          ),
        );
      // Fixed-pay staff (no hours, a typed monthly amount) keep their amount into the new month.
      const fixedByStaff = new Map<string, number>();
      const [prev] = await db
        .select()
        .from(payrollSheets)
        .where(and(eq(payrollSheets.companyId, data.companyId), lt(payrollSheets.month, data.month)))
        .orderBy(desc(payrollSheets.month))
        .limit(1);
      if (prev) {
        const prevLines = await db
          .select()
          .from(payrollLines)
          .where(eq(payrollLines.sheetId, prev.id));
        for (const l of prevLines) {
          if (l.fixedAmount != null && lineTotals(l).totalHours === 0)
            fixedByStaff.set(l.staffId, l.fixedAmount);
        }
      }
      const eligible = members.filter(
        ({ link, staff }) =>
          (link.contractStatus ?? staff.contractStatus) !== "P45" &&
          !(link.endDate && link.endDate.slice(0, 7) < data.month),
      );
      for (const part of chunk(eligible, 500)) {
        await db
          .insert(payrollLines)
          .values(
            part.map(({ link, staff }) => ({
              id: uid("pl"),
              sheetId: sheet.id,
              staffId: staff.id,
              rate: link.rate ?? company.defaultRate,
              fixedAmount: fixedByStaff.get(staff.id) ?? null,
            })),
          )
          .onConflictDoNothing();
      }
      copied = eligible.length;
    }
    await recordActivity({
      actor,
      action: "created",
      module: "payroll",
      entityId: sheet.id,
      label: `Payroll sheet — ${company.name} (${formatMonthLabel(sheet.month)})`,
      details: data.copyStaff ? `${copied} active staff copied` : undefined,
    });
    return toSheetInfo(sheet);
  });

export const getPayrollSheet = createServerFn({ method: "POST" })
  .validator(z.object({ sheetId: z.string() }))
  .handler(async ({ data }): Promise<PayrollSheetData> => {
    const user = await requirePermission("payroll", "view");
    const full = hasPermission(user.role, user.permissions, "staff", "view");
    const sheet = await getSheetOrThrow(data.sheetId);
    const company = await getCompanyOrThrow(sheet.companyId);
    const [lines, links, counts] = await Promise.all([
      db.select().from(payrollLines).where(eq(payrollLines.sheetId, sheet.id)),
      db.select().from(payrollCompanyStaff).where(eq(payrollCompanyStaff.companyId, company.id)),
      activeStaffCounts(),
    ]);
    const ids = [...new Set([...lines.map((l) => l.staffId), ...links.map((l) => l.staffId)])];
    const staffRows: (typeof payrollStaff.$inferSelect)[] = [];
    for (const part of chunk(ids, 500)) {
      staffRows.push(
        ...(await db.select().from(payrollStaff).where(inArray(payrollStaff.id, part))),
      );
    }
    staffRows.sort((a, b) => a.name.localeCompare(b.name));
    return {
      sheet: toSheetInfo(sheet),
      company: toCompany(company, counts.get(company.id) ?? 0),
      lines: lines.map(toLine),
      staff: staffRows.map((r) =>
        withCompanyStatus(
          toPayrollStaff(r, full),
          links.find((l) => l.staffId === r.id),
          full,
        ),
      ),
      links: links.map(toLink),
      canSeeStaffDetails: full,
    };
  });

/**
 * People who exist ONLY on this sheet: on no other payroll sheet, in no other company, and with no
 * Salary Sheet line or shift. These are the ones a mistaken import leaves behind.
 */
async function staffOnlyOnSheet(sheetId: string, companyId: string): Promise<{ id: string; name: string }[]> {
  const lines = await db
    .select({ staffId: payrollLines.staffId })
    .from(payrollLines)
    .where(eq(payrollLines.sheetId, sheetId));
  const ids = [...new Set(lines.map((l) => l.staffId))];
  const out: { id: string; name: string }[] = [];
  for (const part of chunk(ids, 300)) {
    const [elsewhere, entries, shifts, links, rows] = await Promise.all([
      db
        .select({ id: payrollLines.staffId })
        .from(payrollLines)
        .where(and(inArray(payrollLines.staffId, part), ne(payrollLines.sheetId, sheetId))),
      db.select({ id: salaryEntries.staffId }).from(salaryEntries).where(inArray(salaryEntries.staffId, part)),
      db.select({ id: salaryShifts.staffId }).from(salaryShifts).where(inArray(salaryShifts.staffId, part)),
      db
        .select({ id: payrollCompanyStaff.staffId })
        .from(payrollCompanyStaff)
        .where(and(inArray(payrollCompanyStaff.staffId, part), ne(payrollCompanyStaff.companyId, companyId))),
      db.select({ id: payrollStaff.id, name: payrollStaff.name }).from(payrollStaff).where(inArray(payrollStaff.id, part)),
    ]);
    const used = new Set([...elsewhere, ...entries, ...shifts, ...links].map((r) => r.id));
    for (const r of rows) if (!used.has(r.id)) out.push(r);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read-only: the people the delete dialog offers to remove together with the sheet. */
export const previewSheetStaffCleanup = createServerFn({ method: "POST" })
  .validator(z.object({ sheetId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requirePermission("payroll", "delete");
    const sheet = await getSheetOrThrow(data.sheetId);
    return {
      people: await staffOnlyOnSheet(sheet.id, sheet.companyId),
      canRemove: user.role === "admin",
    };
  });

export const deletePayrollSheet = createServerFn({ method: "POST" })
  .validator(
    z.object({ sheetId: z.string(), alsoRemoveStaffIds: z.array(z.string()).max(5000).optional() }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "delete");
    const sheet = await assertOpen(data.sheetId);
    const label = await sheetLabel(sheet);

    // Removing people is admin-only (same as the Staff screen) and re-checked here, so a stale
    // list can never delete someone who has since been used elsewhere.
    let toRemove: string[] = [];
    if (data.alsoRemoveStaffIds?.length) {
      await requireAdmin();
      const allowed = new Set((await staffOnlyOnSheet(sheet.id, sheet.companyId)).map((p) => p.id));
      toRemove = data.alsoRemoveStaffIds.filter((id) => allowed.has(id));
    }

    await db.delete(payrollSheets).where(eq(payrollSheets.id, sheet.id));
    let removed = 0;
    if (toRemove.length > 0) {
      removed = (await moveStaffToTrash(toRemove, actor.username)).deleted;
    }
    await recordActivity({
      actor,
      action: "deleted",
      module: "payroll",
      entityId: sheet.id,
      label,
      ...(removed > 0 ? { details: `${removed} staff only on this sheet moved to the Recycle Bin` } : {}),
    });
    return { ok: true, removedStaff: removed };
  });

const NEXT_OK: Record<PeriodStatus, PeriodStatus[]> = {
  draft: ["reviewed"],
  reviewed: ["draft", "verified"],
  verified: ["reviewed", "closed"],
  closed: ["verified"],
};

export const setPayrollSheetStatus = createServerFn({ method: "POST" })
  .validator(
    z.object({ sheetId: z.string(), status: z.enum(["draft", "reviewed", "verified", "closed"]) }),
  )
  .handler(async ({ data }) => {
    const sheet = await getSheetOrThrow(data.sheetId);
    const from = toSheetInfo(sheet).status;
    if (from === data.status) return toSheetInfo(sheet);
    // verify / close / reopen are the sensitive steps -> "approve"; draft <-> reviewed is plain editing
    const sensitive = [from, data.status].some((s) => s === "verified" || s === "closed");
    const actor = await requirePermission("payroll", sensitive ? "approve" : "edit");
    if (!NEXT_OK[from].includes(data.status))
      throw new Error(`A ${from} sheet can't go straight to ${data.status}.`);
    const [row] = await db
      .update(payrollSheets)
      .set({ status: data.status, closedAt: data.status === "closed" ? new Date() : null })
      .where(eq(payrollSheets.id, sheet.id))
      .returning();
    await recordActivity({
      actor,
      action: "updated",
      module: "payroll",
      entityId: sheet.id,
      label: await sheetLabel(sheet),
      details: `Status: ${from} → ${data.status}`,
    });
    return toSheetInfo(row ?? sheet);
  });

/* ------------------------------------------------------------------ */
/* Lines                                                                */
/* ------------------------------------------------------------------ */

const hoursNum = z.number().min(0).max(100000);

const linePatch = z
  .object({
    unitsHours: hoursNum,
    bankHolidayHours: hoursNum,
    holidayEntitlement: hoursNum,
    comment: z.string().trim().max(200),
    rate: z.number().min(0).max(10000),
    fixedAmount: z.number().min(0).max(1000000).nullable(),
    holidayRate: z.number().min(0).max(10000).nullable(),
  })
  .partial();

export const updatePayrollLine = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: linePatch }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "edit");
    const [cur] = await db.select().from(payrollLines).where(eq(payrollLines.id, data.id)).limit(1);
    if (!cur) throw new Error("This payroll line no longer exists.");
    const sheet = await assertOpen(cur.sheetId);
    const [row] = await db
      .update(payrollLines)
      .set(data.patch)
      .where(eq(payrollLines.id, data.id))
      .returning();
    if (row) {
      const [staff] = await db
        .select()
        .from(payrollStaff)
        .where(eq(payrollStaff.id, row.staffId))
        .limit(1);
      await recordActivity({
        actor,
        action: "updated",
        module: "payroll",
        entityId: row.id,
        label: `${await sheetLabel(sheet)} — ${staff?.name ?? row.staffId}`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row ? toLine(row) : undefined;
  });

export const deletePayrollLine = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "delete");
    const [cur] = await db.select().from(payrollLines).where(eq(payrollLines.id, data.id)).limit(1);
    if (!cur) return { ok: true };
    const sheet = await assertOpen(cur.sheetId);
    const [staff] = await db
      .select()
      .from(payrollStaff)
      .where(eq(payrollStaff.id, cur.staffId))
      .limit(1);
    await db.delete(payrollLines).where(eq(payrollLines.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "payroll",
      entityId: cur.id,
      label: `${await sheetLabel(sheet)} — ${staff?.name ?? cur.staffId}`,
    });
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Staff <-> company                                                    */
/* ------------------------------------------------------------------ */

export interface AssignableStaff {
  id: string;
  name: string;
  active: boolean;
  contractStatus?: string;
  /** Other payroll companies this person is already in. */
  alsoIn: string[];
}

/** Staff who are not yet on this sheet (for the "Add existing staff" picker). Name + status only. */
export const listAssignableStaff = createServerFn({ method: "POST" })
  .validator(z.object({ sheetId: z.string() }))
  .handler(async ({ data }): Promise<AssignableStaff[]> => {
    await requirePermission("payroll", "edit");
    const sheet = await getSheetOrThrow(data.sheetId);
    const [all, onSheet, links, companies] = await Promise.all([
      db.select().from(payrollStaff).orderBy(asc(payrollStaff.name)),
      db
        .select({ staffId: payrollLines.staffId })
        .from(payrollLines)
        .where(eq(payrollLines.sheetId, sheet.id)),
      db.select().from(payrollCompanyStaff).where(eq(payrollCompanyStaff.active, true)),
      db.select().from(payrollCompanies),
    ]);
    const skip = new Set(onSheet.map((r) => r.staffId));
    const cname = new Map(companies.map((c) => [c.id, c.name]));
    const also = new Map<string, string[]>();
    for (const l of links) {
      if (l.companyId === sheet.companyId) continue;
      const nm = cname.get(l.companyId);
      if (nm) also.set(l.staffId, [...(also.get(l.staffId) ?? []), nm]);
    }
    return all
      .filter((s) => !skip.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        active: s.active,
        ...(s.contractStatus ? { contractStatus: s.contractStatus } : {}),
        alsoIn: also.get(s.id) ?? [],
      }));
  });

/** Adds a person to the company (if not already) and puts a line for them on the sheet. */
export const addStaffToSheet = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sheetId: z.string(),
      staffId: z.string(),
      comment: z.string().trim().max(200).optional(),
      rate: z.number().min(0).max(10000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "edit");
    const sheet = await assertOpen(data.sheetId);
    const company = await getCompanyOrThrow(sheet.companyId);
    const [staff] = await db
      .select()
      .from(payrollStaff)
      .where(eq(payrollStaff.id, data.staffId))
      .limit(1);
    if (!staff) throw new Error("That staff member no longer exists.");

    const [link] = await db
      .insert(payrollCompanyStaff)
      .values({
        id: uid("pcs"),
        companyId: company.id,
        staffId: staff.id,
        rate: data.rate ?? null,
        contractStatus: "Active",
        startDate: staff.employmentStartDate ?? null,
      })
      .onConflictDoUpdate({
        target: [payrollCompanyStaff.companyId, payrollCompanyStaff.staffId],
        set: {
          active: true,
          endDate: null,
          contractStatus: "Active",
          ...(data.rate !== undefined ? { rate: data.rate } : {}),
        },
      })
      .returning();

    const [row] = await db
      .insert(payrollLines)
      .values({
        id: uid("pl"),
        sheetId: sheet.id,
        staffId: staff.id,
        rate: link?.rate ?? company.defaultRate,
        comment: data.comment ?? "",
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "payroll",
        entityId: row.id,
        label: `${await sheetLabel(sheet)} — ${staff.name}`,
      });
    }
    return row ? toLine(row) : undefined;
  });

/**
 * Company-level settings for one person: active in this company, own rate, start/end date.
 * `applyToSheetId` also applies the new rate to that (open) sheet's line; `removeFromSheetId`
 * drops the person's line from that (open) sheet when they have no hours on it.
 */
export const updateCompanyStaff = createServerFn({ method: "POST" })
  .validator(
    z.object({
      companyId: z.string(),
      staffId: z.string(),
      patch: z
        .object({
          active: z.boolean(),
          rate: z.number().min(0).max(10000).nullable(),
          startDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          endDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          contractStatus: z.enum(["Active", "Need P45", "P45"]).nullable(),
        })
        .partial(),
      applyToSheetId: z.string().optional(),
      removeFromSheetId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "edit");
    // contract status sits with the sensitive staff data, so it needs the same access as before
    if (data.patch.contractStatus !== undefined) await requirePermission("staff", "edit");
    const company = await getCompanyOrThrow(data.companyId);
    const [staff] = await db
      .select()
      .from(payrollStaff)
      .where(eq(payrollStaff.id, data.staffId))
      .limit(1);
    if (!staff) throw new Error("That staff member no longer exists.");
    const [row] = await db
      .update(payrollCompanyStaff)
      .set(data.patch)
      .where(
        and(
          eq(payrollCompanyStaff.companyId, data.companyId),
          eq(payrollCompanyStaff.staffId, data.staffId),
        ),
      )
      .returning();
    if (!row) throw new Error(`${staff.name} is not in ${company.name}.`);

    if (data.applyToSheetId && data.patch.rate !== undefined) {
      const sheet = await assertOpen(data.applyToSheetId);
      await db
        .update(payrollLines)
        .set({ rate: data.patch.rate ?? company.defaultRate })
        .where(and(eq(payrollLines.sheetId, sheet.id), eq(payrollLines.staffId, data.staffId)));
    }
    let removed = false;
    if (data.removeFromSheetId) {
      const sheet = await assertOpen(data.removeFromSheetId);
      const [line] = await db
        .select()
        .from(payrollLines)
        .where(and(eq(payrollLines.sheetId, sheet.id), eq(payrollLines.staffId, data.staffId)))
        .limit(1);
      if (line && lineTotals(line).totalHours === 0) {
        await db.delete(payrollLines).where(eq(payrollLines.id, line.id));
        removed = true;
      }
    }
    await recordActivity({
      actor,
      action: "updated",
      module: "payroll",
      entityId: row.id,
      label: `Payroll staff — ${staff.name} (${company.name})`,
      details:
        `${changedFieldsSummary(data.patch) ?? ""}${removed ? " · removed from open sheet" : ""}`.trim() ||
        undefined,
    });
    return toLink(row);
  });

/* ------------------------------------------------------------------ */
/* Link to the Salary Sheet                                             */
/* ------------------------------------------------------------------ */

/**
 * Writes this sheet's amounts into the Salary Sheet's payroll column for the same month
 * (salary_entries.payroll[companyId]). The same person is matched by staff id, so nothing
 * can attach to the wrong row. It REPLACES that company's column for the month, so pushing
 * again after a correction just updates the figure. A missing Salary month is created.
 */
export const pushToSalarySheet = createServerFn({ method: "POST" })
  .validator(z.object({ sheetId: z.string() }))
  .handler(async ({ data }): Promise<PushToSalaryResult> => {
    const actor = await requirePermission("payroll", "approve");
    await requirePermission("salary", "edit");
    const sheet = await getSheetOrThrow(data.sheetId);
    const company = await getCompanyOrThrow(sheet.companyId);

    let [period] = await db
      .select()
      .from(salaryPeriods)
      .where(eq(salaryPeriods.month, sheet.month))
      .limit(1);
    let createdPeriod = false;
    if (!period) {
      await requirePermission("salary", "create");
      [period] = await db
        .insert(salaryPeriods)
        .values({ id: uid("sp"), month: sheet.month })
        .returning();
      createdPeriod = true;
    }
    if (!period) throw new Error("Could not open the Salary Sheet month.");
    if (period.status === "closed")
      throw new Error(
        `The Salary Sheet for ${formatMonthLabel(sheet.month)} is closed. Reopen it first.`,
      );

    const lines = await db.select().from(payrollLines).where(eq(payrollLines.sheetId, sheet.id));
    const amounts = lines.map((l) => ({ staffId: l.staffId, amount: lineTotals(l).amount }));
    const toPush = amounts.filter((a) => a.amount !== 0);
    // a person whose figure dropped to 0 must be reset too, if they already have a salary line
    const zeroIds = amounts.filter((a) => a.amount === 0).map((a) => a.staffId);

    for (const part of chunk(toPush, 500)) {
      await db
        .insert(salaryEntries)
        .values(part.map((a) => ({ id: uid("se"), periodId: period.id, staffId: a.staffId })))
        .onConflictDoNothing();
    }
    const all = [...toPush, ...zeroIds.map((staffId) => ({ staffId, amount: 0 }))];
    for (const part of chunk(all, 500)) {
      const list = sql.join(
        part.map((a) => sql`(${a.staffId}::text, ${a.amount}::numeric)`),
        sql`, `,
      );
      await db.execute(sql`
        UPDATE salary_entries e SET
          payroll = e.payroll || jsonb_build_object(${company.id}::text, v.amt)
        FROM (VALUES ${list}) AS v(staff_id, amt)
        WHERE e.period_id = ${period.id} AND e.staff_id = v.staff_id`);
    }

    await recordActivity({
      actor,
      action: "updated",
      module: "payroll",
      entityId: sheet.id,
      label: `${await sheetLabel(sheet)}`,
      details: `Pushed to Salary Sheet: ${toPush.length} staff${createdPeriod ? " (month created)" : ""}`,
    });
    return {
      month: sheet.month,
      createdPeriod,
      updated: toPush.length,
      skipped: zeroIds.length,
    };
  });


/* ------------------------------------------------------------------ */
/* Excel import ("All Payroll Format" file -> this sheet)               */
/* ------------------------------------------------------------------ */

const importDetailText = z.string().max(300).optional();
const importHours = z.number().min(0).max(100000).nullable();

const importRow = z.object({
  name: z.string().trim().min(1).max(300),
  ni: z.string().max(60),
  unitsHours: importHours,
  bankHolidayHours: importHours,
  holidayEntitlement: importHours,
  comment: z.string().trim().max(200),
  rate: z.number().min(0).max(10000).nullable(),
  fixedAmount: z.number().min(0).max(1000000).nullable().optional(),
  holidayRate: z.number().min(0).max(10000).nullable().optional(),
  dob: importDetailText,
  gender: importDetailText,
  rtwShareCode: importDetailText,
  shareCodeExpiry: importDetailText,
  address: importDetailText,
  town: importDetailText,
  postCode: importDetailText,
  uniform: importDetailText,
  accountHolderName: importDetailText,
  accountNumber: importDetailText,
  sortCode: importDetailText,
  employmentStartDate: importDetailText,
  employmentEndDate: importDetailText,
  contractStatus: importDetailText,
  email: importDetailText,
  immigrationStatus: importDetailText,
  hoursAllowed: importDetailText,
  siaNumber: importDetailText,
  role: importDetailText,
  serviceType: importDetailText,
});

/**
 * Imports an "All Payroll Format" file into ONE open payroll sheet.
 *
 *  - People are matched by NI number first (spaces / case ignored), then by a UNIQUE name
 *    (refused when both sides have an NI and the two differ).
 *  - Not found: a new staff record is created (only with createMissing + "staff" create permission).
 *  - Hours / comment / rate / holiday entitlement go onto the person's line for this sheet. A line that
 *    is already there is updated only with updateExisting, and only with the values the file really has.
 *  - fillDetails (needs "staff" edit permission) fills EMPTY staff detail fields only, never overwrites.
 *  - Someone who already has a link to this company is left untouched (so importing an old month can't
 *    re-activate people who have since left).
 *  - Total Hours and Amount are never imported: they are always recomputed (Total = Units + Bank
 *    Holiday, Amount = Rate x Total + paid holiday). The one exception is a fixed-pay line (Rate 0 +
 *    typed Amount in the file): its fixed amount is stored and used as the Amount.
 * `apply: false` is the preview: it reads and reports, writes nothing.
 */
export const importPayrollSheet = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sheetId: z.string(),
      apply: z.boolean(),
      createMissing: z.boolean(),
      updateExisting: z.boolean(),
      fillDetails: z.boolean(),
      rows: z.array(importRow).max(1500),
    }),
  )
  .handler(async ({ data }): Promise<PayrollImportResult> => {
    const actor = await requirePermission("payroll", "edit");
    const sheet = await assertOpen(data.sheetId);
    const company = await getCompanyOrThrow(sheet.companyId);
    const canCreate =
      data.createMissing && hasPermission(actor.role, actor.permissions, "staff", "create");
    const canFill =
      data.fillDetails && hasPermission(actor.role, actor.permissions, "staff", "edit");

    const [staffRows, links, lines] = await Promise.all([
      db.select().from(payrollStaff),
      db.select().from(payrollCompanyStaff).where(eq(payrollCompanyStaff.companyId, company.id)),
      db.select().from(payrollLines).where(eq(payrollLines.sheetId, sheet.id)),
    ]);
    type StaffRow = (typeof staffRows)[number];
    const byNi = new Map<string, StaffRow>();
    const byName = new Map<string, StaffRow[]>();
    for (const st of staffRows) {
      const ni = normNi(st.ni);
      if (ni && !byNi.has(ni)) byNi.set(ni, st);
      const nm = normName(st.name);
      if (nm) byName.set(nm, [...(byName.get(nm) ?? []), st]);
    }
    const linkByStaff = new Map(links.map((l) => [l.staffId, l]));
    const lineByStaff = new Map(lines.map((l) => [l.staffId, l]));

    const out: PayrollImportRowResult[] = [];
    const totals = {
      added: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      created: 0,
      filledStaff: 0,
      filledFields: 0,
      noRate: 0,
      writtenHours: 0,
      writtenAmount: 0,
    };
    let applied = 0;

    for (const row of data.rows) {
      const fileNi = normNi(row.ni);
      let person: StaffRow | undefined;
      let match: PayrollImportRowResult["match"] = "notFound";
      if (fileNi && byNi.has(fileNi)) {
        person = byNi.get(fileNi);
        match = "matched";
      } else {
        const named = byName.get(normName(row.name)) ?? [];
        if (named.length > 1) match = "ambiguous";
        else if (named.length === 1) {
          const cand = named[0]!;
          if (fileNi && normNi(cand.ni) && normNi(cand.ni) !== fileNi) match = "niConflict";
          else {
            person = cand;
            match = "matched";
          }
        }
      }

      const blank = (m: PayrollImportRowResult["match"]): PayrollImportRowResult => ({
        name: row.name,
        match: m,
        line: "none",
        fills: 0,
        unitsHours: 0,
        bankHolidayHours: 0,
        totalHours: 0,
        rate: 0,
        amount: 0,
      });

      const willCreate = !person && match === "notFound" && canCreate;
      if (!person && !willCreate) {
        out.push(blank(match));
        continue;
      }

      // ---- the line this person gets on the sheet ----
      const existing = person ? lineByStaff.get(person.id) : undefined;
      const link = person ? linkByStaff.get(person.id) : undefined;
      const fileUnits = row.unitsHours;
      const fileBh = row.bankHolidayHours;
      let action: PayrollImportRowResult["line"];
      let units: number;
      let bh: number;
      let entitlement: number;
      let comment: string;
      let rate: number;
      let fixed: number | null;
      let holidayRate: number | null;
      if (existing) {
        units = fileUnits ?? existing.unitsHours;
        bh = fileBh ?? existing.bankHolidayHours;
        entitlement = row.holidayEntitlement ?? existing.holidayEntitlement;
        comment = row.comment || existing.comment;
        rate = row.rate ?? existing.rate;
        // a file row with hours is an hourly line; a file row without hours may be a fixed-pay line
        fixed = row.fixedAmount ?? (fileUnits !== null || fileBh !== null ? null : existing.fixedAmount);
        holidayRate = row.holidayRate ?? existing.holidayRate;
        if (!data.updateExisting) {
          action = "skip";
          units = existing.unitsHours;
          bh = existing.bankHolidayHours;
          entitlement = existing.holidayEntitlement;
          comment = existing.comment;
          rate = existing.rate;
          fixed = existing.fixedAmount;
          holidayRate = existing.holidayRate;
        } else if (
          units === existing.unitsHours &&
          bh === existing.bankHolidayHours &&
          entitlement === existing.holidayEntitlement &&
          comment === existing.comment &&
          rate === existing.rate &&
          fixed === existing.fixedAmount &&
          holidayRate === existing.holidayRate
        ) {
          action = "unchanged";
        } else action = "update";
      } else {
        action = "add";
        units = fileUnits ?? 0;
        bh = fileBh ?? 0;
        entitlement = row.holidayEntitlement ?? 0;
        comment = row.comment;
        rate = row.rate ?? link?.rate ?? company.defaultRate;
        fixed = row.fixedAmount ?? null;
        holidayRate = row.holidayRate ?? null;
      }
      const { totalHours, amount } = lineTotals({
        unitsHours: units,
        bankHolidayHours: bh,
        holidayEntitlement: entitlement,
        rate,
        fixedAmount: fixed,
        holidayRate,
      });

      // ---- detail fields that fill empty slots on an existing staff record ----
      const fills: Partial<Record<StaffDetailField, string>> = {};
      if (person && canFill) {
        for (const f of STAFF_DETAIL_FIELDS) {
          if (f === "contractStatus" || f === "employmentEndDate") continue; // per company
          const value = cleanDetail(f, row[f]);
          if (value && !person[f]) fills[f] = value;
        }
      }
      const fillKeys = Object.keys(fills) as StaffDetailField[];

      if (action === "add" || action === "update") {
        totals[action === "add" ? "added" : "updated"]++;
        totals.writtenHours = round2(totals.writtenHours + totalHours);
        totals.writtenAmount = round2(totals.writtenAmount + amount);
        if (rate === 0 && fixed === null) totals.noRate++;
      } else if (action === "unchanged") totals.unchanged++;
      else totals.skipped++;
      if (willCreate) totals.created++;
      if (fillKeys.length > 0) {
        totals.filledStaff++;
        totals.filledFields += fillKeys.length;
      }

      out.push({
        name: row.name,
        match: willCreate ? "new" : "matched",
        line: action,
        fills: fillKeys.length,
        unitsHours: units,
        bankHolidayHours: bh,
        totalHours,
        rate,
        amount,
      });

      if (!data.apply) continue;

      // ---------------------------- write ----------------------------
      let staff = person;
      if (!staff) {
        const details: Record<string, string> = {};
        for (const f of STAFF_DETAIL_FIELDS) {
          if (f === "contractStatus" || f === "employmentEndDate") continue; // stored on the company link
          const value = cleanDetail(f, row[f]);
          if (value) details[f] = value;
        }
        const [created] = await db
          .insert(payrollStaff)
          .values({
            id: uid("st"),
            name: row.name,
            ni: formatNi(row.ni),
            ...details,
          } as typeof payrollStaff.$inferInsert)
          .returning();
        if (!created) continue;
        staff = created;
        // later rows can't match it twice, but keep the maps honest
        const key = normNi(created.ni);
        if (key) byNi.set(key, created);
      }

      if (!linkByStaff.has(staff.id)) {
        const rowStatus = cleanDetail("contractStatus", row.contractStatus);
        const linkStatus = (rowStatus || "Active") as ContractStatus;
        const ended = linkStatus === "P45";
        const endDate = cleanDetail("employmentEndDate", row.employmentEndDate ?? staff.employmentEndDate ?? "");
        const [newLink] = await db
          .insert(payrollCompanyStaff)
          .values({
            id: uid("pcs"),
            companyId: company.id,
            staffId: staff.id,
            active: !ended,
            rate: null,
            contractStatus: linkStatus,
            startDate: staff.employmentStartDate || cleanDetail("employmentStartDate", row.employmentStartDate) || null,
            endDate: linkStatus === "Active" ? null : endDate || null,
          })
          .onConflictDoNothing()
          .returning();
        if (newLink) linkByStaff.set(staff.id, newLink);
      }

      if (action === "add") {
        await db
          .insert(payrollLines)
          .values({
            id: uid("pl"),
            sheetId: sheet.id,
            staffId: staff.id,
            unitsHours: units,
            bankHolidayHours: bh,
            holidayEntitlement: entitlement,
            comment,
            rate,
            fixedAmount: fixed,
            holidayRate,
          })
          .onConflictDoNothing();
      } else if (action === "update" && existing) {
        await db
          .update(payrollLines)
          .set({
            unitsHours: units,
            bankHolidayHours: bh,
            holidayEntitlement: entitlement,
            comment,
            rate,
            fixedAmount: fixed,
            holidayRate,
          })
          .where(eq(payrollLines.id, existing.id));
      }

      if (fillKeys.length > 0 && person) {
        const set: Record<string, unknown> = {};
        for (const [f, v] of Object.entries(fills)) {
          const column = payrollStaff[f as StaffDetailField];
          // keeps any value that is already there, so two imports at once can't overwrite anything
          set[f] = sql`CASE WHEN ${column} IS NULL OR ${column} = '' THEN ${v}::text ELSE ${column} END`;
        }
        await db
          .update(payrollStaff)
          .set(set as PgUpdateSetSource<typeof payrollStaff>)
          .where(eq(payrollStaff.id, person.id));
      }
      applied++;
    }

    if (data.apply && applied > 0) {
      await recordActivity({
        actor,
        action: "updated",
        module: "payroll",
        entityId: sheet.id,
        label: `${await sheetLabel(sheet)} — Excel import`,
        // counts only — never names, NI or bank values
        details: `${totals.added} added, ${totals.updated} updated, ${totals.created} new staff, ${totals.filledFields} empty staff fields filled`,
      });
    }

    return { rows: out, ...totals };
  });