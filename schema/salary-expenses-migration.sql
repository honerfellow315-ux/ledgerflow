-- Salary expenses migration — run ONCE on an existing LedgerFlow database
-- (Neon SQL editor). Safe to re-run. It only ADDS one column: nothing existing is changed or deleted.
-- Every existing salary line gets an empty list = 0 expenses, so no total changes by itself.
-- Run it BEFORE the new code is deployed.
-- Each expense is { "amount": number, "note": text (optional) }. At most 5 per line (enforced by the app).

ALTER TABLE salary_entries ADD COLUMN IF NOT EXISTS expenses jsonb NOT NULL DEFAULT '[]'::jsonb;
