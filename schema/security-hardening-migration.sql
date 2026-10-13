-- Security hardening (run once, any time before/after deploying the new code).
-- Safe to re-run.
BEGIN;

-- Usernames are compared case-insensitively at login, so make that a database
-- rule too. If two accounts already differ only by case ("Admin" / "admin")
-- the index is skipped with a notice: rename one of them, then re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users GROUP BY lower(username) HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'users_username_lower_uq skipped: usernames that differ only by case exist. Rename them and re-run.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uq ON users (lower(username));
  END IF;
END $$;

-- Speeds up the failed-login throttle and the nightly clean-up.
CREATE INDEX IF NOT EXISTS activity_log_login_failed_idx
  ON activity_log (created_at) WHERE action = 'login_failed';

COMMIT;
