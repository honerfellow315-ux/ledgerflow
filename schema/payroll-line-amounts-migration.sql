-- Payroll lines: fixed amount + paid holiday (ESS "payroll sheet" rules).
-- Purely additive: two NEW nullable columns, nothing existing is changed or deleted.
-- Existing lines keep NULL in both => their Amount stays exactly Rate x Total Hours as before.
-- Safe to run more than once. Run ONCE in the Neon SQL editor (TEST project first, then live).

-- Fixed monthly amount for guards who are not paid by hours (sheet: Rate 0 + typed Amount).
-- NULL = normal line (Amount = Rate x Total Hours).
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS fixed_amount numeric(10,2);

-- Rate at which "Holiday Entitlement" hours are PAID on this line (sheet: Amount = Rate x Hours + Holiday x 12.71).
-- NULL = holiday hours are information only (old behaviour).
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS holiday_rate numeric(10,2);
