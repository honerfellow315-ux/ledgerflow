-- Dynamic shift companies.
-- Purely additive: two NEW columns and one NEW table, nothing existing is
-- changed or deleted. Safe to run more than once. Run ONCE in the Neon SQL editor.

-- Each person's ID inside shift companies other than RSS / ESS: { "ABC": "1234" }.
ALTER TABLE payroll_staff ADD COLUMN IF NOT EXISTS ext_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Earnings from shift companies other than RSS / ESS: { "ABC": { "amount": 10, "hours": 2 } }.
ALTER TABLE salary_entries ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The companies that supply raw shift exports. Managed from the UI.
CREATE TABLE IF NOT EXISTS shift_companies (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO shift_companies (code, name, active, sort_order)
VALUES ('RSS', 'RSS', true, 0), ('ESS', 'ESS', true, 1)
ON CONFLICT (code) DO NOTHING;
