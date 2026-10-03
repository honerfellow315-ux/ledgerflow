-- Payroll split on Hours x Rate invoices + payroll rate on Hours entries.
-- Purely additive: three NEW nullable columns. Nothing existing is changed or deleted.
-- Safe to run more than once. Run ONCE in the Neon SQL editor.

-- Invoice: of `hours`, how many were paid through payroll, and at what rate.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payroll_hours numeric(10,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payroll_rate numeric(12,2);

-- Hours entry: the rate the payroll hours were paid at.
ALTER TABLE hours_entries ADD COLUMN IF NOT EXISTS payroll_rate numeric(12,2);
