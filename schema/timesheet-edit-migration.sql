-- Timesheet Check: edit a shift's hours / rate straight from the sheet.
-- Run ONCE, AFTER timesheet-pay-migration.sql. Safe to re-run. It only ADDS columns.
-- Run it BEFORE the new code is deployed.
BEGIN;

-- Which of OUR shifts (salary_shifts) this row was paired with, so an edit can update it.
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS record_shift_id text;

-- A person's own correction of this row. NULL = not edited.
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS edit_hours numeric(10,2);
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS edit_rate numeric(12,2);
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS edit_note text NOT NULL DEFAULT '';
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS edited_by_name text NOT NULL DEFAULT '';
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS edited_at timestamptz;

COMMIT;
