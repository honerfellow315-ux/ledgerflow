-- Invoice Drafts migration: run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/invoice-drafts-migration.sql).
-- Safe to re-run (IF NOT EXISTS). It ADDS two new tables and one index.
-- No existing table, column or row is changed. Run it BEFORE the new code is deployed.

-- Remembers "this name in the shift export = this client", so a name that does not
-- match a client by itself only has to be linked once.
CREATE TABLE IF NOT EXISTS invoice_draft_aliases (
  name_key    text PRIMARY KEY,
  shift_name  text NOT NULL,
  client_id   text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per client + month that was turned into an invoice from a draft.
-- The primary key is what stops two clicks (or two people) creating the same invoice twice.
CREATE TABLE IF NOT EXISTS invoice_draft_runs (
  client_id        text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month            text NOT NULL,
  invoice_id       text REFERENCES invoices(id) ON DELETE SET NULL,
  created_by_name  text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, month)
);

-- Makes "group this month's shifts by client" quick on a large salary_shifts table.
CREATE INDEX IF NOT EXISTS salary_shifts_period_client_idx ON salary_shifts (period_id, client_name);
