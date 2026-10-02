-- Pay mode + payroll hours (Salary sheet).
-- Purely additive: three NEW columns, nothing existing is changed or deleted.
-- Safe to run more than once. Run ONCE in the Neon SQL editor.

-- How a person is normally paid: 'payroll' | 'cash' | '' (not set yet).
ALTER TABLE payroll_staff ADD COLUMN IF NOT EXISTS pay_mode text NOT NULL DEFAULT '';
-- Payroll company (payroll_companies.id) that normally pays this person.
ALTER TABLE payroll_staff ADD COLUMN IF NOT EXISTS default_payroll_company_id text;

-- Hours of the month sent to payroll; the rest are cash. NULL = not decided yet.
ALTER TABLE salary_entries ADD COLUMN IF NOT EXISTS payroll_hours numeric(10,2);
