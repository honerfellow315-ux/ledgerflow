-- Bank Match migration: run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/bank-match-migration.sql).
-- Safe to re-run (IF NOT EXISTS). It only ADDS three new tables; no existing table,
-- column or row is touched. Run it BEFORE the new code is deployed.

-- One row per uploaded bank statement file. The same file (same content) cannot be uploaded twice.
CREATE TABLE IF NOT EXISTS bank_statements (
  id           text PRIMARY KEY,
  file_name    text NOT NULL,
  file_hash    text NOT NULL UNIQUE,
  line_count   integer NOT NULL DEFAULT 0,
  skipped_out  integer NOT NULL DEFAULT 0,
  uploaded_by  text NOT NULL DEFAULT '',
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

-- Money-in lines of a statement. Money-out lines are never stored.
-- dedupe_key stops the same bank line from entering twice when two statements overlap.
-- status only holds the decisions a person made (open / confirmed / ignored);
-- "matched" and "needs a look" are worked out fresh from the current open invoices.
CREATE TABLE IF NOT EXISTS bank_lines (
  id            text PRIMARY KEY,
  statement_id  text NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  line_no       integer NOT NULL,
  date          text NOT NULL,
  description   text NOT NULL,
  amount        numeric(12,2) NOT NULL,
  dedupe_key    text NOT NULL UNIQUE,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'ignored')),
  invoice_id    text REFERENCES invoices(id) ON DELETE SET NULL,
  payment_id    text REFERENCES payments(id) ON DELETE SET NULL,
  decided_by    text NOT NULL DEFAULT '',
  decided_at    timestamptz
);
CREATE INDEX IF NOT EXISTS bank_lines_statement_idx ON bank_lines (statement_id, line_no);
CREATE INDEX IF NOT EXISTS bank_lines_status_date_idx ON bank_lines (status, date DESC);

-- "This bank name is always this client": remembered when a person confirms a match by hand.
CREATE TABLE IF NOT EXISTS bank_payer_links (
  payer_key  text PRIMARY KEY,
  client_id  text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
