-- Payroll sheet "Referred by" migration -- run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/payroll-referral-migration.sql).
-- Safe to re-run. The column is NULLABLE with no default, so no existing row is touched.
-- NULL = nobody referred this person on this sheet. If the referrer's staff record is deleted
-- the link is simply cleared (ON DELETE SET NULL).
-- The same statement is also appended to schema/ledgerflow-schema.sql for new installs.

ALTER TABLE payroll_lines
  ADD COLUMN IF NOT EXISTS referred_by_staff_id text REFERENCES payroll_staff(id) ON DELETE SET NULL;
