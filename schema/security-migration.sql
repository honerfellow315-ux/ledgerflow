-- LedgerFlow security hardening migration (additive only).
--
-- Safe to run more than once. It ONLY adds new columns / a new table.
-- No existing business data (clients, invoices, payments, staff, salary...)
-- is read, changed or deleted by this script.
--
-- What it does:
--   1. users    -> adds 2FA (TOTP), activation-code, and login-lockout columns.
--   2. sessions -> adds `stage` (full / pending steps) and `last_active_at`
--                  (idle timeout). It also clears the old session rows: session
--                  tokens are now stored hashed, so every old session is
--                  invalid anyway. Everybody simply logs in once again.
--   3. recovery_codes -> new table for admin 2FA backup codes.
--   4. Every EXISTING non-admin user is flagged `must_activate = true`, so on
--      their next login they need an activation code from an admin (Users page
--      -> "Activation code"). Existing admins are NOT flagged: they are forced
--      to set up 2FA on their next login instead.
--      (The flagging runs only the first time this script runs.)

-- ---------- users ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc        text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled           boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step         integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_code_hash   text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_expires_at  timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_attempts    integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count     integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until           timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'must_activate'
  ) THEN
    ALTER TABLE users ADD COLUMN must_activate boolean NOT NULL DEFAULT false;
    UPDATE users SET must_activate = true WHERE role = 'user';
  END IF;
END $$;

-- ---------- sessions ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions' AND column_name = 'stage'
  ) THEN
    -- old rows hold raw tokens; new code looks sessions up by hash -> clear them
    DELETE FROM sessions;
    ALTER TABLE sessions ADD COLUMN stage text NOT NULL DEFAULT 'full';
  END IF;
END $$;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now();

-- ---------- recovery codes (admin 2FA backup codes, stored hashed) ----------
CREATE TABLE IF NOT EXISTS recovery_codes (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recovery_codes_user_idx ON recovery_codes (user_id);
