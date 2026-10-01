-- Staff details migration ("All Payroll Format" fields) — run ONCE on an existing
-- LedgerFlow database (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/staff-details-migration.sql).
-- Safe to re-run: every column is ADD COLUMN IF NOT EXISTS. All columns are NULLABLE
-- with no default, so no existing row or value is touched. Dates are yyyy-mm-dd text;
-- age is never stored (computed from dob). The existing account_detail column stays as is.
-- The same statement is also appended to schema/ledgerflow-schema.sql for new installs.

ALTER TABLE payroll_staff
  ADD COLUMN IF NOT EXISTS dob                   text,
  ADD COLUMN IF NOT EXISTS gender                text,
  ADD COLUMN IF NOT EXISTS rtw_share_code        text,
  ADD COLUMN IF NOT EXISTS share_code_expiry     text,
  ADD COLUMN IF NOT EXISTS address               text,
  ADD COLUMN IF NOT EXISTS town                  text,
  ADD COLUMN IF NOT EXISTS post_code             text,
  ADD COLUMN IF NOT EXISTS uniform               text,
  ADD COLUMN IF NOT EXISTS account_holder_name   text,
  ADD COLUMN IF NOT EXISTS account_number        text,
  ADD COLUMN IF NOT EXISTS sort_code             text,
  ADD COLUMN IF NOT EXISTS employment_start_date text,
  ADD COLUMN IF NOT EXISTS employment_end_date   text,
  ADD COLUMN IF NOT EXISTS contract_status       text,  -- Active | P45 | Need P45
  ADD COLUMN IF NOT EXISTS email                 text,
  ADD COLUMN IF NOT EXISTS immigration_status    text,
  ADD COLUMN IF NOT EXISTS hours_allowed         text,
  ADD COLUMN IF NOT EXISTS sia_number            text,
  ADD COLUMN IF NOT EXISTS role                  text,
  ADD COLUMN IF NOT EXISTS service_type          text;
