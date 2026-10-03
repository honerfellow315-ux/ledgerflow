# LedgerFlow security — deploy guide

This update adds: mandatory admin 2FA (authenticator app), one-time activation
codes for users, no persistent login (session cookie + idle timeout), login
lockout / rate limiting, hashed session tokens, security headers, and a 12
character password rule. **No existing business data is touched.**

## Deploy steps (in this order)

1. **Back up first.** In Neon, create a branch (or note a restore point) of your
   production database. This is your safety net.
2. **Add the encryption key** to your hosting environment variables (Vercel →
   Settings → Environment Variables), then redeploy later in step 4:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Save the output as `AUTH_ENCRYPTION_KEY`. Keep a copy in a password manager
   and **never change or lose it** (2FA secrets are encrypted with it).
   Without this variable, admins cannot finish 2FA setup.
3. **Run the SQL migration** in the Neon SQL editor: `schema/security-migration.sql`.
   It only adds columns/tables; running it twice is harmless.
4. `npm install` (adds the `qrcode` package) and deploy the new code.

## What happens at first login after the update

- **Everyone is signed out once** (session tokens are now stored hashed).
- **Admins**: after the password they are taken to a QR screen, scan it with
  Google/Microsoft Authenticator or Authy, enter the 6-digit code and save the 8
  backup codes. From then on login = password + 6-digit code.
- **Existing users**: cannot log in until an admin opens **Users** and presses
  the lock icon (“Generate activation code”). Tell the user the code; they enter
  it at login and choose their own password (12+ characters).
- **New users** get their code automatically when the admin creates them.

## Day-to-day

- Activation codes: valid 24 h, single use, shown once, 5 wrong tries kill them.
- Lost phone (admin): use a backup code at login, or another admin presses the
  reset-2FA icon on the Users page.
- Only admin and lost everything: `bun run scripts/reset-2fa.ts <username>`.
- Account locked after 5 wrong tries for 15 minutes (admin can clear it with the
  “sign out of all devices” icon). Idle logout: admins 15 min, users 30 min;
  hard cap 12 h.

## Still recommended (outside the code)

- Turn on 2FA for GitHub, Vercel and Neon; keep the repo private.
- Rotate the Neon database password if `.env` was ever committed or shared.
- Vercel: enable Deployment Protection for preview deployments.
- Browsers may still offer to save the password — answer “Never”.
