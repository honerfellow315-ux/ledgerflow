-- Timesheet Check: pay (actual hours x rate) and "accept with actual hours + reason".
-- Run ONCE, AFTER timesheet-multi-sheet-migration.sql. Safe to re-run. It only ADDS columns:
-- no existing table, row or acceptance is changed or deleted.
-- Run it BEFORE the new code is deployed.
-- After deploying, press "Check again" on each existing month once, so the pay figures
-- are filled in for sheets that were uploaded before this update.
BEGIN;

-- The hours an approver says were really worked when accepting a difference.
-- NULL = an older acceptance made before this update (it is paid on the hours in our records).
ALTER TABLE timesheet_acceptances ADD COLUMN IF NOT EXISTS actual_hours numeric(10,2);

-- Per row: who/what is being paid.
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS accepted_hours numeric(10,2);
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS pay_rate numeric(12,2);
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS pay_hours numeric(10,2);
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS pay_amount numeric(12,2);

-- Per sheet: the totals the list and the dashboard cards show.
-- NULL = not calculated yet (sheet uploaded before this update; use "Check again").
ALTER TABLE timesheet_sheets ADD COLUMN IF NOT EXISTS pay_hours numeric(10,2);
ALTER TABLE timesheet_sheets ADD COLUMN IF NOT EXISTS pay_amount numeric(12,2);
ALTER TABLE timesheet_sheets ADD COLUMN IF NOT EXISTS open_diff numeric(10,2);

COMMIT;
