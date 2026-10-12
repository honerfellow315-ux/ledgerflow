/**
 * Payslip server functions. A payslip shows the person's NI number, so both the Payroll
 * (view) and Staff (view) permissions are needed, same as seeing NI numbers on the sheet.
 * The figures are read from the Payroll sheet lines, nothing is stored or changed here.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import {
  payrollCompanies,
  payrollLines,
  payrollSheets,
  payrollStaff,
} from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { round2 } from "../payroll/calc";
import { lineTotals } from "../payroll/sheetCalc";
import { payslipIssue, type PayslipRow } from "../payslips/data";

async function requirePayslipAccess() {
  await requirePermission("payroll", "view");
  return requirePermission("staff", "view");
}

const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

export interface PayslipSheetOption {
  sheetId: string;
  companyId: string;
  companyName: string;
  month: string;
  status: string;
  lines: number;
}

/** Every payroll sheet (company x month), newest month first, for the two pickers. */
export const listPayslipSheets = createServerFn({ method: "GET" }).handler(
  async (): Promise<PayslipSheetOption[]> => {
    await requirePayslipAccess();
    const res = await db.execute(sql`
      SELECT s.id, s.company_id, c.name AS company_name, s.month, s.status, count(l.id)::int AS lines
      FROM payroll_sheets s
      JOIN payroll_companies c ON c.id = s.company_id
      LEFT JOIN payroll_lines l ON l.sheet_id = s.id
      GROUP BY s.id, c.name, c.order_index
      ORDER BY s.month DESC, c.order_index, c.name
      LIMIT 600`);
    return (
      res.rows as {
        id: string;
        company_id: string;
        company_name: string;
        month: string;
        status: string;
        lines: number;
      }[]
    ).map((r) => ({
      sheetId: r.id,
      companyId: r.company_id,
      companyName: r.company_name,
      month: r.month,
      status: r.status,
      lines: Number(r.lines),
    }));
  },
);

const lineSelect = {
  id: payrollLines.id,
  name: payrollStaff.name,
  ni: payrollStaff.ni,
  unitsHours: payrollLines.unitsHours,
  bankHolidayHours: payrollLines.bankHolidayHours,
  holidayEntitlement: payrollLines.holidayEntitlement,
  rate: payrollLines.rate,
  holidayRate: payrollLines.holidayRate,
  uniformCost: payrollLines.uniformCost,
  fixedAmount: payrollLines.fixedAmount,
};

function toRow(
  r: {
    id: string;
    name: string;
    ni: string;
    unitsHours: number;
    bankHolidayHours: number;
    holidayEntitlement: number;
    rate: number;
    holidayRate: number | null;
    uniformCost: number;
    fixedAmount: number | null;
  },
  head: { company: string; address: string; month: string },
): PayslipRow {
  return {
    id: r.id,
    name: r.name,
    ni: r.ni,
    company: head.company,
    companyAddress: head.address,
    month: head.month,
    unitsHours: r.unitsHours,
    bankHolidayHours: r.bankHolidayHours,
    holidayEntitlement: r.holidayEntitlement,
    rate: r.rate,
    holidayRate: r.holidayRate,
    uniformCost: r.uniformCost,
    fixedAmount: r.fixedAmount,
  };
}

async function sheetHead(sheetId: string) {
  const [row] = await db
    .select({
      month: payrollSheets.month,
      status: payrollSheets.status,
      company: payrollCompanies.name,
      address: payrollCompanies.address,
    })
    .from(payrollSheets)
    .innerJoin(payrollCompanies, eq(payrollCompanies.id, payrollSheets.companyId))
    .where(eq(payrollSheets.id, sheetId))
    .limit(1);
  if (!row) throw new Error("That payroll sheet no longer exists.");
  return { month: row.month, status: row.status, company: row.company, address: row.address ?? "" };
}

export interface PayslipPage {
  status: string;
  rows: PayslipRow[];
  /** Lines matching the search (for the pager). */
  total: number;
  page: number;
  pageSize: number;
  /** Whole sheet, whatever the search says. */
  summary: { count: number; totalPay: number; totalHours: number; needLook: number };
}

export const listPayslips = createServerFn({ method: "GET" })
  .validator(
    z.object({
      sheetId: z.string().min(1).max(100),
      search: z.string().trim().max(80).default(""),
      page: z.number().int().min(1).max(10000).default(1),
      pageSize: z.number().int().min(5).max(100).default(50),
    }),
  )
  .handler(async ({ data }): Promise<PayslipPage> => {
    await requirePayslipAccess();
    const head = await sheetHead(data.sheetId);

    const parts: SQL[] = [eq(payrollLines.sheetId, data.sheetId)];
    if (data.search) parts.push(ilike(payrollStaff.name, likeOf(data.search)));
    const where = and(...parts);

    const rows = await db
      .select(lineSelect)
      .from(payrollLines)
      .innerJoin(payrollStaff, eq(payrollStaff.id, payrollLines.staffId))
      .where(where)
      .orderBy(asc(payrollStaff.name), asc(payrollLines.id))
      .limit(data.pageSize)
      .offset((data.page - 1) * data.pageSize);

    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(payrollLines)
      .innerJoin(payrollStaff, eq(payrollStaff.id, payrollLines.staffId))
      .where(where);

    // Whole-sheet totals, worked out with the very same arithmetic as the sheet.
    const all = await db
      .select({
        ni: payrollStaff.ni,
        unitsHours: payrollLines.unitsHours,
        bankHolidayHours: payrollLines.bankHolidayHours,
        holidayEntitlement: payrollLines.holidayEntitlement,
        rate: payrollLines.rate,
        holidayRate: payrollLines.holidayRate,
        uniformCost: payrollLines.uniformCost,
        fixedAmount: payrollLines.fixedAmount,
      })
      .from(payrollLines)
      .innerJoin(payrollStaff, eq(payrollStaff.id, payrollLines.staffId))
      .where(eq(payrollLines.sheetId, data.sheetId));
    let pay = 0;
    let hours = 0;
    let needLook = 0;
    for (const l of all) {
      const t = lineTotals(l);
      pay += t.amount;
      hours += t.totalHours;
      if (
        payslipIssue(toRow({ id: "", name: "", ...l }, { company: "", address: "", month: "" })) !==
        null
      )
        needLook++;
    }

    return {
      status: head.status,
      rows: rows.map((r) => toRow(r, head)),
      total: count?.n ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      summary: { count: all.length, totalPay: round2(pay), totalHours: round2(hours), needLook },
    };
  });

/** Payslips for the printout: picked ids, or the whole sheet a slice at a time. */
export const getPayslipsForPrint = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sheetId: z.string().min(1).max(100),
      /** Line ids. Empty = every line of the sheet (use offset / limit). */
      ids: z.array(z.string().max(100)).max(100).default([]),
      offset: z.number().int().min(0).max(100000).default(0),
      limit: z.number().int().min(1).max(100).default(50),
    }),
  )
  .handler(async ({ data }): Promise<PayslipRow[]> => {
    await requirePayslipAccess();
    const head = await sheetHead(data.sheetId);
    const where =
      data.ids.length > 0
        ? and(eq(payrollLines.sheetId, data.sheetId), inArray(payrollLines.id, data.ids))
        : eq(payrollLines.sheetId, data.sheetId);
    const rows = await db
      .select(lineSelect)
      .from(payrollLines)
      .innerJoin(payrollStaff, eq(payrollStaff.id, payrollLines.staffId))
      .where(where)
      .orderBy(asc(payrollStaff.name), asc(payrollLines.id))
      .limit(data.ids.length > 0 ? 100 : data.limit)
      .offset(data.ids.length > 0 ? 0 : data.offset);
    return rows.map((r) => toRow(r, head));
  });
