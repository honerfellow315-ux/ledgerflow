-- Run ONCE after company-contract-status-migration.sql. Safe to re-run.
-- Gives every company link its own copy of the staff record's current status,
-- so changing it in one company never shows up in another.
UPDATE payroll_company_staff pcs
SET contract_status = COALESCE(s.contract_status, 'Active'),
    end_date = CASE
      WHEN COALESCE(s.contract_status, 'Active') = 'Active' THEN pcs.end_date
      ELSE COALESCE(pcs.end_date, s.employment_end_date)
    END
FROM payroll_staff s
WHERE s.id = pcs.staff_id
  AND pcs.contract_status IS NULL;
