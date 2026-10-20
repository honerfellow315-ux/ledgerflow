import { MAX_EXPENSES, type SalaryExpense } from "./types";
import { parseAmount } from "./queries";

/** One expense as typed in the form (text, so a half-typed number never jumps). */
export interface ExpenseDraft {
  amount: string;
  note: string;
}

/** Saved expenses -> form rows. Always at least one row, so there is a box to type in. */
export function toExpenseDrafts(list: readonly SalaryExpense[] | undefined | null): ExpenseDraft[] {
  const rows = (list ?? []).map((x) => ({
    amount: x.amount === 0 ? "" : String(x.amount),
    note: x.note ?? "",
  }));
  return rows.length ? rows : [{ amount: "", note: "" }];
}

/** Form rows -> what is saved. Empty / zero rows are dropped, so "no expenses" = []. */
export function fromExpenseDrafts(rows: readonly ExpenseDraft[]): SalaryExpense[] {
  return rows
    .map((r) => ({ amount: parseAmount(r.amount), note: r.note.trim() }))
    .filter((r) => r.amount !== 0)
    .slice(0, MAX_EXPENSES)
    .map((r) => (r.note ? { amount: r.amount, note: r.note } : { amount: r.amount }));
}
