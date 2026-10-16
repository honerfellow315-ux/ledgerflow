/**
 * What one timesheet row is paid. Pure logic (no database), so it can be tested on its own.
 *
 *   - the row matches our records            -> paid on the record hours
 *   - the difference was accepted with an
 *     actual-hours figure                    -> paid on those actual hours
 *   - accepted before "actual hours" existed -> paid on the record hours (nothing paid when
 *                                               there is no record shift for the row)
 *   - the difference is NOT accepted yet     -> nothing is paid yet (the row is "pending")
 *
 * The rate is the rate of the record shift. Only when the row has no record shift is the
 * rate written on the sheet used, and then the staff member's rate for the month.
 */
export interface RowPayInput {
  result: string;
  sheetHours: number | null;
  recordHours: number | null;
  /** Rate of the paired record shift (null = none). */
  recordRate: number | null | undefined;
  /** Rate written on the sheet itself (null = none). */
  sheetRate: number | null | undefined;
  /** The staff member's rate in our records for this month, used when nothing else is known. */
  fallbackRate: number;
  accepted: boolean;
  /** Hours the approver typed when accepting (null = older acceptance). */
  actualHours: number | null;
  /** A person edited this row by hand: these hours win over everything (null = not edited). */
  editHours?: number | null;
  /** A person edited this row's rate by hand (null = not edited). */
  editRate?: number | null;
}

export interface RowPay {
  rate: number;
  hours: number;
  amount: number;
  /** A difference that nobody has accepted yet: nothing is paid for the row. */
  pending: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const positive = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

export function payForRow(a: RowPayInput): RowPay {
  const edited = typeof a.editRate === "number" && Number.isFinite(a.editRate) && a.editRate >= 0;
  const rate = edited
    ? (a.editRate as number)
    : positive(a.recordRate)
      ? a.recordRate
      : positive(a.sheetRate)
        ? a.sheetRate
        : a.fallbackRate;
  let hours = 0;
  let pending = false;
  if (typeof a.editHours === "number" && Number.isFinite(a.editHours)) {
    // A hand edit settles the row: it is paid on exactly these hours.
    hours = a.editHours;
  } else if (a.result === "match") {
    hours = a.recordHours ?? a.sheetHours ?? 0;
  } else if (a.accepted) {
    if (a.actualHours !== null) hours = a.actualHours;
    else hours = a.result === "not_in_records" ? 0 : (a.recordHours ?? 0);
  } else {
    pending = true;
  }
  hours = round2(Math.max(0, hours));
  return { rate: round2(rate), hours, amount: round2(hours * rate), pending };
}
