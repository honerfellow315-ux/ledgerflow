/**
 * The ONE place for the Timesheet Check rules the owner may want to change later.
 *
 * HOURS_TOLERANCE_MINUTES: how far a sheet row's hours may be from our record and still
 * count as a match. 0 = strict (the sheet must say exactly what our record says).
 * Set it to 15 to accept up to a quarter of an hour of difference.
 * After changing it, use "Check again" on the Timesheet Check screen so saved sheets
 * are compared with the new rule.
 */
export const HOURS_TOLERANCE_MINUTES = 0;
