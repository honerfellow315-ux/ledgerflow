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

/**
 * When the site name on the sheet is written differently from our record (guards type
 * "Wickes", the shift system says "Wickes Building Supplies, Wallsend") but there is only
 * ONE shift on that date and the hours agree, is the row still a clean match?
 *   false (default) = yes, it stays a match and the note mentions the different site name.
 *   true            = no, it becomes "Check the reading".
 * With several shifts on one date the site is still used to tell them apart and a
 * different site still needs a look, whatever this is set to.
 */
export const SITE_DIFFERENCE_BLOCKS_MATCH_ON_SINGLE_SHIFT_DAY = false;
