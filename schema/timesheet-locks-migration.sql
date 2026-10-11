-- Additive migration. Requires schema/timesheets-migration.sql first.
BEGIN;
CREATE TABLE IF NOT EXISTS timesheet_month_locks (
  month text PRIMARY KEY CHECK (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  locked boolean NOT NULL DEFAULT false,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL DEFAULT ''
);

CREATE OR REPLACE FUNCTION guard_timesheet_month_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE month_key text; old_month text; new_month text;
BEGIN
  IF TG_TABLE_NAME = 'timesheet_sheets' THEN
    IF TG_OP <> 'INSERT' THEN old_month := OLD.month; END IF;
    IF TG_OP <> 'DELETE' THEN new_month := NEW.month; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN SELECT month INTO old_month FROM timesheet_sheets WHERE id = OLD.sheet_id; END IF;
    IF TG_OP <> 'DELETE' THEN SELECT month INTO new_month FROM timesheet_sheets WHERE id = NEW.sheet_id; END IF;
  END IF;
  FOR month_key IN SELECT DISTINCT value FROM unnest(ARRAY[old_month,new_month]) AS value WHERE value IS NOT NULL ORDER BY value LOOP
    PERFORM pg_advisory_xact_lock(hashtext('timesheet-month:' || month_key));
    IF EXISTS (SELECT 1 FROM timesheet_month_locks WHERE month = month_key AND locked) THEN
      RAISE EXCEPTION 'Timesheet month % is locked. Reopen it before making changes.', month_key;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS timesheet_sheets_month_guard ON timesheet_sheets;
CREATE TRIGGER timesheet_sheets_month_guard BEFORE INSERT OR UPDATE OR DELETE ON timesheet_sheets FOR EACH ROW EXECUTE FUNCTION guard_timesheet_month_change();
DROP TRIGGER IF EXISTS timesheet_rows_month_guard ON timesheet_rows;
CREATE TRIGGER timesheet_rows_month_guard BEFORE INSERT OR UPDATE OR DELETE ON timesheet_rows FOR EACH ROW EXECUTE FUNCTION guard_timesheet_month_change();

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
    IF EXISTS (SELECT 1 FROM timesheet_sheets WHERE month = month_key AND staff_id IS NOT NULL GROUP BY staff_id HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'Review duplicate staff sheets before locking this month.';
    END IF;
  END IF;
  INSERT INTO timesheet_month_locks(month,locked,changed_by) VALUES(month_key,should_lock,actor_name)
  ON CONFLICT(month) DO UPDATE SET locked=EXCLUDED.locked,changed_by=EXCLUDED.changed_by,changed_at=now();
END $$;

-- Supports lookup at 10,000+ staff without scanning the entire Staff table.
CREATE INDEX IF NOT EXISTS payroll_staff_timesheet_ni_idx ON payroll_staff ((regexp_replace(upper(ni), '[^A-Z0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS payroll_staff_timesheet_name_idx ON payroll_staff ((trim(regexp_replace(regexp_replace(regexp_replace(lower(name), '[(][^)]*[)]', ' ', 'g'), '[^a-z0-9]+', ' ', 'g'), ' +', ' ', 'g'))));
COMMIT;
