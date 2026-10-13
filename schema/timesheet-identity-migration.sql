-- Apply before deploying the timesheet identity update. Existing records are retained.
ALTER TABLE timesheet_sheets ADD COLUMN IF NOT EXISTS person_dob text NOT NULL DEFAULT '';
