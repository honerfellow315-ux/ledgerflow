import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, inArray, lt, gt, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../server/db";
import {
  payrollCompanies,
  payrollStaff,
  salaryEntries,
  salaryPayments,
  salaryPeriods,
  shiftCompanies,
} from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { uid } from "../server/id";
import { recordActivity, changedFieldsSummary } from "../server/activity";
import { importShiftRows } from "../server/shiftImport";
import { recomputeFromShifts } from "../server/salaryShifts";
import { buildImportChecks } from "../server/importChecks";
import { buildRows, formatMonthLabel, formatNi, normName, normNi, round2 } from "../payroll/calc";
import { CONTRACT_STATUSES, STAFF_DETAIL_FIELDS, isBuiltInShift } from "../payroll/types";
import type {
  CheckStatus,
  ImportCheckReport,
  ShiftCompany,
  PayrollCompany,
  PeriodSheet,
  PeriodStatus,
  SalaryEntry,
  SalaryPayment,
  SalaryPeriod,
  Staff,
  StaffDetailField,
  StaffDetails,
  StaffDetailsImportResult,
  StaffDetailsImportRow,
} from "../payroll/types";

/* ------------------------------------------------------------------ */
/* Row -> shared type mappers (drop nulls, narrow `text` columns)       */
/* ------------------------------------------------------------------ */

/**
 * The salary sheet's view of a person (ids, NI, tag, area, account detail). It is
 * what getPeriodSheet sends to anyone with the "salary" permission, so it must NOT
 * carry the personal / banking / contract fields below.
 */
const toSheetStaff = (r: typeof payrollStaff.$inferSelect): Staff => ({
  id: r.id,
  rssId: r.rssId,
  essId: r.essId,
  extIds: r.extIds ?? {},
  ni: r.ni,
  name: r.name,
  tag: r.tag,
  accountDetail: r.accountDetail,
  area: r.area,
  ...(r.notes ? { notes: r.notes } : {}),
  active: r.active,
});

/** Empty / null detail columns are dropped, like `notes`. */
const toStaffDetails = (r: typeof payrollStaff.$inferSelect): StaffDetails => {
  const details: StaffDetails = {};
  for (const k of STAFF_DETAIL_FIELDS) {
    const v = r[k];
    if (v) details[k] = v;
  }
  return details;
};

/** Full staff record, including the new detail fields. Only for the "staff" permission. */
const toStaff = (r: typeof payrollStaff.$inferSelect): Staff => ({
  ...toSheetStaff(r),
  ...toStaffDetails(r),
});

const toCompany = (r: typeof payrollCompanies.$inferSelect): PayrollCompany => ({
  id: r.id,
  name: r.name,
  orderIndex: r.orderIndex,
  active: r.active,
});

const toShiftCompany = (r: typeof shiftCompanies.$inferSelect): ShiftCompany => ({
  code: r.code,
  name: r.name,
  active: r.active,
  sortOrder: r.sortOrder,
});

const toPeriod = (r: typeof salaryPeriods.$inferSelect): SalaryPeriod => ({
  id: r.id,
  month: r.month,
  status: (["draft", "reviewed", "verified", "closed"].includes(r.status)
    ? r.status
    : "draft") as PeriodStatus,
  ...(r.notes ? { notes: r.notes } : {}),
});

const toEntry = (r: typeof salaryEntries.$inferSelect): SalaryEntry => ({
  id: r.id,
  periodId: r.periodId,
  staffId: r.staffId,
  rssAmount: r.rssAmount,
  rssHours: r.rssHours,
  essAmount: r.essAmount,
  essHours: r.essHours,
  extra: r.extra ?? {},
  carryForward: r.carryForward,
  taxDeduction: r.taxDeduction,
  deduction: r.deduction,
  ...(r.deductionNote ? { deductionNote: r.deductionNote } : {}),
  checkStatus: (r.checkStatus === "Reviewed" || r.checkStatus === "Verified"
    ? r.checkStatus
    : "") as CheckStatus,
  flag: r.flag,
  payroll: r.payroll ?? {},
});

const toPayment = (r: typeof salaryPayments.$inferSelect): SalaryPayment => ({
  id: r.id,
  entryId: r.entryId,
  date: r.date,
  amount: r.amount,
  method: r.method,
  reference: r.reference,
  ...(r.notes ? { notes: r.notes } : {}),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const today = () => new Date().toISOString().slice(0, 10);

async function getPeriodOrThrow(periodId: string) {
  const [row] = await db
    .select()
    .from(salaryPeriods)
    .where(eq(salaryPeriods.id, periodId))
    .limit(1);
  if (!row) throw new Error("This salary period no longer exists.");
  return row;
}

/** Closed periods are locked — every mutation goes through this first. */
async function assertOpen(periodId: string) {
  const period = await getPeriodOrThrow(periodId);
  if (period.status === "closed") {
    throw new Error(
      `${formatMonthLabel(period.month)} is closed. Reopen it (needs approve permission) to make changes.`,
    );
  }
  return period;
}

async function periodIdForEntry(entryId: string) {
  const [row] = await db
    .select({ periodId: salaryEntries.periodId })
    .from(salaryEntries)
    .where(eq(salaryEntries.id, entryId))
    .limit(1);
  if (!row) throw new Error("This salary line no longer exists.");
  return row.periodId;
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Loads one period's entries + payments + companies (shared by the sheet
 * screen, the period list and carry-forward). */
async function loadPeriodData(periodId: string) {
  const [entries, companies] = await Promise.all([
    db.select().from(salaryEntries).where(eq(salaryEntries.periodId, periodId)),
    db.select().from(payrollCompanies).where(eq(payrollCompanies.active, true)),
  ]);
  const payments = await db
    .select({ p: salaryPayments })
    .from(salaryPayments)
    .innerJoin(salaryEntries, eq(salaryPayments.entryId, salaryEntries.id))
    .where(eq(salaryEntries.periodId, periodId));
  return {
    entries: entries.map(toEntry),
    payments: payments.map((r) => toPayment(r.p)),
    companies: companies.map(toCompany),
  };
}

/**
 * Sets every entry's carry-forward to the previous period's outstanding
 * (+ still owed to staff, - overpaid), and adds a line for anyone who ended
 * the previous period with a non-zero balance. "Previous" = the latest
 * period with an earlier month. This replaces the Excel "OverPaid last
 * month" lookup sheet.
 */
async function refreshCarryForwardFor(periodId: string) {
  const period = await getPeriodOrThrow(periodId);
  const [prev] = await db
    .select()
    .from(salaryPeriods)
    .where(lt(salaryPeriods.month, period.month))
    .orderBy(desc(salaryPeriods.month))
    .limit(1);
  if (!prev) return { previousMonth: null as string | null, updated: 0, added: 0 };

  const [prevData, staffRows, currentEntries] = await Promise.all([
    loadPeriodData(prev.id),
    db.select().from(payrollStaff),
    db
      .select({ staffId: salaryEntries.staffId })
      .from(salaryEntries)
      .where(eq(salaryEntries.periodId, periodId)),
  ]);
  const prevRows = buildRows(
    prevData.entries,
    staffRows.map(toStaff),
    prevData.payments,
    prevData.companies,
  );
  const outstandingByStaff = new Map(prevRows.map((r) => [r.staff.id, r.computed.outstanding]));
  const haveEntry = new Set(currentEntries.map((e) => e.staffId));

  // 1) lines that already exist in this period
  const existing = [...outstandingByStaff].filter(([staffId]) => haveEntry.has(staffId));
  for (const part of chunk(existing, 500)) {
    const list = sql.join(
      part.map(([staffId, cf]) => sql`(${staffId}::text, ${cf}::numeric)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE salary_entries e SET carry_forward = v.cf
      FROM (VALUES ${list}) AS v(staff_id, cf)
      WHERE e.period_id = ${periodId} AND e.staff_id = v.staff_id`);
  }

  // 2) people with a non-zero balance who have no line yet
  const missing = [...outstandingByStaff].filter(
    ([staffId, cf]) => cf !== 0 && !haveEntry.has(staffId),
  );
  for (const part of chunk(missing, 500)) {
    await db
      .insert(salaryEntries)
      .values(part.map(([staffId, cf]) => ({ id: uid("se"), periodId, staffId, carryForward: cf })))
      .onConflictDoNothing();
  }
  return { previousMonth: prev.month, updated: existing.length, added: missing.length };
}

/* ------------------------------------------------------------------ */
/* Staff                                                                */
/* ------------------------------------------------------------------ */

/** Optional text: blank / missing is stored as NULL. */
const optText = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null);
/** Optional date, stored as yyyy-mm-dd text; blank / missing is stored as NULL. */
const optDate = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use the date format yyyy-mm-dd.")
  .or(z.literal(""))
  .nullish()
  .transform((v) => v || null);
const optContractStatus = z
  .enum(CONTRACT_STATUSES)
  .or(z.literal(""))
  .nullish()
  .transform((v) => v || null);

const staffInput = z.object({
  rssId: z.string().trim().default(""),
  essId: z.string().trim().default(""),
  ni: z.string().trim().default(""),
  name: z.string().trim().min(1),
  tag: z.string().trim().default(""),
  accountDetail: z.string().trim().default(""),
  area: z.string().trim().default(""),
  notes: z.string().optional(),
  active: z.boolean().default(true),
  // "All Payroll Format" fields
  dob: optDate,
  gender: optText,
  rtwShareCode: optText,
  shareCodeExpiry: optDate,
  address: optText,
  town: optText,
  postCode: optText,
  uniform: optText,
  accountHolderName: optText,
  accountNumber: optText,
  sortCode: optText,
  employmentStartDate: optDate,
  employmentEndDate: optDate,
  contractStatus: optContractStatus,
  email: optText,
  immigrationStatus: optText,
  hoursAllowed: optText,
  siaNumber: optText,
  role: optText,
  serviceType: optText,
});

/**
 * Staff fields that never appear in the activity log text (NI, bank details and
 * the personal details of the report). Only the harmless fields are logged.
 */
const PRIVATE_STAFF_FIELDS = new Set<string>([
  "ni",
  "accountDetail",
  "dob",
  "rtwShareCode",
  "shareCodeExpiry",
  "address",
  "town",
  "postCode",
  "accountHolderName",
  "accountNumber",
  "sortCode",
  "email",
  "immigrationStatus",
  "siaNumber",
]);

/** Rejects a second person with the same RSS ID / ESS ID / NI number. */
async function assertStaffUnique(
  v: { rssId?: string | undefined; essId?: string | undefined; ni?: string | undefined },
  exceptId?: string,
) {
  const all = await db.select().from(payrollStaff);
  for (const s of all) {
    if (s.id === exceptId) continue;
    if (v.rssId && s.rssId === v.rssId)
      throw new Error(`RSS ID ${v.rssId} already belongs to ${s.name}.`);
    if (v.essId && s.essId === v.essId)
      throw new Error(`ESS ID ${v.essId} already belongs to ${s.name}.`);
    if (v.ni && normNi(s.ni) === normNi(v.ni))
      throw new Error(`NI number already belongs to ${s.name}.`);
  }
}

export const listStaff = createServerFn({ method: "POST" }).handler(async () => {
  await requirePermission("staff", "view");
  const rows = await db.select().from(payrollStaff).orderBy(asc(payrollStaff.name));
  return rows.map(toStaff);
});

export const addStaff = createServerFn({ method: "POST" })
  .validator(staffInput)
  .handler(async ({ data }) => {
    const actor = await requirePermission("staff", "create");
    // NI is stored in one canonical, spaced form ("RY 86 58 71 D"); matching
    // against imports always ignores spaces and case anyway.
    const clean = { ...data, ni: formatNi(data.ni) };
    await assertStaffUnique(clean);
    const [row] = await db
      .insert(payrollStaff)
      .values({ id: uid("st"), ...clean })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "staff",
        entityId: row.id,
        label: `Staff — ${row.name}`,
      });
    }
    return row ? toStaff(row) : undefined;
  });

export const updateStaff = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: staffInput.partial() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("staff", "edit");
    const patch =
      data.patch.ni === undefined ? data.patch : { ...data.patch, ni: formatNi(data.patch.ni) };
    await assertStaffUnique(patch, data.id);
    const [row] = await db
      .update(payrollStaff)
      .set(patch)
      .where(eq(payrollStaff.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "staff",
        entityId: row.id,
        label: `Staff — ${row.name}`,
        // NI / bank details are deliberately left out of the log text
        details: changedFieldsSummary(
          Object.fromEntries(Object.entries(patch).filter(([k]) => !PRIVATE_STAFF_FIELDS.has(k))),
        ),
      });
    }
    return row ? toStaff(row) : undefined;
  });

/* ------------------------------------------------------------------ */
/* Staff details import (All Payroll Format file -> empty staff fields)  */
/* ------------------------------------------------------------------ */

const detailText = z.string().max(300).optional();
const detailsImportRow = z.object({
  name: z.string().max(300),
  ni: z.string().max(60),
  dob: detailText,
  gender: detailText,
  rtwShareCode: detailText,
  shareCodeExpiry: detailText,
  address: detailText,
  town: detailText,
  postCode: detailText,
  uniform: detailText,
  accountHolderName: detailText,
  accountNumber: detailText,
  sortCode: detailText,
  employmentStartDate: detailText,
  employmentEndDate: detailText,
  contractStatus: detailText,
  email: detailText,
  immigrationStatus: detailText,
  hoursAllowed: detailText,
  siaNumber: detailText,
  role: detailText,
  serviceType: detailText,
});

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATE_DETAIL_FIELDS = new Set<StaffDetailField>([
  "dob",
  "shareCodeExpiry",
  "employmentStartDate",
  "employmentEndDate",
]);

/** The value a file cell may be written as, or "" when it is not usable. */
function cleanDetail(field: StaffDetailField, raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (DATE_DETAIL_FIELDS.has(field)) return ISO_DATE.test(v) ? v : "";
  if (field === "contractStatus") return CONTRACT_STATUSES.find((c) => c === v) ?? "";
  return v;
}

/**
 * Fills the new staff fields from an "All Payroll Format" file. It ONLY fills
 * fields that are currently empty, never overwrites, and never creates staff.
 * Matching: NI first (ignoring spaces / case), then a UNIQUE name (a name match
 * is refused when both sides have an NI and the two differ).
 * `apply: false` is the preview — it reads and reports, writes nothing.
 * Each person is one single UPDATE whose CASE keeps any value already there,
 * so re-running it (or two imports at once) can't overwrite anything.
 */
export const importStaffDetails = createServerFn({ method: "POST" })
  .validator(z.object({ rows: z.array(detailsImportRow).max(500), apply: z.boolean() }))
  .handler(async ({ data }): Promise<StaffDetailsImportResult> => {
    const actor = await requirePermission("staff", "edit");
    const staffRows = await db.select().from(payrollStaff);
    const byNi = new Map<string, (typeof staffRows)[number]>();
    const byName = new Map<string, (typeof staffRows)[number][]>();
    for (const st of staffRows) {
      const ni = normNi(st.ni);
      if (ni && !byNi.has(ni)) byNi.set(ni, st);
      const nm = normName(st.name);
      if (nm) byName.set(nm, [...(byName.get(nm) ?? []), st]);
    }

    const out: StaffDetailsImportRow[] = [];
    const updates: { id: string; fills: Partial<Record<StaffDetailField, string>> }[] = [];
    // fields already claimed by an earlier row of the same file (first row wins)
    const claimed = new Map<string, Set<StaffDetailField>>();

    for (const row of data.rows) {
      const fileNi = normNi(row.ni);
      let person: (typeof staffRows)[number] | undefined;
      let status: StaffDetailsImportRow["status"] = "notFound";
      if (fileNi && byNi.has(fileNi)) {
        person = byNi.get(fileNi);
        status = "matched";
      } else {
        const named = byName.get(normName(row.name)) ?? [];
        if (named.length > 1) status = "ambiguous";
        else if (named.length === 1) {
          const cand = named[0]!;
          if (fileNi && normNi(cand.ni) && normNi(cand.ni) !== fileNi) status = "niConflict";
          else {
            person = cand;
            status = "matched";
          }
        }
      }
      if (!person || status !== "matched") {
        out.push({ name: row.name, status, fills: [] });
        continue;
      }

      const taken = claimed.get(person.id) ?? new Set<StaffDetailField>();
      const fills: Partial<Record<StaffDetailField, string>> = {};
      for (const f of STAFF_DETAIL_FIELDS) {
        const value = cleanDetail(f, row[f]);
        if (!value || person[f] || taken.has(f)) continue;
        fills[f] = value;
        taken.add(f);
      }
      claimed.set(person.id, taken);
      const keys = Object.keys(fills) as StaffDetailField[];
      out.push({ name: row.name, status: "matched", fills: keys });
      if (keys.length > 0) updates.push({ id: person.id, fills });
    }

    if (data.apply && updates.length > 0) {
      for (const part of chunk(updates, 10)) {
        await Promise.all(
          part.map((u) => {
            const set: Record<string, unknown> = {};
            for (const [f, v] of Object.entries(u.fills)) {
              const column = payrollStaff[f as StaffDetailField];
              set[f] =
                sql`CASE WHEN ${column} IS NULL OR ${column} = '' THEN ${v}::text ELSE ${column} END`;
            }
            return db
              .update(payrollStaff)
              .set(set as PgUpdateSetSource<typeof payrollStaff>)
              .where(eq(payrollStaff.id, u.id));
          }),
        );
      }
      await recordActivity({
        actor,
        action: "updated",
        module: "staff",
        label: "Staff details import",
        // counts only — never the values
        details: `${updates.length} staff, ${updates.reduce((n, u) => n + Object.keys(u.fills).length, 0)} empty fields filled`,
      });
    }
    return { rows: out };
  });

/* ------------------------------------------------------------------ */
/* Payroll companies (the payroll columns of the sheet)                 */
/* ------------------------------------------------------------------ */

export const addPayrollCompany = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().trim().min(1) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const all = await db.select().from(payrollCompanies);
    const dupe = all.find((c) => c.name.toLowerCase() === data.name.toLowerCase());
    if (dupe) {
      if (!dupe.active) {
        await db
          .update(payrollCompanies)
          .set({ active: true })
          .where(eq(payrollCompanies.id, dupe.id));
      }
      return toCompany({ ...dupe, active: true });
    }
    const orderIndex = all.reduce((m, c) => Math.max(m, c.orderIndex), -1) + 1;
    const [row] = await db
      .insert(payrollCompanies)
      .values({ id: uid("pc"), name: data.name, orderIndex })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "salary",
        entityId: row.id,
        label: `Payroll company — ${row.name}`,
      });
    }
    return row ? toCompany(row) : undefined;
  });

export const updatePayrollCompany = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      patch: z.object({
        name: z.string().trim().min(1).optional(),
        active: z.boolean().optional(),
        orderIndex: z.number().int().optional(),
      }),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const [row] = await db
      .update(payrollCompanies)
      .set(data.patch)
      .where(eq(payrollCompanies.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "salary",
        entityId: row.id,
        label: `Payroll company — ${row.name}`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row ? toCompany(row) : undefined;
  });

/** All payroll companies incl. archived ones (for the manage dialog). */
export const listPayrollCompanies = createServerFn({ method: "POST" }).handler(async () => {
  await requirePermission("salary", "view");
  const rows = await db.select().from(payrollCompanies).orderBy(asc(payrollCompanies.orderIndex));
  return rows.map(toCompany);
});

/* ------------------------------------------------------------------ */
/* Periods                                                              */
/* ------------------------------------------------------------------ */

export const listPeriods = createServerFn({ method: "POST" }).handler(async () => {
  await requirePermission("salary", "view");
  const [periods, entries, payments, companies, staffRows] = await Promise.all([
    db.select().from(salaryPeriods).orderBy(desc(salaryPeriods.month)),
    db.select().from(salaryEntries),
    db.select().from(salaryPayments),
    db.select().from(payrollCompanies).where(eq(payrollCompanies.active, true)),
    db.select().from(payrollStaff),
  ]);
  const staff = staffRows.map(toStaff);
  const comp = companies.map(toCompany);
  return periods.map((p) => {
    const periodEntries = entries.filter((e) => e.periodId === p.id).map(toEntry);
    const ids = new Set(periodEntries.map((e) => e.id));
    const rows = buildRows(
      periodEntries,
      staff,
      payments.filter((x) => ids.has(x.entryId)).map(toPayment),
      comp,
    );
    let stillOwed = 0;
    let overpaid = 0;
    let totalAmount = 0;
    for (const r of rows) {
      totalAmount += r.computed.totalAmount;
      if (r.computed.outstanding > 0) stillOwed += r.computed.outstanding;
      if (r.computed.outstanding < 0) overpaid += -r.computed.outstanding;
    }
    return {
      ...toPeriod(p),
      staffCount: rows.length,
      totalAmount: round2(totalAmount),
      stillOwed: round2(stillOwed),
      overpaid: round2(overpaid),
    };
  });
});

export const createPeriod = createServerFn({ method: "POST" })
  .validator(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "create");
    const [existing] = await db
      .select()
      .from(salaryPeriods)
      .where(eq(salaryPeriods.month, data.month))
      .limit(1);
    if (existing) throw new Error(`${formatMonthLabel(data.month)} already exists.`);
    const [row] = await db
      .insert(salaryPeriods)
      .values({ id: uid("sp"), month: data.month })
      .returning();
    if (!row) throw new Error("Could not create the period.");
    const carry = await refreshCarryForwardFor(row.id);
    await recordActivity({
      actor,
      action: "created",
      module: "salary",
      entityId: row.id,
      label: `Salary period — ${formatMonthLabel(row.month)}`,
      details: carry.previousMonth
        ? `Carry-forward from ${formatMonthLabel(carry.previousMonth)} for ${carry.added} staff`
        : undefined,
    });
    return toPeriod(row);
  });

export const refreshCarryForward = createServerFn({ method: "POST" })
  .validator(z.object({ periodId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const period = await assertOpen(data.periodId);
    const result = await refreshCarryForwardFor(data.periodId);
    await recordActivity({
      actor,
      action: "updated",
      module: "salary",
      entityId: period.id,
      label: `Salary period — ${formatMonthLabel(period.month)}`,
      details: result.previousMonth
        ? `Carry-forward refreshed from ${formatMonthLabel(result.previousMonth)}`
        : "Carry-forward refresh (no earlier period)",
    });
    return result;
  });

const STATUS_ORDER: PeriodStatus[] = ["draft", "reviewed", "verified", "closed"];

export const setPeriodStatus = createServerFn({ method: "POST" })
  .validator(
    z.object({ periodId: z.string(), status: z.enum(["draft", "reviewed", "verified", "closed"]) }),
  )
  .handler(async ({ data }) => {
    const period = await getPeriodOrThrow(data.periodId);
    const from = toPeriod(period).status;
    // Verifying, closing and reopening a verified/closed period are the
    // sensitive steps -> "approve"; draft <-> reviewed is ordinary editing.
    const sensitive = [from, data.status].some((s) => s === "verified" || s === "closed");
    const actor = await requirePermission("salary", sensitive ? "approve" : "edit");
    if (from === data.status) return toPeriod(period);

    await db
      .update(salaryPeriods)
      .set({ status: data.status, closedAt: data.status === "closed" ? new Date() : null })
      .where(eq(salaryPeriods.id, data.periodId));

    // Closing locks this month and pushes its balances into the next month
    // (if that month already exists and isn't itself closed).
    let carried: string | undefined;
    if (data.status === "closed") {
      const [next] = await db
        .select()
        .from(salaryPeriods)
        .where(gt(salaryPeriods.month, period.month))
        .orderBy(asc(salaryPeriods.month))
        .limit(1);
      if (next && next.status !== "closed") {
        await refreshCarryForwardFor(next.id);
        carried = formatMonthLabel(next.month);
      }
    }
    await recordActivity({
      actor,
      action: "updated",
      module: "salary",
      entityId: period.id,
      label: `Salary period — ${formatMonthLabel(period.month)}`,
      details: `Status: ${from} → ${data.status}${carried ? ` (carry-forward updated in ${carried})` : ""}`,
    });
    return { ...toPeriod(period), status: data.status as PeriodStatus };
  });

export const deletePeriod = createServerFn({ method: "POST" })
  .validator(z.object({ periodId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "delete");
    const period = await assertOpen(data.periodId);
    await db.delete(salaryPeriods).where(eq(salaryPeriods.id, data.periodId));
    await recordActivity({
      actor,
      action: "deleted",
      module: "salary",
      entityId: period.id,
      label: `Salary period — ${formatMonthLabel(period.month)}`,
    });
    return { ok: true };
  });

export const getPeriodSheet = createServerFn({ method: "POST" })
  .validator(z.object({ periodId: z.string() }))
  .handler(async ({ data }): Promise<PeriodSheet> => {
    await requirePermission("salary", "view");
    const periodRow = await getPeriodOrThrow(data.periodId);
    const [{ entries, payments }, staffRows, companies, counts] = await Promise.all([
      loadPeriodData(data.periodId),
      db.select().from(payrollStaff).orderBy(asc(payrollStaff.name)),
      db
        .select()
        .from(payrollCompanies)
        .where(eq(payrollCompanies.active, true))
        .orderBy(asc(payrollCompanies.orderIndex)),
      db.execute(sql`
        SELECT source, count(*)::int AS total,
               count(*) FILTER (WHERE staff_id IS NULL)::int AS unmatched
        FROM salary_shifts WHERE period_id = ${data.periodId} GROUP BY source`),
    ]);
    const shiftCounts: Record<string, number> = { RSS: 0, ESS: 0 };
    let unmatchedShifts = 0;
    for (const r of counts.rows as { source: string; total: number; unmatched: number }[]) {
      shiftCounts[r.source] = Number(r.total);
      unmatchedShifts += Number(r.unmatched);
    }
    return {
      period: toPeriod(periodRow),
      entries,
      payments,
      staff: staffRows.map(toSheetStaff),
      companies: companies.map(toCompany),
      unmatchedShifts,
      shiftCounts,
    };
  });

/**
 * Where one person's earnings for the month came from: their imported shifts
 * grouped by shift company and client company. A person is ONE staff
 * record (matched on NI), so work done for several companies all lands on the
 * same salary line; this just shows the split. Read-only.
 */
export const getEntryBreakdown = createServerFn({ method: "POST" })
  .validator(z.object({ entryId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission("salary", "view");
    const [entry] = await db
      .select({ periodId: salaryEntries.periodId, staffId: salaryEntries.staffId })
      .from(salaryEntries)
      .where(eq(salaryEntries.id, data.entryId))
      .limit(1);
    if (!entry) throw new Error("This salary line no longer exists.");
    const res = await db.execute(sql`
      SELECT source, client_name AS "clientName", count(*)::int AS shifts,
             round(sum(hours), 2)::float8 AS hours, round(sum(amount), 2)::float8 AS amount
      FROM salary_shifts
      WHERE period_id = ${entry.periodId} AND staff_id = ${entry.staffId}
      GROUP BY source, client_name
      ORDER BY source, client_name`);
    return (
      res.rows as {
        source: string;
        clientName: string;
        shifts: number;
        hours: number;
        amount: number;
      }[]
    ).map((r) => ({
      source: r.source,
      clientName: r.clientName,
      shifts: Number(r.shifts),
      hours: Number(r.hours),
      amount: Number(r.amount),
    }));
  });

/* ------------------------------------------------------------------ */
/* Entries (one line of the sheet) and cash payments                    */
/* ------------------------------------------------------------------ */

const entryPatch = z
  .object({
    rssAmount: z.number(),
    rssHours: z.number(),
    essAmount: z.number(),
    essHours: z.number(),
    carryForward: z.number(),
    taxDeduction: z.number(),
    deduction: z.number(),
    deductionNote: z.string(),
    checkStatus: z.enum(["", "Reviewed", "Verified"]),
    flag: z.string(),
    payroll: z.record(z.string(), z.number()),
  })
  .partial();

export const addEntry = createServerFn({ method: "POST" })
  .validator(z.object({ periodId: z.string(), staffId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const period = await assertOpen(data.periodId);
    const [staff] = await db
      .select()
      .from(payrollStaff)
      .where(eq(payrollStaff.id, data.staffId))
      .limit(1);
    if (!staff) throw new Error("That staff member no longer exists.");
    const [row] = await db
      .insert(salaryEntries)
      .values({ id: uid("se"), periodId: data.periodId, staffId: data.staffId })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "salary",
        entityId: row.id,
        label: `Salary line — ${staff.name} (${formatMonthLabel(period.month)})`,
      });
    }
    return row ? toEntry(row) : undefined;
  });

export const updateEntry = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: entryPatch }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const periodId = await periodIdForEntry(data.id);
    const period = await assertOpen(periodId);
    const [row] = await db
      .update(salaryEntries)
      .set(data.patch)
      .where(eq(salaryEntries.id, data.id))
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
        module: "salary",
        entityId: row.id,
        label: `Salary line — ${staff?.name ?? row.staffId} (${formatMonthLabel(period.month)})`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row ? toEntry(row) : undefined;
  });

export const deleteEntry = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "delete");
    const periodId = await periodIdForEntry(data.id);
    const period = await assertOpen(periodId);
    const [entry] = await db
      .select()
      .from(salaryEntries)
      .where(eq(salaryEntries.id, data.id))
      .limit(1);
    const [staff] = entry
      ? await db.select().from(payrollStaff).where(eq(payrollStaff.id, entry.staffId)).limit(1)
      : [];
    await db.delete(salaryEntries).where(eq(salaryEntries.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "salary",
      entityId: data.id,
      label: `Salary line — ${staff?.name ?? data.id} (${formatMonthLabel(period.month)})`,
    });
    return { ok: true };
  });

const paymentInput = z.object({
  date: z.string().min(1),
  amount: z.number(),
  method: z.string().min(1).default("Bank Transfer"),
  reference: z.string().default(""),
  notes: z.string().optional(),
});

export const addSalaryPayment = createServerFn({ method: "POST" })
  .validator(paymentInput.extend({ entryId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const period = await assertOpen(await periodIdForEntry(data.entryId));
    const [row] = await db
      .insert(salaryPayments)
      .values({ id: uid("sy"), ...data })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "salary",
        entityId: row.id,
        label: `Salary payment £${row.amount.toFixed(2)} (${formatMonthLabel(period.month)})`,
      });
    }
    return row ? toPayment(row) : undefined;
  });

export const updateSalaryPayment = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), patch: paymentInput.partial() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const [existing] = await db
      .select()
      .from(salaryPayments)
      .where(eq(salaryPayments.id, data.id))
      .limit(1);
    if (!existing) throw new Error("This payment no longer exists.");
    const period = await assertOpen(await periodIdForEntry(existing.entryId));
    const [row] = await db
      .update(salaryPayments)
      .set(data.patch)
      .where(eq(salaryPayments.id, data.id))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "salary",
        entityId: row.id,
        label: `Salary payment £${row.amount.toFixed(2)} (${formatMonthLabel(period.month)})`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row ? toPayment(row) : undefined;
  });

export const deleteSalaryPayment = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "delete");
    const [existing] = await db
      .select()
      .from(salaryPayments)
      .where(eq(salaryPayments.id, data.id))
      .limit(1);
    if (!existing) return { ok: true };
    const period = await assertOpen(await periodIdForEntry(existing.entryId));
    await db.delete(salaryPayments).where(eq(salaryPayments.id, data.id));
    await recordActivity({
      actor,
      action: "deleted",
      module: "salary",
      entityId: data.id,
      label: `Salary payment £${existing.amount.toFixed(2)} (${formatMonthLabel(period.month)})`,
    });
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Shift companies (RSS, ESS and any the client adds)                   */
/* ------------------------------------------------------------------ */

/** RSS / ESS always work; any other code must be an active shift company. */
async function assertShiftCompany(code: string) {
  if (isBuiltInShift(code)) return;
  const [row] = await db
    .select({ active: shiftCompanies.active })
    .from(shiftCompanies)
    .where(eq(shiftCompanies.code, code))
    .limit(1);
  if (!row) throw new Error(`"${code}" is not a shift company. Add it first.`);
  if (!row.active) throw new Error(`Shift company ${code} is switched off. Switch it on to import.`);
}

const shiftCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{2,20}$/, "Use 2-20 letters or numbers, e.g. ABC"));

/** All shift companies incl. switched-off ones (for the dropdown + manage dialog). */
export const listShiftCompanies = createServerFn({ method: "POST" }).handler(async () => {
  await requirePermission("salary", "view");
  const rows = await db
    .select()
    .from(shiftCompanies)
    .orderBy(asc(shiftCompanies.sortOrder), asc(shiftCompanies.code));
  return rows.map(toShiftCompany);
});

export const createShiftCompany = createServerFn({ method: "POST" })
  .validator(z.object({ code: shiftCode, name: z.string().trim().min(1).max(60) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const all = await db.select().from(shiftCompanies);
    const dupe = all.find((c) => c.code === data.code);
    if (dupe) {
      if (dupe.active) throw new Error(`${data.code} already exists.`);
      const [back] = await db
        .update(shiftCompanies)
        .set({ active: true })
        .where(eq(shiftCompanies.code, data.code))
        .returning();
      return back ? toShiftCompany(back) : undefined;
    }
    const sortOrder = all.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1;
    const [row] = await db
      .insert(shiftCompanies)
      .values({ code: data.code, name: data.name, sortOrder })
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "created",
        module: "salary",
        entityId: row.code,
        label: `Shift company — ${row.code} (${row.name})`,
      });
    }
    return row ? toShiftCompany(row) : undefined;
  });

/** Rename or switch on/off. Never deletes: imported shifts keep pointing at the code. */
export const updateShiftCompany = createServerFn({ method: "POST" })
  .validator(
    z.object({
      code: z.string(),
      patch: z.object({
        name: z.string().trim().min(1).max(60).optional(),
        active: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      }),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    if (Object.keys(data.patch).length === 0) return undefined;
    const [row] = await db
      .update(shiftCompanies)
      .set(data.patch)
      .where(eq(shiftCompanies.code, data.code))
      .returning();
    if (row) {
      await recordActivity({
        actor,
        action: "updated",
        module: "salary",
        entityId: row.code,
        label: `Shift company — ${row.code} (${row.name})`,
        details: changedFieldsSummary(data.patch),
      });
    }
    return row ? toShiftCompany(row) : undefined;
  });

/** The "Check data" report for one month. Read-only. */
export const getImportChecks = createServerFn({ method: "POST" })
  .validator(z.object({ periodId: z.string() }))
  .handler(async ({ data }): Promise<ImportCheckReport> => {
    await requirePermission("salary", "view");
    const period = await getPeriodOrThrow(data.periodId);
    return buildImportChecks(db, period.id, period.month);
  });

/* ------------------------------------------------------------------ */
/* Import 1: raw shift export (any shift company)                       */
/* ------------------------------------------------------------------ */

const shiftRow = z.object({
  employeeId: z.string(),
  employeeName: z.string(),
  ni: z.string(),
  date: z.string(),
  clientName: z.string(),
  siteName: z.string(),
  hours: z.number(),
  rate: z.number(),
  amount: z.number(),
  expenses: z.number(),
  penalty: z.number(),
  accountDetail: z.string(),
  tag: z.string(),
});

/**
 * The browser sends the parsed export in chunks (a month can be 10k+ shifts,
 * which won't fit one request on Vercel). The first chunk (`reset`) clears
 * whatever was imported before for this period + company, so re-uploading a
 * corrected file replaces it instead of doubling it. `recomputeSheetFromShifts`
 * is called once after the last chunk. The matching itself lives in
 * server/shiftImport.ts.
 */
export const importShiftsChunk = createServerFn({ method: "POST" })
  .validator(
    z.object({
      periodId: z.string(),
      source: z.string().trim().min(1).max(20),
      rows: z.array(shiftRow).max(1500),
      reset: z.boolean(),
      createMissingStaff: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePermission("salary", "edit");
    await assertOpen(data.periodId);
    if (data.createMissingStaff) await requirePermission("staff", "create");
    await assertShiftCompany(data.source);
    return importShiftRows(db, data);
  });

/** Call once after the last `importShiftsChunk`. */
export const recomputeSheetFromShifts = createServerFn({ method: "POST" })
  .validator(
    z.object({
      periodId: z.string(),
      source: z.string().trim().min(1).max(20),
      fileName: z.string().default(""),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const period = await assertOpen(data.periodId);
    await recomputeFromShifts(db, data.periodId);
    const counts = await db.execute(sql`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE staff_id IS NULL)::int AS unmatched
      FROM salary_shifts WHERE period_id = ${data.periodId} AND source = ${data.source}`);
    const c = (counts.rows[0] ?? { total: 0, unmatched: 0 }) as {
      total: number;
      unmatched: number;
    };
    await recordActivity({
      actor,
      action: "updated",
      module: "salary",
      entityId: period.id,
      label: `Salary period — ${formatMonthLabel(period.month)}`,
      details: `Imported ${c.total} ${data.source} shifts${data.fileName ? ` from ${data.fileName}` : ""} (${c.unmatched} unmatched)`,
    });
    return { total: Number(c.total), unmatched: Number(c.unmatched) };
  });

/** Re-runs matching for shifts that had no staff match (e.g. after adding
 * the missing staff on the Staff screen) and rebuilds the amounts. */
export const rematchShifts = createServerFn({ method: "POST" })
  .validator(z.object({ periodId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission("salary", "edit");
    await assertOpen(data.periodId);
    await recomputeFromShifts(db, data.periodId);
    const res = await db.execute(sql`
      SELECT count(*)::int AS unmatched FROM salary_shifts
      WHERE period_id = ${data.periodId} AND staff_id IS NULL`);
    return {
      unmatched: Number((res.rows[0] as { unmatched: number } | undefined)?.unmatched ?? 0),
    };
  });

/** The people behind unmatched shifts, so they can be created/fixed. */
export const listUnmatchedShiftPeople = createServerFn({ method: "POST" })
  .validator(z.object({ periodId: z.string() }))
  .handler(async ({ data }) => {
    await requirePermission("salary", "view");
    const res = await db.execute(sql`
      SELECT source, employee_id AS "employeeId", employee_name AS "employeeName",
             count(*)::int AS shifts, round(sum(hours), 2)::float8 AS hours
      FROM salary_shifts WHERE period_id = ${data.periodId} AND staff_id IS NULL
      GROUP BY source, employee_id, employee_name ORDER BY employee_name LIMIT 200`);
    return res.rows as {
      source: string;
      employeeId: string;
      employeeName: string;
      shifts: number;
      hours: number;
    }[];
  });

/* ------------------------------------------------------------------ */
/* Import 2: an existing Excel "Salary Sheet" (bootstrap / migration)   */
/* ------------------------------------------------------------------ */

const masterRow = z.object({
  rssId: z.string(),
  essId: z.string(),
  ni: z.string(),
  tag: z.string(),
  name: z.string(),
  rssAmount: z.number(),
  rssHours: z.number(),
  essAmount: z.number(),
  essHours: z.number(),
  carryForward: z.number(),
  checkStatus: z.enum(["", "Reviewed", "Verified"]),
  payroll: z.record(z.string(), z.number()),
  taxDeduction: z.number(),
  payments: z.array(z.number()),
  deduction: z.number(),
  accountDetail: z.string(),
  flag: z.string(),
  area: z.string(),
});

export const importMasterSheet = createServerFn({ method: "POST" })
  .validator(
    z.object({
      periodId: z.string(),
      rows: z.array(masterRow).max(1500),
      fileName: z.string().default(""),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    await requirePermission("staff", "create");
    const period = await assertOpen(data.periodId);

    // 1) payroll companies named in the file's headers
    const companyRows = await db.select().from(payrollCompanies);
    const companyIdByName = new Map(companyRows.map((c) => [c.name.toLowerCase(), c.id]));
    let nextOrder = companyRows.reduce((m, c) => Math.max(m, c.orderIndex), -1) + 1;
    const wantedNames = [...new Set(data.rows.flatMap((r) => Object.keys(r.payroll)))];
    for (const name of wantedNames) {
      const existing = companyRows.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (!existing.active) {
          await db
            .update(payrollCompanies)
            .set({ active: true })
            .where(eq(payrollCompanies.id, existing.id));
        }
        continue;
      }
      const id = uid("pc");
      await db.insert(payrollCompanies).values({ id, name, orderIndex: nextOrder++ });
      companyIdByName.set(name.toLowerCase(), id);
    }

    // 2) staff: match by NI, then RSS ID, ESS ID, then unique name
    const staffRows = await db.select().from(payrollStaff);
    const byNi = new Map<string, string>();
    const byRss = new Map<string, string>();
    const byEss = new Map<string, string>();
    const nameCount = new Map<string, number>();
    const byName = new Map<string, string>();
    const reg = (s: { id: string; rssId: string; essId: string; ni: string; name: string }) => {
      if (s.ni) byNi.set(normNi(s.ni), s.id);
      if (s.rssId) byRss.set(s.rssId, s.id);
      if (s.essId) byEss.set(s.essId, s.id);
      const n = normName(s.name);
      nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
      byName.set(n, s.id);
    };
    staffRows.forEach(reg);

    const fresh: (typeof payrollStaff.$inferInsert)[] = [];
    const fills: { id: string; r: (typeof data.rows)[number] }[] = [];
    const rowStaff: { staffId: string; r: (typeof data.rows)[number] }[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const r of data.rows) {
      if (!r.name.trim()) {
        skipped++;
        continue;
      }
      let id =
        (r.ni && byNi.get(normNi(r.ni))) ||
        (r.rssId && r.rssId !== "0" ? byRss.get(r.rssId) : undefined) ||
        (r.essId && r.essId !== "0" ? byEss.get(r.essId) : undefined) ||
        (nameCount.get(normName(r.name)) === 1 ? byName.get(normName(r.name)) : undefined) ||
        undefined;
      if (id) {
        fills.push({ id, r });
      } else {
        id = uid("st");
        const s = {
          id,
          rssId: r.rssId && r.rssId !== "0" ? r.rssId : "",
          essId: r.essId && r.essId !== "0" ? r.essId : "",
          ni: formatNi(r.ni),
          name: r.name.trim(),
          tag: r.tag,
          accountDetail: r.accountDetail,
          area: r.area,
        };
        fresh.push(s);
        reg(s);
      }
      if (seen.has(id)) {
        skipped++; // same person twice in the file — keep the first line
        continue;
      }
      seen.add(id);
      rowStaff.push({ staffId: id, r });
    }
    for (const part of chunk(fresh, 500)) await db.insert(payrollStaff).values(part);

    // existing staff: only fill fields that are still empty
    for (const part of chunk(fills, 400)) {
      const list = sql.join(
        part.map(
          ({ id, r }) =>
            sql`(${id}::text, ${r.rssId && r.rssId !== "0" ? r.rssId : ""}::text, ${r.essId && r.essId !== "0" ? r.essId : ""}::text,
                 ${formatNi(r.ni)}::text, ${r.tag}::text, ${r.accountDetail}::text, ${r.area}::text)`,
        ),
        sql`, `,
      );
      await db.execute(sql`
        UPDATE payroll_staff s SET
          rss_id = CASE WHEN s.rss_id = '' THEN v.rss_id ELSE s.rss_id END,
          ess_id = CASE WHEN s.ess_id = '' THEN v.ess_id ELSE s.ess_id END,
          ni = CASE WHEN s.ni = '' THEN v.ni ELSE s.ni END,
          tag = CASE WHEN s.tag = '' THEN v.tag ELSE s.tag END,
          account_detail = CASE WHEN s.account_detail = '' THEN v.account_detail ELSE s.account_detail END,
          area = CASE WHEN s.area = '' THEN v.area ELSE s.area END
        FROM (VALUES ${list}) AS v(id, rss_id, ess_id, ni, tag, account_detail, area)
        WHERE s.id = v.id`);
    }

    // 3) salary lines (upsert on period + staff)
    const entryIdByStaff = new Map<string, string>();
    for (const part of chunk(rowStaff, 300)) {
      const values = part.map(({ staffId, r }) => ({
        id: uid("se"),
        periodId: data.periodId,
        staffId,
        rssAmount: r.rssAmount,
        rssHours: r.rssHours,
        essAmount: r.essAmount,
        essHours: r.essHours,
        carryForward: r.carryForward,
        taxDeduction: r.taxDeduction,
        deduction: r.deduction,
        checkStatus: r.checkStatus,
        flag: r.flag,
        payroll: Object.fromEntries(
          Object.entries(r.payroll)
            .map(([name, v]) => [companyIdByName.get(name.toLowerCase()) ?? "", v] as const)
            .filter(([id, v]) => id && v !== 0),
        ),
      }));
      const saved = await db
        .insert(salaryEntries)
        .values(values)
        .onConflictDoUpdate({
          target: [salaryEntries.periodId, salaryEntries.staffId],
          set: {
            rssAmount: sql`excluded.rss_amount`,
            rssHours: sql`excluded.rss_hours`,
            essAmount: sql`excluded.ess_amount`,
            essHours: sql`excluded.ess_hours`,
            carryForward: sql`excluded.carry_forward`,
            taxDeduction: sql`excluded.tax_deduction`,
            deduction: sql`excluded.deduction`,
            checkStatus: sql`excluded.check_status`,
            flag: sql`excluded.flag`,
            payroll: sql`salary_entries.payroll || excluded.payroll`,
          },
        })
        .returning({ id: salaryEntries.id, staffId: salaryEntries.staffId });
      for (const s of saved) entryIdByStaff.set(s.staffId, s.id);
    }

    // 4) cash payments P1..Pn — replace the ones a previous Excel import
    // made for these lines, never anything typed in by hand
    const entryIds = [...entryIdByStaff.values()];
    for (const part of chunk(entryIds, 500)) {
      await db
        .delete(salaryPayments)
        .where(
          and(
            inArray(salaryPayments.entryId, part),
            sql`${salaryPayments.notes} LIKE 'Imported from Excel%'`,
          ),
        );
    }
    const payValues: (typeof salaryPayments.$inferInsert)[] = [];
    for (const { staffId, r } of rowStaff) {
      const entryId = entryIdByStaff.get(staffId);
      if (!entryId) continue;
      r.payments.forEach((amount, i) => {
        if (!amount) return;
        payValues.push({
          id: uid("sy"),
          entryId,
          date: today(),
          amount,
          method: "Bank Transfer",
          reference: `P${i + 1}`,
          notes: `Imported from Excel (P${i + 1})`,
        });
      });
    }
    for (const part of chunk(payValues, 800)) await db.insert(salaryPayments).values(part);

    await recordActivity({
      actor,
      action: "updated",
      module: "salary",
      entityId: period.id,
      label: `Salary period — ${formatMonthLabel(period.month)}`,
      details: `Imported Excel salary sheet${data.fileName ? ` ${data.fileName}` : ""}: ${rowStaff.length} lines, ${fresh.length} new staff`,
    });
    return {
      lines: rowStaff.length,
      newStaff: fresh.length,
      existingStaff: fills.length,
      skipped,
      payments: payValues.length,
    };
  });

/* ------------------------------------------------------------------ */
/* Import 3: one payroll company's amounts (by NI / ID / name)          */
/* ------------------------------------------------------------------ */

export const importPayrollAmounts = createServerFn({ method: "POST" })
  .validator(
    z.object({
      periodId: z.string(),
      companyId: z.string(),
      keyKind: z.enum(["ni", "rssId", "essId", "name"]),
      mode: z.enum(["replace", "add"]),
      rows: z.array(z.object({ key: z.string(), amount: z.number(), tax: z.number() })).max(3000),
      fileName: z.string().default(""),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("salary", "edit");
    const period = await assertOpen(data.periodId);
    const [company] = await db
      .select()
      .from(payrollCompanies)
      .where(eq(payrollCompanies.id, data.companyId))
      .limit(1);
    if (!company) throw new Error("That payroll company no longer exists.");

    const staffRows = await db.select().from(payrollStaff);
    const lookup = new Map<string, string>();
    const dupName = new Set<string>();
    for (const s of staffRows) {
      const k =
        data.keyKind === "ni"
          ? normNi(s.ni)
          : data.keyKind === "rssId"
            ? s.rssId
            : data.keyKind === "essId"
              ? s.essId
              : normName(s.name);
      if (!k) continue;
      if (lookup.has(k)) dupName.add(k);
      lookup.set(k, s.id);
    }

    const perStaff = new Map<string, { amount: number; tax: number }>();
    const notFound: string[] = [];
    for (const r of data.rows) {
      const k =
        data.keyKind === "ni"
          ? normNi(r.key)
          : data.keyKind === "name"
            ? normName(r.key)
            : r.key.trim();
      if (!k) continue;
      const sid = lookup.get(k);
      if (!sid || dupName.has(k)) {
        if (notFound.length < 50) notFound.push(r.key);
        continue;
      }
      const cur = perStaff.get(sid) ?? { amount: 0, tax: 0 };
      cur.amount += r.amount;
      cur.tax += r.tax;
      perStaff.set(sid, cur);
    }

    // make sure every matched person has a line in this period
    const staffIds = [...perStaff.keys()];
    for (const part of chunk(staffIds, 500)) {
      await db
        .insert(salaryEntries)
        .values(part.map((staffId) => ({ id: uid("se"), periodId: data.periodId, staffId })))
        .onConflictDoNothing();
    }
    for (const part of chunk([...perStaff], 500)) {
      const list = sql.join(
        part.map(
          ([sid, v]) =>
            sql`(${sid}::text, ${round2(v.amount)}::numeric, ${round2(v.tax)}::numeric)`,
        ),
        sql`, `,
      );
      const amountExpr =
        data.mode === "add"
          ? sql`COALESCE((e.payroll ->> ${data.companyId}::text)::numeric, 0) + v.amt`
          : sql`v.amt`;
      await db.execute(sql`
        UPDATE salary_entries e SET
          payroll = e.payroll || jsonb_build_object(${data.companyId}::text, (${amountExpr})),
          tax_deduction = CASE WHEN v.tax <> 0 THEN ${data.mode === "add" ? sql`e.tax_deduction + v.tax` : sql`v.tax`} ELSE e.tax_deduction END
        FROM (VALUES ${list}) AS v(staff_id, amt, tax)
        WHERE e.period_id = ${data.periodId} AND e.staff_id = v.staff_id`);
    }

    await recordActivity({
      actor,
      action: "updated",
      module: "salary",
      entityId: period.id,
      label: `Salary period — ${formatMonthLabel(period.month)}`,
      details: `Imported ${company.name} payroll${data.fileName ? ` from ${data.fileName}` : ""}: ${perStaff.size} staff matched, ${notFound.length} not found`,
    });
    return { matched: perStaff.size, notFound, notFoundCount: notFound.length };
  });
