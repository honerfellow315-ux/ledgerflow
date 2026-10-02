-- Second (optional) description on invoices.
-- Purely additive: one new NULLABLE column. Existing invoices stay NULL.
-- Safe to run more than once.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description_2 text;
