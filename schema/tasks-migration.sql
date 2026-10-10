-- Tasks migration — run ONCE on an existing LedgerFlow database
-- (Neon SQL editor, or: psql "$DATABASE_URL" -f schema/tasks-migration.sql).
-- Safe to re-run (IF NOT EXISTS). It only ADDS two new tables; no existing table,
-- column or row is touched. Run it BEFORE the new code is deployed.

CREATE TABLE IF NOT EXISTS tasks (
  id               text PRIMARY KEY,
  text             text NOT NULL,
  notes            text NOT NULL DEFAULT '',
  assignee_id      text REFERENCES users(id) ON DELETE SET NULL,
  assignee_name    text NOT NULL DEFAULT '',
  created_by_id    text REFERENCES users(id) ON DELETE SET NULL,
  created_by_name  text NOT NULL DEFAULT '',
  date             text NOT NULL,
  status           text NOT NULL DEFAULT 'todo',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id, status, date);
CREATE INDEX IF NOT EXISTS tasks_date_idx ON tasks (date);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status, date);

CREATE TABLE IF NOT EXISTS task_events (
  id       text PRIMARY KEY,
  task_id  text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at       timestamptz NOT NULL DEFAULT now(),
  by_name  text NOT NULL DEFAULT '',
  text     text NOT NULL
);

CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events (task_id, at);
