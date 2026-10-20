-- Import safety net (Add/Replace + Undo last import).
-- OPTIONAL: the app creates this table by itself on first import, this file is only for reference.
CREATE TABLE IF NOT EXISTS salary_import_backups (
  id            text PRIMARY KEY,
  period_id     text NOT NULL,
  source        text NOT NULL,
  mode          text NOT NULL,
  actor_name    text NOT NULL DEFAULT '',
  file_name     text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz,
  shifts_before integer NOT NULL DEFAULT 0,
  shifts_after  integer NOT NULL DEFAULT 0,
  shifts        jsonb NOT NULL DEFAULT '[]'::jsonb,
  entries       jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS salary_import_backups_period_idx
  ON salary_import_backups (period_id, source, created_at DESC);
