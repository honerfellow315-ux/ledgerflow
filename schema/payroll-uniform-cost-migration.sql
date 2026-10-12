BEGIN;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS uniform_cost numeric(10,2) NOT NULL DEFAULT 0 CHECK (uniform_cost >= 0);
COMMIT;
