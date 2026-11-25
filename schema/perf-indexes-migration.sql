-- Speed-only change: adds an index and changes no data and no calculation.
-- Safe to run more than once (IF NOT EXISTS). Run it on the TEST database first.
--
-- The salary import re-matches unmatched shifts to staff by NI number using the
-- expression upper(regexp_replace(ni,'[^A-Za-z0-9]','','g')). Without an index
-- on that exact expression Postgres scans the whole staff table for each shift.
CREATE INDEX IF NOT EXISTS payroll_staff_ni_norm_idx
  ON payroll_staff ((upper(regexp_replace(ni, '[^A-Za-z0-9]', '', 'g'))))
  WHERE ni <> '';
ANALYZE payroll_staff;
