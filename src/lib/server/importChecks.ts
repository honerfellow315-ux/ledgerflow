/**
 * The "Check data" report of a salary month: what was imported per shift
 * company and what needs a person's eyes. Read-only; no auth here (the action
 * in actions/salary.ts checks permissions), so it can run against a test DB.
 */
import { sql } from "drizzle-orm";
import type { ImportCheckIssue, ImportCheckReport } from "../payroll/types";
import { shiftProblems, shiftStats, sheetSourceTotals } from "./salaryShifts";
import type { Db } from "./shiftImport";

const money = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const names = (rows: Record<string, unknown>[], key: string) =>
  rows.map((r) => String(r[key] ?? "").trim()).filter(Boolean);

export async function buildImportChecks(db: Db, periodId: string, month: string): Promise<ImportCheckReport> {
  const stats = await shiftStats(db, periodId, month);
  const summary = stats.map((s) => ({
    source: s.source,
    shifts: s.shifts,
    people: s.people,
    hours: s.hours,
    amount: s.amount,
  }));
  if (stats.length === 0) return { summary, issues: [] };

  const issues: ImportCheckIssue[] = [];
  const sum = (pick: (s: (typeof stats)[number]) => number) => stats.reduce((t, s) => t + pick(s), 0);

  // 1) shifts nobody could be matched to — their money is on no salary line
  const unmatched = sum((s) => s.unmatchedShifts);
  if (unmatched > 0) {
    const ex = await db.execute(sql`
      SELECT DISTINCT coalesce(nullif(employee_name, ''), employee_id) AS n
      FROM salary_shifts WHERE period_id = ${periodId} AND staff_id IS NULL
      ORDER BY 1 LIMIT 5`);
    issues.push({
      level: "error",
      code: "unmatched",
      title: "Shifts not matched to any staff member",
      count: unmatched,
      hint: `${money(sum((s) => s.unmatchedAmount))} is not on any salary line. Fix the staff record (ID / NI / name) or re-import with "create missing staff".`,
      examples: names(ex.rows as Record<string, unknown>[], "n"),
    });
  }

  // 2) what the sheet carries vs what the matched shifts add up to
  const sheet = await sheetSourceTotals(db, periodId);
  const diffs: string[] = [];
  for (const s of stats) {
    const onSheet = sheet[s.source]?.amount ?? 0;
    if (Math.abs(onSheet - s.matchedAmount) > 0.01) {
      diffs.push(`${s.source}: sheet ${money(onSheet)} vs shifts ${money(s.matchedAmount)}`);
    }
  }
  if (diffs.length > 0) {
    issues.push({
      level: "error",
      code: "sheet-mismatch",
      title: "Salary lines differ from the imported shifts",
      count: diffs.length,
      hint: "A line was edited by hand or the import did not finish. Re-import that company's file to rebuild the lines.",
      examples: diffs,
    });
  }

  // 3) hours but no rate => £0
  const noRate = sum((s) => s.noRateShifts);
  if (noRate > 0) {
    const ex = await db.execute(sql`
      SELECT DISTINCT coalesce(nullif(employee_name, ''), employee_id) AS n
      FROM salary_shifts WHERE period_id = ${periodId} AND hours > 0 AND amount = 0
      ORDER BY 1 LIMIT 5`);
    issues.push({
      level: "warn",
      code: "no-rate",
      title: "Shifts with hours but no pay rate (£0)",
      count: noRate,
      hint: `${sum((s) => s.noRateHours)} hours will pay nothing. The rate is empty in the file — ask for it to be filled and re-import.`,
      examples: names(ex.rows as Record<string, unknown>[], "n"),
    });
  }

  // 4) dates outside the month being paid
  const outside = sum((s) => s.outsideMonthShifts);
  if (outside > 0) {
    const ex = await db.execute(sql`
      SELECT DISTINCT date AS d FROM salary_shifts
      WHERE period_id = ${periodId} AND substr(date, 1, 7) <> ${month} ORDER BY 1 LIMIT 5`);
    issues.push({
      level: "warn",
      code: "outside-month",
      title: "Shifts dated outside this month",
      count: outside,
      hint: "The file may belong to a different month's sheet.",
      examples: names(ex.rows as Record<string, unknown>[], "d"),
    });
  }

  // 5) exact duplicates, and people who worked but earn nothing
  const problems = await shiftProblems(db, periodId);
  if (problems.duplicateShifts > 0) {
    issues.push({
      level: "warn",
      code: "duplicates",
      title: "Possible duplicate shifts",
      count: problems.duplicateShifts,
      hint: "Same person, date, site, hours and amount appear more than once. Check the file was not exported twice.",
      examples: [],
    });
  }
  if (problems.zeroPayPeople.length > 0) {
    issues.push({
      level: "warn",
      code: "zero-pay",
      title: "People who worked but earn £0",
      count: problems.zeroPayPeople.length,
      hint: "Usually a missing pay rate.",
      examples: problems.zeroPayPeople.slice(0, 5),
    });
  }
  return { summary, issues };
}
