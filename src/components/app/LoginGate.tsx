import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LockKeyhole } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, logout, me } from "@/lib/actions/auth";
import { unwrap } from "@/lib/unwrap";

type LoginErrors = { username?: string | undefined; password?: string | undefined };

/** Signs out on the server, then reloads so no ledger data stays in memory. */
export async function signOutAndReload() {
  try {
    await logout();
  } catch {
    /* even if the call fails, reload */
  }
  window.location.reload();
}

/**
 * Administrator sign-in screen.
 *
 * Credentials are checked against the admin_users table (see
 * drizzle/schema.ts + scripts/create-admin.ts). A successful login sets an
 * httpOnly session cookie; `me()` checks that cookie on load.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    unwrap(me())
      .then((user) => setIsAuthenticated(Boolean(user)))
      .catch(() => setIsAuthenticated(false))
      .finally(() => setIsReady(true));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const nextErrors: LoginErrors = {};
    if (!username) nextErrors.username = "Enter your username.";
    if (!password) nextErrors.password = "Enter your password.";

    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await unwrap(login({ data: { username, password } }));
      if (res.status !== "ok") {
        setFormError(res.message);
        return;
      }
      // Don't trust the login call alone: confirm the session cookie really works.
      const user = await unwrap(me());
      if (!user) throw new Error("No session after login");
      setIsAuthenticated(true);
    } catch {
      setFormError("Incorrect username or password.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isReady) {
    return <div className="min-h-screen bg-background" />;
  }

  if (isAuthenticated) return children;

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-login-panel p-12 text-login-panel-foreground lg:flex xl:p-16">
        <div
          className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full opacity-[0.15] blur-3xl"
          style={{ background: "radial-gradient(circle, var(--brand-mark), transparent 70%)" }}
        />
        <Brand />
        <div className="max-w-xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-login-panel-muted">
            Accounts receivable control
          </p>
          <h1 className="max-w-lg text-4xl font-semibold leading-tight tracking-normal xl:text-5xl">
            Clear oversight of every client account.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-login-panel-muted">
            Review invoices, record payments and monitor outstanding balances from one organised
            workspace.
          </p>
        </div>
        <p className="relative text-xs text-login-panel-muted">LedgerFlow Receivables Suite</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10 lg:px-14">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>
          <div className="mb-8">
            <span className="mb-5 flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </span>
            <h2 className="text-2xl font-semibold text-foreground">Admin login</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Enter your credentials to access LedgerFlow.
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="username">
                Username <span className="text-destructive">*</span>
              </Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoFocus
                aria-invalid={Boolean(errors.username)}
                aria-describedby={errors.username ? "username-error" : undefined}
                onChange={() =>
                  errors.username && setErrors((e) => ({ ...e, username: undefined }))
                }
              />
              <p
                id="username-error"
                aria-live="polite"
                className="min-h-4 text-xs font-medium text-destructive"
              >
                {errors.username ?? ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">
                Password <span className="text-destructive">*</span>
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "password-error" : undefined}
                onChange={() =>
                  errors.password && setErrors((e) => ({ ...e, password: undefined }))
                }
              />
              <p
                id="password-error"
                aria-live="polite"
                className="min-h-4 text-xs font-medium text-destructive"
              >
                {errors.password ?? ""}
              </p>
            </div>
            {formError && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? "Logging in…" : "Log in"}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-mark to-primary text-sm font-bold text-brand-mark-foreground shadow-[0_2px_10px_-2px_oklch(0.2_0.03_258/0.4)]">
        LF
      </span>
      <div className="leading-tight">
        <p className="text-base font-semibold">LedgerFlow</p>
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] opacity-70">
          Receivables Suite
        </p>
      </div>
    </div>
  );
}
