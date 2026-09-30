-- Salary sheet migration — run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/salary-migration.sql).
-- Safe to re-run: everything is IF NOT EXISTS. No existing table is touched.
-- The same statements are also appended to schema/ledgerflow-schema.sql for new installs.

/* ---------- Salary sheet ---------- */

-- Staff master record (one row per person, ever). NI + bank details are
-- sensitive: guarded by the separate "staff" permission module.
CREATE TABLE IF NOT EXISTS payroll_staff (
  id             text PRIMARY KEY,
  rss_id         text NOT NULL DEFAULT '',
  ess_id         text NOT NULL DEFAULT '',
  ni             text NOT NULL DEFAULT '',
  name           text NOT NULL,
  tag            text NOT NULL DEFAULT '',
  account_detail text NOT NULL DEFAULT '',
  area           text NOT NULL DEFAULT '',
  notes          text,
  active         boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS payroll_staff_rss_id_idx ON payroll_staff (rss_id);
CREATE INDEX IF NOT EXISTS payroll_staff_ess_id_idx ON payroll_staff (ess_id);

-- The payroll columns of the sheet. Managed from the UI.
CREATE TABLE IF NOT EXISTS payroll_companies (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

-- One month = one run. draft -> reviewed -> verified -> closed (locked).
CREATE TABLE IF NOT EXISTS salary_periods (
  id         text PRIMARY KEY,
  month      text NOT NULL UNIQUE, -- yyyy-mm
  status     text NOT NULL DEFAULT 'draft',
  notes      text,
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One line of the sheet: one staff member in one month.
CREATE TABLE IF NOT EXISTS salary_entries (
  id             text PRIMARY KEY,
  period_id      text NOT NULL REFERENCES salary_periods(id) ON DELETE CASCADE,
  staff_id       text NOT NULL REFERENCES payroll_staff(id) ON DELETE CASCADE,
  rss_amount     numeric(12,2) NOT NULL DEFAULT 0,
  rss_hours      numeric(10,2) NOT NULL DEFAULT 0,
  ess_amount     numeric(12,2) NOT NULL DEFAULT 0,
  ess_hours      numeric(10,2) NOT NULL DEFAULT 0,
  carry_forward  numeric(12,2) NOT NULL DEFAULT 0,
  tax_deduction  numeric(12,2) NOT NULL DEFAULT 0,
  deduction      numeric(12,2) NOT NULL DEFAULT 0,
  deduction_note text,
  check_status   text NOT NULL DEFAULT '',
  flag           text NOT NULL DEFAULT '',
  payroll        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS salary_entries_period_staff_uq ON salary_entries (period_id, staff_id);

-- P1, P2, ... cash payments (any number per line).
CREATE TABLE IF NOT EXISTS salary_payments (
  id        text PRIMARY KEY,
  entry_id  text NOT NULL REFERENCES salary_entries(id) ON DELETE CASCADE,
  date      text NOT NULL,
  amount    numeric(12,2) NOT NULL,
  method    text NOT NULL DEFAULT 'Bank Transfer',
  reference text NOT NULL DEFAULT '',
  notes     text
);
CREATE INDEX IF NOT EXISTS salary_payments_entry_idx ON salary_payments (entry_id);

-- Raw shift export rows (RSS / ESS) for drill-down and re-matching.
CREATE TABLE IF NOT EXISTS salary_shifts (
  id            text PRIMARY KEY,
  period_id     text NOT NULL REFERENCES salary_periods(id) ON DELETE CASCADE,
  source        text NOT NULL,
  staff_id      text REFERENCES payroll_staff(id) ON DELETE SET NULL,
  employee_id   text NOT NULL DEFAULT '',
  employee_name text NOT NULL DEFAULT '',
  ni            text NOT NULL DEFAULT '',
  date          text NOT NULL DEFAULT '',
  client_name   text NOT NULL DEFAULT '',
  site_name     text NOT NULL DEFAULT '',
  hours         numeric(10,2) NOT NULL DEFAULT 0,
  rate          numeric(12,2) NOT NULL DEFAULT 0,
  amount        numeric(12,2) NOT NULL DEFAULT 0,
  expenses      numeric(12,2) NOT NULL DEFAULT 0,
  penalty       numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS salary_shifts_period_source_idx ON salary_shifts (period_id, source);
CREATE INDEX IF NOT EXISTS salary_shifts_staff_idx ON salary_shifts (staff_id);


-- OPTIONAL: pre-create the payroll columns from your current Excel sheet.
-- (Importing your Excel salary sheet creates them automatically, and more can
-- be added any time from Salary Sheet > Payroll companies. Un-comment to seed.)
-- INSERT INTO payroll_companies (id, name, order_index) VALUES
--   ('pc-ess','ESS',0),('pc-fortexo','Fortexo',1),('pc-securefm','Secure FM',2),
--   ('pc-ses','SES',3),('pc-spl','SPL',4),('pc-hsguarding','HS Guarding',5),
--   ('pc-leverage','Leverage',6)
-- ON CONFLICT (id) DO NOTHING;
