import { createServerFn } from "@tanstack/react-start";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { requirePermission } from "../server/auth";
import { round2 } from "../payroll/calc";

export interface DashboardPayrollCompany {
  id: string;
  name: string;
  active: boolean;
  /** null = this company has no payroll sheet for the month yet */
  status: string | null;
  lines: number;
  hours: number;
  amount: number;
}

export interface DashboardPayrollHours {
  /** yyyy-mm shown ("" when there is no payroll sheet at all) */
  month: string;
  /** the most recent months that have at least one payroll sheet, newest first */
  months: string[];
  companies: DashboardPayrollCompany[];
  totalHours: number;
  totalAmount: number;
}

/**
 * Dashboard card: hours + pay per payroll company for one month. Reads the same
 * payroll sheets / lines as the Payroll Sheet screen (Total Hours = units + bank
 * holiday, same Amount formula as listPayrollSheets); nothing is written.
 */
export const dashboardPayrollHours = createServerFn({ method: "GET" })
  .validator(
    z.object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .nullable()
        .default(null),
    }),
  )
  .handler(async ({ data }): Promise<DashboardPayrollHours> => {
    await requirePermission("payroll", "view");
    const monthsRes = await db.execute(
      sql`SELECT DISTINCT month FROM payroll_sheets ORDER BY month DESC LIMIT 6`,
    );
    const months = (monthsRes.rows as { month: string }[]).map((r) => r.month);
    const month = data.month && months.includes(data.month) ? data.month : (months[0] ?? "");
    if (!month) return { month: "", months, companies: [], totalHours: 0, totalAmount: 0 };

    const res = await db.execute(sql`
      SELECT c.id, c.name, c.active, s.status,
             count(l.id)::int AS lines,
             COALESCE(sum(l.units_hours + l.bank_holiday_hours), 0)::float AS hours,
             COALESCE(sum(COALESCE(l.fixed_amount, round((l.units_hours + l.bank_holiday_hours) * l.rate + CASE WHEN l.holiday_rate IS NULL THEN 0 ELSE l.holiday_entitlement * l.holiday_rate END, 2))), 0)::float AS amount
      FROM payroll_companies c
      LEFT JOIN payroll_sheets s ON s.company_id = c.id AND s.month = ${month}
      LEFT JOIN payroll_lines l ON l.sheet_id = s.id
      GROUP BY c.id, c.name, c.active, c.order_index, s.id, s.status
      ORDER BY c.order_index, c.name`);
    const companies = (
      res.rows as {
        id: string;
        name: string;
        active: boolean;
        status: string | null;
        lines: number;
        hours: number;
        amount: number;
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
      status: r.status,
      lines: Number(r.lines),
      hours: round2(Number(r.hours)),
      amount: round2(Number(r.amount)),
    }));
    return {
      month,
      months,
      companies,
      totalHours: round2(companies.reduce((t, c) => t + c.hours, 0)),
      totalAmount: round2(companies.reduce((t, c) => t + c.amount, 0)),
    };
  });
