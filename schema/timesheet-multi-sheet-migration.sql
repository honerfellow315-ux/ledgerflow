-- Timesheet Check: several sheets per person per month, and "accept with a note".
-- Run AFTER timesheets-migration.sql and timesheet-locks-migration.sql. Safe to re-run.
-- Nothing is deleted: existing sheets, rows and locks stay exactly as they are.
BEGIN;

-- 1. A person may now have more than one sheet in a month (weekly sheets, a late
--    correction, ...). The SAME FILE can still only be uploaded once
--    (timesheet_sheets_file_uq stays).
DROP INDEX IF EXISTS timesheet_sheets_person_month_uq;
CREATE INDEX IF NOT EXISTS timesheet_sheets_person_month_idx ON timesheet_sheets (person_key, month);

-- 2. Accepting a difference keeps who, when and why on the row itself.
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS accepted_note text NOT NULL DEFAULT '';
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS accepted_by_name text NOT NULL DEFAULT '';
ALTER TABLE timesheet_rows ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- 2b. A sheet's own stated total can differ from its rows; an approver may accept that too.
--     stated_accepted_key is "<stated>|<rows total>" and lapses when either figure changes.
ALTER TABLE timesheet_sheets ADD COLUMN IF NOT EXISTS stated_accepted_note text NOT NULL DEFAULT '';
ALTER TABLE timesheet_sheets ADD COLUMN IF NOT EXISTS stated_accepted_key text NOT NULL DEFAULT '';
ALTER TABLE timesheet_sheets ADD COLUMN IF NOT EXISTS stated_accepted_by_name text NOT NULL DEFAULT '';
ALTER TABLE timesheet_sheets ADD COLUMN IF NOT EXISTS stated_accepted_at timestamptz;

-- 3. The acceptances themselves. row_key fingerprints the difference, so an acceptance
--    lapses on its own when the sheet or our records change.
CREATE TABLE IF NOT EXISTS timesheet_acceptances (
  id               text PRIMARY KEY,
  staff_id         text NOT NULL REFERENCES payroll_staff(id) ON DELETE CASCADE,
  month            text NOT NULL,
  row_key          text NOT NULL,
  note             text NOT NULL,
  accepted_by      text NOT NULL DEFAULT '',
  accepted_by_name text NOT NULL DEFAULT '',
  accepted_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_acceptances_uq ON timesheet_acceptances (staff_id, month, row_key);

-- A locked month cannot gain or lose acceptances either.
CREATE OR REPLACE FUNCTION guard_timesheet_acceptance_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m text;
BEGIN
  IF TG_OP = 'DELETE' THEN m := OLD.month; ELSE m := NEW.month; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('timesheet-month:' || m));
  IF EXISTS (SELECT 1 FROM timesheet_month_locks WHERE month = m AND locked) THEN
    RAISE EXCEPTION 'Timesheet month % is locked. Reopen it before making changes.', m;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS timesheet_acceptances_month_guard ON timesheet_acceptances;
CREATE TRIGGER timesheet_acceptances_month_guard BEFORE INSERT OR UPDATE OR DELETE ON timesheet_acceptances
  FOR EACH ROW EXECUTE FUNCTION guard_timesheet_acceptance_change();

-- 4. Locking: the "duplicate staff sheets" rule is gone (several sheets are normal now).
--    Every sheet must still be matched to a staff member, compared, complete and ready.
CREATE OR REPLACE FUNCTION set_timesheet_month_lock(month_key text, should_lock boolean, actor_name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('timesheet-month:' || month_key));
  IF should_lock THEN
    IF NOT EXISTS (SELECT 1 FROM timesheet_sheets WHERE month = month_key) THEN
      RAISE EXCEPTION 'There are no timesheets in this month.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM timesheet_sheets s WHERE s.month = month_key AND
      (s.staff_id IS NULL OR s.status <> 'ready' OR s.compared_at IS NULL OR
       s.row_count <> (SELECT count(*) FROM timesheet_rows r WHERE r.sheet_id = s.id))
    ) THEN RAISE EXCEPTION 'Resolve all unmatched, unconfirmed or incomplete sheets before locking this month.'; END IF;
  END IF;
  INSERT INTO timesheet_month_locks(month,locked,changed_by) VALUES(month_key,should_lock,actor_name)
  ON CONFLICT(month) DO UPDATE SET locked=EXCLUDED.locked,changed_by=EXCLUDED.changed_by,changed_at=now();
END $$;

COMMIT;
