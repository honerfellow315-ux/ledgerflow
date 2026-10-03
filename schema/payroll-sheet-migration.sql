-- Payroll sheet ("All Payroll Format") migration — run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/payroll-sheet-migration.sql).
-- Safe to re-run: everything is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS. No existing row or
-- value is touched. Requires schema/salary-migration.sql + schema/staff-details-migration.sql first.
-- The same statements are also appended to schema/ledgerflow-schema.sql for new installs.

/* ---------- Payroll companies: rate + print details ---------- */
ALTER TABLE payroll_companies
  ADD COLUMN IF NOT EXISTS default_rate numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS address      text,
  ADD COLUMN IF NOT EXISTS notes        text;

/* ---------- Which staff belong to which payroll company ----------
   One person can be in several payroll companies (same staff record / same ID). */
CREATE TABLE IF NOT EXISTS payroll_company_staff (
  id         text PRIMARY KEY,
  company_id text NOT NULL REFERENCES payroll_companies(id) ON DELETE CASCADE,
  staff_id   text NOT NULL REFERENCES payroll_staff(id) ON DELETE CASCADE,
  active     boolean NOT NULL DEFAULT true,
  rate       numeric(10,2),            -- NULL = use the company's default rate
  start_date text,                     -- yyyy-mm-dd
  end_date   text,                     -- yyyy-mm-dd
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_company_staff_uq ON payroll_company_staff (company_id, staff_id);
CREATE INDEX IF NOT EXISTS payroll_company_staff_staff_idx ON payroll_company_staff (staff_id);

/* ---------- One payroll sheet = one company x one month ----------
   draft -> reviewed -> verified -> closed (locked). */
CREATE TABLE IF NOT EXISTS payroll_sheets (
  id         text PRIMARY KEY,
  company_id text NOT NULL REFERENCES payroll_companies(id) ON DELETE CASCADE,
  month      text NOT NULL,            -- yyyy-mm
  status     text NOT NULL DEFAULT 'draft',
  notes      text,
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_sheets_company_month_uq ON payroll_sheets (company_id, month);

/* ---------- One line = one staff member on one sheet ----------
   Total Hours (= units + bank holiday) and Amount (= rate x total hours) are never stored. */
CREATE TABLE IF NOT EXISTS payroll_lines (
  id                  text PRIMARY KEY,
  sheet_id            text NOT NULL REFERENCES payroll_sheets(id) ON DELETE CASCADE,
  staff_id            text NOT NULL REFERENCES payroll_staff(id) ON DELETE CASCADE,
  units_hours         numeric(10,2) NOT NULL DEFAULT 0,
  bank_holiday_hours  numeric(10,2) NOT NULL DEFAULT 0,
  holiday_entitlement numeric(10,2) NOT NULL DEFAULT 0,  -- information only, not part of the total
  comment             text NOT NULL DEFAULT '',
  rate                numeric(10,2) NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_lines_sheet_staff_uq ON payroll_lines (sheet_id, staff_id);
CREATE INDEX IF NOT EXISTS payroll_lines_staff_idx ON payroll_lines (staff_id);
