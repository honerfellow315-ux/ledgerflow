-- Optional description on credit notes (shown under Reason).
-- Purely additive: one new NULLABLE column. Existing credit notes stay NULL.
-- Safe to run more than once.
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS description text;
