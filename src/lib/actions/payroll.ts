import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
} from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { hasPermission } from "../permissions";
import { uid } from "../server/id";
import { recordActivity, changedFieldsSummary } from "../server/activity";
import { formatMonthLabel, round2 } from "../payroll/calc";
import { lineTotals } from "../payroll/sheetCalc";
import { STAFF_DETAIL_FIELDS } from "../payroll/types";
import type { PeriodStatus, Staff, StaffDetails } from "../payroll/types";
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
});

const toLink = (r: typeof payrollCompanyStaff.$inferSelect): CompanyStaffLink => ({
  id: r.id,
  companyId: r.companyId,
  staffId: r.staffId,
  active: r.active,
  rate: r.rate,
  ...(r.startDate ? { startDate: r.startDate } : {}),
  ...(r.endDate ? { endDate: r.endDate } : {}),
});

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
             COALESCE(sum(round((l.units_hours + l.bank_holiday_hours) * l.rate, 2)), 0)::float AS amount
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
      const eligible = members.filter(
        ({ link, staff }) =>
          staff.contractStatus !== "P45" &&
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
      staff: staffRows.map((r) => toPayrollStaff(r, full)),
      links: links.map(toLink),
      canSeeStaffDetails: full,
    };
  });

export const deletePayrollSheet = createServerFn({ method: "POST" })
  .validator(z.object({ sheetId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "delete");
    const sheet = await assertOpen(data.sheetId);
    const label = await sheetLabel(sheet);
    await db.delete(payrollSheets).where(eq(payrollSheets.id, sheet.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "payroll",
      entityId: sheet.id,
      label,
    });
    return { ok: true };
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
        startDate: staff.employmentStartDate ?? null,
      })
      .onConflictDoUpdate({
        target: [payrollCompanyStaff.companyId, payrollCompanyStaff.staffId],
        set: {
          active: true,
          endDate: null,
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
        })
        .partial(),
      applyToSheetId: z.string().optional(),
      removeFromSheetId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("payroll", "edit");
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
