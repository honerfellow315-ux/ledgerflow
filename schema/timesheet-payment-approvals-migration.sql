-- Run on a TEST database first. Never execute automatically against production.
CREATE TABLE IF NOT EXISTS timesheet_payment_approvals (
  sheet_id text PRIMARY KEY REFERENCES timesheet_sheets(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('full','deduct','custom')),
  adjustment numeric(12,2) NOT NULL DEFAULT 0,
  final_amount numeric(12,2) NOT NULL CHECK (final_amount >= 0),
  note text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
