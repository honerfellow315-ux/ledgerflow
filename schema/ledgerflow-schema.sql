-- LedgerFlow database schema
-- Paste this whole file into the Neon SQL Editor and click "Run".
-- Matches: drizzle/schema.ts
--
-- Safe to re-run: every statement is guarded (IF NOT EXISTS / DO-block for
-- enums / ON CONFLICT for the seed row), so this works whether your
-- database is brand new OR already has an older version of these tables
-- (e.g. from a previous deploy of this project).

/* ---------- Enums ---------- */

DO $$BEGIN   CREATE TYPE client_status AS ENUM ('active', 'on-hold', 'closed'); EXCEPTION WHEN duplicate_object THEN NULL; END$$;

DO $$BEGIN   CREATE TYPE payment_method AS ENUM ('Bank Transfer', 'Cash', 'Payroll', 'Other'); EXCEPTION WHEN duplicate_object THEN NULL; END$$;

DO $$BEGIN   CREATE TYPE credit_note_status AS ENUM ('draft', 'issued', 'applied'); EXCEPTION WHEN duplicate_object THEN NULL; END$$;

-- Multi-user RBAC role. 'admin' bypasses every permission check in the app
-- (see hasPermission() in src/lib/permissions.ts) — 'user' is gated by the
-- permissions jsonb column below.
DO $$BEGIN   CREATE TYPE user_role AS ENUM ('admin', 'user'); EXCEPTION WHEN duplicate_object THEN NULL; END$$;

/* ---------- Auth ---------- */

-- Multi-user RBAC. This used to be `admin_users` (single shared login, no
-- roles) — it's renamed to `users` here, with `role` + `permissions` added.
CREATE TABLE IF NOT EXISTS users (
  id             text PRIMARY KEY,
  username       varchar(64) NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  display_name   text NOT NULL DEFAULT '',
  role           user_role NOT NULL DEFAULT 'user',
  -- Record<module, Record<action, boolean>> — see src/lib/permissions.ts.
  -- Ignored entirely for admins (role = 'admin' always passes).
  permissions    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Who created this account, for audit purposes. Null for the original
  -- bootstrap admin. Self-referencing, so it must stay nullable.
  created_by     text REFERENCES users(id) ON DELETE SET NULL
);

-- If `users` already existed from an earlier run of this migration but
-- predates a later column being added, backfill whichever are missing.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by text REFERENCES users(id) ON DELETE SET NULL;

-- Migrate any existing single-login row from the old `admin_users` table
-- into `users`, so an existing install doesn't lock itself out. Gives it
-- role='admin' (full access — admins bypass the permissions jsonb
-- entirely, so an empty '{}' permissions value here is fine).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_users') THEN
    INSERT INTO users (id, username, password_hash, display_name, role, permissions, created_at)
    SELECT id, username, password_hash, '', 'admin', '{}'::jsonb, created_at
    FROM admin_users
    ON CONFLICT (id) DO NOTHING;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- If `sessions` already existed pointing at admin_users (old deploy),
-- re-point its foreign key at `users` instead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'sessions' AND constraint_name = 'sessions_user_id_fkey'
  ) THEN
    ALTER TABLE sessions DROP CONSTRAINT sessions_user_id_fkey;
  END IF;
  ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- The old admin_users table is intentionally left in place (not dropped) so
-- you can double-check the migration above before removing it yourself:
--   DROP TABLE admin_users;

/* ---------- Core ledger tables ---------- */

-- One of the 4-5 billing companies this install invoices under. A client is
-- optionally linked to one; when linked, its invoices/statements pull this
-- company's details instead of the single global `settings` business profile.
CREATE TABLE IF NOT EXISTS companies (
  id                       text PRIMARY KEY,
  name                     text NOT NULL,
  email                    text NOT NULL DEFAULT '',
  phone                    text NOT NULL DEFAULT '',
  address                  text NOT NULL DEFAULT '',
  vat_number               text NOT NULL DEFAULT '',
  company_number           text NOT NULL DEFAULT '',
  website                  text NOT NULL DEFAULT '',
  bank_details             text NOT NULL DEFAULT '',
  logo                     text NOT NULL DEFAULT '',
  letterhead               text NOT NULL DEFAULT '',
  letterhead_margin_top    numeric(6,2) NOT NULL DEFAULT 0,
  letterhead_margin_bottom numeric(6,2) NOT NULL DEFAULT 0
);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS letterhead                text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS letterhead_margin_top    numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS letterhead_margin_bottom numeric(6,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS clients (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  company           text NOT NULL DEFAULT '',
  email             text NOT NULL DEFAULT '',
  phone             text NOT NULL DEFAULT '',
  address           text NOT NULL DEFAULT '',
  status            client_status NOT NULL DEFAULT 'active',
  rate              numeric(12,2),
  payment_term_days integer,
  vat_number        text,
  account_reference text,
  start_date        text,
  notes             text,
  company_id        text REFERENCES companies(id) ON DELETE SET NULL
);

-- If `clients` already existed from an older deploy, add the new column
-- without touching any data already in the table.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_id text REFERENCES companies(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS invoices (
  id            text PRIMARY KEY,
  number        text NOT NULL,
  client_id     text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month         text,
  invoice_date  text NOT NULL,
  due_date      text NOT NULL,
  po_reference  text,
  description   text NOT NULL DEFAULT '',
  amount_ex_vat numeric(12,2) NOT NULL,
  hours         numeric(10,2),
  rate          numeric(12,2),
  vat_included  boolean NOT NULL DEFAULT false,
  vat_rate      numeric(5,2) NOT NULL DEFAULT 20,
  payment_terms text NOT NULL DEFAULT '',
  notes         text
);

CREATE TABLE IF NOT EXISTS payments (
  id         text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  client_id  text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date       text NOT NULL,
  method     payment_method NOT NULL DEFAULT 'Bank Transfer',
  amount     numeric(12,2) NOT NULL,
  reference  text NOT NULL DEFAULT '',
  notes      text
);

CREATE TABLE IF NOT EXISTS expenses (
  id            text PRIMARY KEY,
  date          text NOT NULL,
  category      text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  amount_ex_vat numeric(12,2) NOT NULL,
  vat_amount    numeric(12,2) NOT NULL DEFAULT 0,
  method        payment_method NOT NULL DEFAULT 'Bank Transfer',
  paid_to       text NOT NULL DEFAULT '',
  reference     text,
  comments      text
);

CREATE TABLE IF NOT EXISTS hours_entries (
  id                       text PRIMARY KEY,
  month                    text NOT NULL,
  client_id                text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  total_hours              numeric(10,2) NOT NULL DEFAULT 0,
  payroll_hours            numeric(10,2) NOT NULL DEFAULT 0,
  management_payroll_hours numeric(10,2) NOT NULL DEFAULT 0,
  unpaid_hours             numeric(10,2) NOT NULL DEFAULT 0,
  rate                     numeric(12,2) NOT NULL DEFAULT 0,
  notes                    text
);

CREATE TABLE IF NOT EXISTS subcontract_entries (
  id                  text PRIMARY KEY,
  month               text NOT NULL,
  client_id           text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invoice_id          text REFERENCES invoices(id) ON DELETE SET NULL,
  subcontractor_name  text NOT NULL DEFAULT '',
  hours_proceed       numeric(10,2) NOT NULL DEFAULT 0,
  rate                numeric(12,2) NOT NULL DEFAULT 0,
  description         text,
  reference           text,
  invoice_date        text,
  due_date            text,
  invoice_number      text,
  notes               text
);

-- If subcontract_entries already existed from an older deploy, add the
-- new column without touching any data already in the table.
ALTER TABLE subcontract_entries ADD COLUMN IF NOT EXISTS invoice_id text REFERENCES invoices(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id            text PRIMARY KEY,
  invoice_id    text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description   text NOT NULL DEFAULT '',
  quantity      numeric(10,2) NOT NULL DEFAULT 1,
  unit_price    numeric(12,2) NOT NULL DEFAULT 0,
  amount_ex_vat numeric(12,2) NOT NULL DEFAULT 0,
  order_index   integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id            text PRIMARY KEY,
  number        text NOT NULL,
  client_id     text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invoice_id    text REFERENCES invoices(id) ON DELETE SET NULL,
  date          text NOT NULL,
  reason        text NOT NULL DEFAULT '',
  amount_ex_vat numeric(12,2) NOT NULL,
  vat_included  boolean NOT NULL DEFAULT false,
  vat_rate      numeric(5,2) NOT NULL DEFAULT 20,
  status        credit_note_status NOT NULL DEFAULT 'draft',
  comments      text
);

-- Single-row table: one settings record per installation (id is always 'default').
CREATE TABLE IF NOT EXISTS settings (
  id                  text PRIMARY KEY DEFAULT 'default',
  business_name       text NOT NULL DEFAULT '',
  business_email      text NOT NULL DEFAULT '',
  business_phone      text NOT NULL DEFAULT '',
  business_address    text NOT NULL DEFAULT '',
  vat_number          text NOT NULL DEFAULT '',
  company_number      text NOT NULL DEFAULT '',
  business_website    text NOT NULL DEFAULT '',
  default_vat_rate    numeric(5,2) NOT NULL DEFAULT 20,
  currency            text NOT NULL DEFAULT 'GBP',
  payment_methods     payment_method[] NOT NULL DEFAULT ARRAY['Bank Transfer','Cash','Payroll','Other']::payment_method[],
  payment_terms       text[] NOT NULL DEFAULT ARRAY['On receipt','30 days'],
  expense_categories  text[] NOT NULL DEFAULT ARRAY['Other'],
  invoice_prefix      text NOT NULL DEFAULT 'INV-',
  next_invoice_number integer NOT NULL DEFAULT 1,
  credit_note_prefix  text NOT NULL DEFAULT 'CN-',
  bank_details        text NOT NULL DEFAULT '',
  business_logo       text NOT NULL DEFAULT '',
  business_letterhead text NOT NULL DEFAULT '',
  letterhead_margin_top    numeric(6,2) NOT NULL DEFAULT 0,
  letterhead_margin_bottom numeric(6,2) NOT NULL DEFAULT 0
);

-- If `settings` already existed from an older deploy of this project, it
-- won't have these columns yet — add whichever are missing without
-- touching any data already in the table.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS business_website text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS bank_details     text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS business_logo    text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS business_letterhead      text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS letterhead_margin_top    numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS letterhead_margin_bottom numeric(6,2) NOT NULL DEFAULT 0;

-- Add hours and rate columns to invoices if missing
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hours numeric(10,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rate  numeric(12,2);

/* ---------- Invoice workflow additions ---------- */

-- Approval status, kept fully separate from payment status.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;

-- How VAT is calculated: 'full' (default, unchanged behaviour) applies VAT to
-- the whole invoice amount; 'remaining' applies VAT only to the currently
-- outstanding ex-VAT balance (never retroactively to amounts already paid).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_mode text NOT NULL DEFAULT 'full';

-- Ex-VAT amount already paid when VAT was applied in 'remaining' mode. VAT is
-- charged on (amount_ex_vat - vat_paid_before) and stays fixed even as more
-- payments are recorded later. NULL = legacy invoice.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_paid_before numeric(12,2);

-- "Additional Invoice": a separate, independent invoice that references an
-- original invoice without ever modifying it. Multiple additional invoices
-- may point at the same original.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS original_invoice_id text REFERENCES invoices(id) ON DELETE SET NULL;

-- Company-specific default invoice-number prefix (e.g. FFM- for FFM Ltd).
-- Empty string = fall back to the global Settings invoice_prefix.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT '';

-- Payment methods are now free-form/reusable (Settings > Payment Methods can
-- add custom ones), so the old fixed 4-value enum is no longer sufficient.
-- Widen the columns that used it to plain text; existing values (which were
-- always one of the enum's own labels) convert across unchanged.
ALTER TABLE payments ALTER COLUMN method TYPE text USING method::text;
ALTER TABLE payments ALTER COLUMN method SET DEFAULT 'Bank Transfer';
ALTER TABLE expenses ALTER COLUMN method TYPE text USING method::text;
ALTER TABLE expenses ALTER COLUMN method SET DEFAULT 'Bank Transfer';
ALTER TABLE settings ALTER COLUMN payment_methods TYPE text[] USING payment_methods::text[];
ALTER TABLE settings ALTER COLUMN payment_methods SET DEFAULT ARRAY['Bank Transfer','Cash','Payroll','Other'];

-- Seed the single settings row (safe to run once; app also does this on startup).
INSERT INTO settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

/* ---------- Recycle bin ---------- */

-- Soft delete: deleting one of these rows through the app now sets
-- deleted_at instead of running a real DELETE. Every list*() server fn
-- filters deleted_at IS NULL out automatically, so deleted rows vanish from
-- the normal UI immediately. Only an admin, via the Recycle Bin screen, can
-- see soft-deleted rows, restore them (deleted_at back to NULL), or purge
-- them for good (an actual DELETE, only reachable from that screen).
ALTER TABLE companies           ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE clients             ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE invoices            ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE payments            ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE expenses            ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE hours_entries       ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE subcontract_entries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE credit_notes        ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

/* ---------- Hours-wise payments ---------- */

-- A payment can optionally be recorded as "N hours at this entry's rate"
-- instead of a typed amount. Both columns stay NULL for an ordinary
-- fixed-amount payment; the invoice link is unaffected either way.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS hours_entry_id text REFERENCES hours_entries(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS hours_paid numeric(10,2);

/* ---------- Expense ↔ invoice job-costing link ---------- */

-- Optional: ties an expense to the invoice it was incurred for (e.g. a
-- device repair job), so the invoice list can show "invoiced minus this
-- expense". Left NULL for ordinary expenses with no linked invoice.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS invoice_id text REFERENCES invoices(id) ON DELETE SET NULL;

/* ---------- Subcontracting VAT ---------- */

-- Off by default (most subcontractor payments are zero-rated/exempt) —
-- turn on per entry when VAT actually applies.
ALTER TABLE subcontract_entries ADD COLUMN IF NOT EXISTS vat_included boolean NOT NULL DEFAULT false;
ALTER TABLE subcontract_entries ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 0;

/* ---------- Hours ↔ invoice link ---------- */

-- Optional: ties a monthly hours entry to the invoice raised for it, so the
-- Hours screen can show "already invoiced as FFM/211" instead of nothing.
-- Same pattern as subcontract_entries.invoice_id above. Left NULL until an
-- invoice is linked (manually, or via the auto-suggested match on client +
-- month + Hours×Rate billing).
ALTER TABLE hours_entries ADD COLUMN IF NOT EXISTS invoice_id text REFERENCES invoices(id) ON DELETE SET NULL;

/* ---------- User activity log ---------- */

-- Proper "who did what, when" audit trail. Every create/update/delete/
-- restore/purge across the app, plus login/login_failed/logout, writes one
-- row here (see src/lib/server/activity.ts). username/display_name are
-- snapshotted onto the row (not just derived via user_id) so the log still
-- names the right person even after that account is deleted. Admin-only —
-- see the Activity Log screen (src/routes/activity-log.index.tsx).
CREATE TABLE IF NOT EXISTS activity_log (
  id           text PRIMARY KEY,
  user_id      text REFERENCES users(id) ON DELETE SET NULL,
  username     text NOT NULL DEFAULT 'system',
  display_name text NOT NULL DEFAULT '',
  action       text NOT NULL,
  module       text NOT NULL,
  entity_id    text,
  label        text NOT NULL DEFAULT '',
  details      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_user_id_idx ON activity_log (user_id);

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
