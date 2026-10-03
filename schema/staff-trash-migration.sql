-- Staff recycle-bin migration — run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/staff-trash-migration.sql).
-- Safe to re-run (IF NOT EXISTS). It only ADDS a new table; no existing table,
-- column or row is touched.
--
-- When a staff profile is deleted, a full snapshot of it (the profile plus its
-- company links, payroll lines, salary lines, cash payments and the ids of its
-- imported shifts) is stored here first, so the Recycle Bin can bring it back.

CREATE TABLE IF NOT EXISTS staff_trash (
  id          text PRIMARY KEY,
  staff_id    text NOT NULL,
  name        text NOT NULL,
  snapshot    jsonb NOT NULL,
  deleted_by  text NOT NULL DEFAULT '',
  deleted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_trash_staff_idx ON staff_trash (staff_id);
