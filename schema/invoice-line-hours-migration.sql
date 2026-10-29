-- Invoice line items: "Hours" flag migration -- run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/invoice-line-hours-migration.sql).
-- Safe to re-run. NOT NULL DEFAULT false, so every existing line item stays a normal line
-- (nothing changes for old invoices until someone ticks "Hrs" on a line).
-- The same statement is also appended to schema/ledgerflow-schema.sql for new installs.

ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS is_hours boolean NOT NULL DEFAULT false;
