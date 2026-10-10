-- Follow-ups migration: run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/follow-ups-migration.sql).
-- Safe to re-run (IF NOT EXISTS). It only ADDS two new tables; no existing table,
-- column or row is touched. Run it BEFORE the new code is deployed.

-- Every chase of a client (phone, WhatsApp, ...), in the person's own words.
CREATE TABLE IF NOT EXISTS follow_up_contacts (
  id          text PRIMARY KEY,
  client_id   text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  method      text NOT NULL,
  note        text NOT NULL,
  by_id       text REFERENCES users(id) ON DELETE SET NULL,
  by_name     text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS follow_up_contacts_client_idx ON follow_up_contacts (client_id, at DESC);

-- Where each client stands now: when to chase next, and the date they promised to pay.
CREATE TABLE IF NOT EXISTS follow_up_state (
  client_id      text PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  next_follow_up text,
  promised_date  text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
