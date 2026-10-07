-- Contract status per payroll company — run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/company-contract-status-migration.sql).
-- Safe to re-run. Adds one nullable column; no existing row or value is touched.
-- NULL = the company has no status of its own, so the staff record's status is used (old behaviour).
ALTER TABLE payroll_company_staff ADD COLUMN IF NOT EXISTS contract_status text;
