-- Timesheet Check (Phase B) migration — run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/timesheets-migration.sql).
-- Safe to re-run (IF NOT EXISTS). It only ADDS two new tables and their indexes;
-- no existing table, column or row is touched.
-- Run it BEFORE the new code is deployed.

CREATE TABLE IF NOT EXISTS timesheet_sheets (
  id                  text PRIMARY KEY,
  month               text NOT NULL,
  file_name           text NOT NULL,
  sheet_label         text NOT NULL DEFAULT '',
  file_hash           text NOT NULL,
  format              text NOT NULL DEFAULT 'excel',
  uploaded_by         text NOT NULL DEFAULT '',
  uploaded_by_name    text NOT NULL DEFAULT '',
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  staff_id            text REFERENCES payroll_staff(id) ON DELETE SET NULL,
  matched_by          text NOT NULL DEFAULT 'none',
  staff_confirmed_at  timestamptz,
  person_name         text NOT NULL DEFAULT '',
  person_ni           text NOT NULL DEFAULT '',
  person_key          text NOT NULL,
  stated_hours        numeric(10,2),
  sheet_hours         numeric(10,2) NOT NULL DEFAULT 0,
  record_hours        numeric(10,2) NOT NULL DEFAULT 0,
  row_count           integer NOT NULL DEFAULT 0,
  issue_count         integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'needs_review',
  read_note           text,
  compared_at         timestamptz
);

-- One sheet per person per month, and the same file content only once.
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_sheets_person_month_uq ON timesheet_sheets (person_key, month);
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_sheets_file_uq ON timesheet_sheets (file_hash, sheet_label);
CREATE INDEX IF NOT EXISTS timesheet_sheets_month_idx ON timesheet_sheets (month, uploaded_at);
CREATE INDEX IF NOT EXISTS timesheet_sheets_staff_idx ON timesheet_sheets (staff_id);

CREATE TABLE IF NOT EXISTS timesheet_rows (
  id            text PRIMARY KEY,
  sheet_id      text NOT NULL REFERENCES timesheet_sheets(id) ON DELETE CASCADE,
  line_no       integer NOT NULL DEFAULT 0,
  from_records  boolean NOT NULL DEFAULT false,
  date          text NOT NULL DEFAULT '',
  site          text NOT NULL DEFAULT '',
  site_alt      text NOT NULL DEFAULT '',
  start_time    text NOT NULL DEFAULT '',
  end_time      text NOT NULL DEFAULT '',
  sheet_hours   numeric(10,2),
  rate          numeric(12,2),
  amount        numeric(12,2),
  expense       numeric(12,2),
  uncertain     boolean NOT NULL DEFAULT false,
  parse_note    text NOT NULL DEFAULT '',
  record_hours  numeric(10,2),
  result        text NOT NULL DEFAULT 'check_reading',
  note          text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS timesheet_rows_sheet_idx ON timesheet_rows (sheet_id, line_no);
