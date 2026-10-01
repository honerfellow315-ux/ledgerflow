-- End Client on invoices.
-- Purely additive: one new NULLABLE column. No existing row is changed,
-- so every old invoice simply has end_client = NULL ("not assigned").
-- Safe to run more than once.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS end_client text;
CREATE INDEX IF NOT EXISTS invoices_end_client_idx ON invoices (end_client) WHERE end_client IS NOT NULL;
