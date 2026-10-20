/**
 * Timesheet Check: editing a shift by hand, paying a staff member, and their account details.
 * Free of auth / request handling (same idea as timesheetCheck.ts); actions/timesheets.ts
 * checks who is asking and then calls these.
 *
 * ONE edit changes everything that depends on that shift:
 *   1. the timesheet row (its hours / rate win, the row is settled, pay is calculated on them),
 *   2. OUR shift record (salary_shifts: hours, rate, amount), so the Salary Sheet, the payroll
 *      columns and every report that reads shifts show the same figures,
 *   3. the Salary Sheet line of that month (recomputed from the shifts).
 * A payment (cash, bank transfer ...) is written as a normal Salary Sheet payment (P1, P2 ...),
 * so it shows up there and in the carry-forward as well.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  payrollStaff,
  salaryEntries,
  salaryPayments,
  salaryPeriods,
  salaryShifts,
  timesheetRows,
  timesheetSheets,
} from "../../../drizzle/schema";
import { expensesEffect, expensesTotal, formatMonthLabel, round2 } from "../payroll/calc";
import { MAX_EXPENSES, type SalaryExpense } from "../payroll/types";
import { uid } from "./id";
import { recomputeFromShifts } from "./salaryShifts";
import type { Db } from "./shiftImport";
import { recomputeStaffMonth } from "./timesheetCheck";
import { assertTimesheetMonthOpen } from "./timesheetLocks";

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Cheque", "Other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

async function periodByMonth(db: Db, month: string) {
  const [p] = await db.select().from(salaryPeriods).where(eq(salaryPeriods.month, month)).limit(1);
  return p;
}

function assertPeriodOpen(p: { status: string; month: string }) {
  if (p.status === "closed") {
    throw new Error(
      `${formatMonthLabel(p.month)} is closed in the Salary Sheet. Reopen it there to make changes.`,
    );
  }
}

/* ------------------------------ edit one row ------------------------------ */

export interface EditRowResult {
  sheetId: string;
  month: string;
  label: string;
  /** false = the timesheet was saved, but there was no Salary Sheet month / shift company to update. */
  salaryUpdated: boolean;
  salaryNote: string;
}

export async function editRow(
  db: Db,
  a: {
    rowId: string;
    hours: number;
    rate: number;
    note: string;
    actor: { id: string; name: string };
  },
): Promise<EditRowResult> {
  if (!Number.isFinite(a.hours) || a.hours < 0 || a.hours > 24)
    throw new Error("Hours must be between 0 and 24.");
  if (!Number.isFinite(a.rate) || a.rate < 0 || a.rate > 1000)
    throw new Error("Write a rate between 0 and 1000.");
  const hours = round2(a.hours);
  const rate = round2(a.rate);

  const [row] = await db.select().from(timesheetRows).where(eq(timesheetRows.id, a.rowId)).limit(1);
  if (!row) throw new Error("That row no longer exists.");
  if (row.note.startsWith("Counted once"))
    throw new Error("This row is the same as a row on an earlier sheet. Edit it there.");
  const [sheet] = await db
    .select()
    .from(timesheetSheets)
    .where(eq(timesheetSheets.id, row.sheetId))
    .limit(1);
  if (!sheet) throw new Error("That sheet no longer exists.");
  if (!sheet.staffId) throw new Error("Match this sheet to a staff member first.");
  const staffId = sheet.staffId;
  await assertTimesheetMonthOpen(db, sheet.month);

  const label = `${row.date} ${row.site}`.trim();
  let salaryUpdated = false;
  let salaryNote = "";
  let shiftId = row.recordShiftId;
  const amount = round2(hours * rate);

  if (shiftId) {
    const [shift] = await db
      .select({ id: salaryShifts.id, periodId: salaryShifts.periodId })
      .from(salaryShifts)
      .where(eq(salaryShifts.id, shiftId))
      .limit(1);
    if (!shift) {
      shiftId = null; // the shift was deleted since the last check: treat the row as "no shift"
    } else {
      const [period] = await db
        .select()
        .from(salaryPeriods)
        .where(eq(salaryPeriods.id, shift.periodId))
        .limit(1);
      if (period) assertPeriodOpen(period);
      await db
        .update(salaryShifts)
        .set({ hours, rate, amount })
        .where(eq(salaryShifts.id, shift.id));
      await recomputeFromShifts(db, shift.periodId);
      salaryUpdated = true;
    }
  }

  if (!shiftId) {
    // No shift in our records for this row yet. Create one so the Salary Sheet gets the hours.
    const period = await periodByMonth(db, sheet.month);
    if (!period) {
      salaryNote = `There is no Salary Sheet for ${formatMonthLabel(sheet.month)} yet, so only the timesheet was changed.`;
    } else if (hours > 0) {
      assertPeriodOpen(period);
      const [person] = await db
        .select()
        .from(payrollStaff)
        .where(eq(payrollStaff.id, staffId))
        .limit(1);
      const used = await db.execute(sql`
        SELECT source FROM salary_shifts
        WHERE period_id = ${period.id} AND staff_id = ${staffId}
        GROUP BY source ORDER BY count(*) DESC LIMIT 1`);
      let source = String((used.rows[0] as { source?: string } | undefined)?.source ?? "");
      let employeeId = "";
      if (!source) {
        if (person?.rssId) source = "RSS";
        else if (person?.essId) source = "ESS";
        else {
          const first = Object.entries(person?.extIds ?? {}).find(([, v]) => v !== "");
          if (first) source = first[0];
        }
      }
      if (!source) {
        salaryNote =
          "This person has no shift company (RSS / ESS / other) yet, so only the timesheet was changed.";
      } else {
        employeeId =
          source === "RSS"
            ? (person?.rssId ?? "")
            : source === "ESS"
              ? (person?.essId ?? "")
              : (person?.extIds?.[source] ?? "");
        shiftId = uid("ss");
        await db.insert(salaryShifts).values({
          id: shiftId,
          periodId: period.id,
          source,
          staffId,
          employeeId,
          employeeName: person?.name ?? sheet.personName,
          ni: person?.ni ?? "",
          date: row.date,
          clientName: "",
          siteName: row.site,
          hours,
          rate,
          amount,
          expenses: 0,
          penalty: 0,
        });
        await recomputeFromShifts(db, period.id);
        salaryUpdated = true;
      }
    } else {
      salaryNote = "0 hours: nothing was added to the Salary Sheet.";
    }
  }

  await db
    .update(timesheetRows)
    .set({
      editHours: hours,
      editRate: rate,
      editNote: a.note.trim().slice(0, 500),
      editedByName: a.actor.name,
      editedAt: new Date(),
      ...(shiftId ? { recordShiftId: shiftId } : {}),
    })
    .where(eq(timesheetRows.id, row.id));
  await recomputeStaffMonth(db, staffId, sheet.month);
  return { sheetId: sheet.id, month: sheet.month, label, salaryUpdated, salaryNote };
}

/* ------------------------------ paying the person ------------------------------ */

export interface PaymentLine {
  id: string;
  date: string;
  amount: number;
  method: string;
  reference: string;
  notes: string;
}

export interface StaffMonthPay {
  month: string;
  /** false = no Salary Sheet for this month yet, so a payment cannot be added. */
  hasSalaryMonth: boolean;
  salaryClosed: boolean;
  /** What is to be paid: the hours' pay plus the expenses (as EXPENSES_EFFECT says). */
  payable: number;
  /** Of which: the expenses typed for this person and month (0 = none). */
  expensesTotal: number;
  expenses: SalaryExpense[];
  paid: number;
  balance: number;
  payments: PaymentLine[];
}

/** Expenses as stored in the database -> a clean list. */
export function cleanExpenseList(list: unknown): SalaryExpense[] {
  return (Array.isArray(list) ? list : [])
    .map((x) => {
      const amount = Number((x as { amount?: unknown } | null)?.amount);
      const note = String((x as { note?: unknown } | null)?.note ?? "").trim();
      return Number.isFinite(amount) ? { amount, ...(note ? { note } : {}) } : null;
    })
    .filter((x): x is SalaryExpense => x !== null)
    .slice(0, MAX_EXPENSES);
}

export async function getStaffMonthPay(
  db: Db,
  staffId: string,
  month: string,
): Promise<StaffMonthPay> {
  const sums = await db.execute(sql`
    SELECT coalesce(sum(pay_amount), 0)::float8 AS payable
    FROM timesheet_sheets WHERE staff_id = ${staffId} AND month = ${month}`);
  const hoursPay = round2(Number((sums.rows[0] as { payable?: number } | undefined)?.payable ?? 0));
  const period = await periodByMonth(db, month);
  let payments: PaymentLine[] = [];
  let expenses: SalaryExpense[] = [];
  if (period) {
    const [entry] = await db
      .select({ id: salaryEntries.id, expenses: salaryEntries.expenses })
      .from(salaryEntries)
      .where(and(eq(salaryEntries.periodId, period.id), eq(salaryEntries.staffId, staffId)))
      .limit(1);
    if (entry) {
      expenses = cleanExpenseList(entry.expenses);
      const rows = await db
        .select()
        .from(salaryPayments)
        .where(eq(salaryPayments.entryId, entry.id))
        .orderBy(desc(salaryPayments.date));
      payments = rows.map((r) => ({
        id: r.id,
        date: r.date,
        amount: r.amount,
        method: r.method,
        reference: r.reference,
        notes: r.notes ?? "",
      }));
    }
  }
  const paid = round2(payments.reduce((t, p) => t + p.amount, 0));
  const payable = round2(hoursPay + expensesEffect({ expenses }));
  return {
    month,
    hasSalaryMonth: Boolean(period),
    salaryClosed: period?.status === "closed",
    payable,
    expensesTotal: expensesTotal({ expenses }),
    expenses,
    paid,
    balance: round2(payable - paid),
    payments,
  };
}

export async function addStaffPayment(
  db: Db,
  a: {
    staffId: string;
    month: string;
    date: string;
    amount: number;
    method: PaymentMethod;
    reference: string;
    notes: string;
  },
): Promise<{ id: string }> {
  if (!Number.isFinite(a.amount) || a.amount <= 0) throw new Error("Write an amount above 0.");
  const period = await periodByMonth(db, a.month);
  if (!period)
    throw new Error(
      `There is no Salary Sheet for ${formatMonthLabel(a.month)} yet. Create it in Salary Sheet first.`,
    );
  assertPeriodOpen(period);
  let [entry] = await db
    .select({ id: salaryEntries.id })
    .from(salaryEntries)
    .where(and(eq(salaryEntries.periodId, period.id), eq(salaryEntries.staffId, a.staffId)))
    .limit(1);
  if (!entry) {
    const id = uid("se");
    await db
      .insert(salaryEntries)
      .values({ id, periodId: period.id, staffId: a.staffId })
      .onConflictDoNothing();
    [entry] = await db
      .select({ id: salaryEntries.id })
      .from(salaryEntries)
      .where(and(eq(salaryEntries.periodId, period.id), eq(salaryEntries.staffId, a.staffId)))
      .limit(1);
  }
  if (!entry) throw new Error("Could not find this person's Salary Sheet line.");
  const id = uid("sy");
  await db.insert(salaryPayments).values({
    id,
    entryId: entry.id,
    date: a.date,
    amount: round2(a.amount),
    method: a.method,
    reference: a.reference.trim().slice(0, 120),
    notes: a.notes.trim().slice(0, 300) || null,
  });
  return { id };
}

/**
 * Saves the expenses of a person for a month on their Salary Sheet line (the same place the
 * Salary Sheet form reads), so both screens always show the same expenses.
 */
export async function saveStaffExpenses(
  db: Db,
  a: {
    staffId: string;
    month: string;
    expenses: readonly { amount: number; note?: string | undefined }[];
  },
): Promise<{ total: number }> {
  const period = await periodByMonth(db, a.month);
  if (!period)
    throw new Error(
      `There is no Salary Sheet for ${formatMonthLabel(a.month)} yet. Create it in Salary Sheet first.`,
    );
  assertPeriodOpen(period);
  const list = cleanExpenseList(a.expenses).filter((x) => x.amount !== 0);
  await db
    .insert(salaryEntries)
    .values({ id: uid("se"), periodId: period.id, staffId: a.staffId })
    .onConflictDoNothing();
  await db
    .update(salaryEntries)
    .set({ expenses: list })
    .where(and(eq(salaryEntries.periodId, period.id), eq(salaryEntries.staffId, a.staffId)));
  return { total: expensesTotal({ expenses: list }) };
}

export async function deleteStaffPayment(db: Db, staffId: string, paymentId: string) {
  const [p] = await db
    .select({ id: salaryPayments.id, entryId: salaryPayments.entryId })
    .from(salaryPayments)
    .where(eq(salaryPayments.id, paymentId))
    .limit(1);
  if (!p) return;
  const [entry] = await db
    .select({ staffId: salaryEntries.staffId, periodId: salaryEntries.periodId })
    .from(salaryEntries)
    .where(eq(salaryEntries.id, p.entryId))
    .limit(1);
  if (!entry || entry.staffId !== staffId) throw new Error("This payment is not this person's.");
  const [period] = await db
    .select()
    .from(salaryPeriods)
    .where(eq(salaryPeriods.id, entry.periodId))
    .limit(1);
  if (period) assertPeriodOpen(period);
  await db.delete(salaryPayments).where(eq(salaryPayments.id, paymentId));
}

/* ------------------------------ account details ------------------------------ */

export interface AccountDetails {
  accountHolderName: string;
  accountNumber: string;
  sortCode: string;
}

export async function getAccountDetails(db: Db, staffId: string): Promise<AccountDetails | null> {
  const [p] = await db
    .select({
      accountHolderName: payrollStaff.accountHolderName,
      accountNumber: payrollStaff.accountNumber,
      sortCode: payrollStaff.sortCode,
    })
    .from(payrollStaff)
    .where(eq(payrollStaff.id, staffId))
    .limit(1);
  if (!p) return null;
  return {
    accountHolderName: p.accountHolderName ?? "",
    accountNumber: p.accountNumber ?? "",
    sortCode: p.sortCode ?? "",
  };
}

/** Saves the bank details on the Staff record, so Staff, Payroll and Salary Sheet all show them. */
export async function saveAccountDetails(
  db: Db,
  staffId: string,
  d: AccountDetails,
): Promise<void> {
  const holder = d.accountHolderName.trim();
  const number = d.accountNumber.replace(/\s+/g, "");
  const sort = d.sortCode.trim();
  if (number && !/^\d{6,10}$/.test(number))
    throw new Error("The account number is 6 to 10 digits.");
  if (sort && !/^\d{2}[- ]?\d{2}[- ]?\d{2}$/.test(sort))
    throw new Error("The sort code looks like 12-34-56.");
  const digits = sort.replace(/\D/g, "");
  const sortNice =
    digits.length === 6 ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}` : "";
  await db
    .update(payrollStaff)
    .set({
      accountHolderName: holder || null,
      accountNumber: number || null,
      sortCode: sortNice || null,
      // The one-line "Name 12345678 12-34-56" text the Salary Sheet shows.
      accountDetail: [holder, number, sortNice].filter(Boolean).join(" "),
    })
    .where(eq(payrollStaff.id, staffId));
}
