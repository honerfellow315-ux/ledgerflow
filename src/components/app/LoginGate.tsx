import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { LockKeyhole } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  completeActivation,
  login,
  logout,
  me,
  totpSetupConfirm,
  totpSetupStart,
} from "@/lib/actions/auth";
import { validatePassword } from "@/lib/passwordPolicy";
import { unwrap } from "@/lib/unwrap";

type LoginErrors = { username?: string | undefined; password?: string | undefined };

/** Which screen of the login flow is showing. */
type Step = "credentials" | "totp" | "activation" | "setup" | "recovery" | "newpassword";

const IDLE_FLAG = "lf_idle_logout";

/** Signs out on the server, then reloads so no ledger data stays in memory. */
export async function signOutAndReload(reason?: "idle") {
  try {
    await logout();
  } catch {
    /* even if the call fails, reload: the cookie is a session cookie */
  }
  try {
    if (reason) sessionStorage.setItem(IDLE_FLAG, reason);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/**
 * Signs the user out after a period of inactivity, and keeps the server-side
 * idle clock fresh while they are actually working.
 */
function IdleGuard({ idleMs }: { idleMs: number }) {
  useEffect(() => {
    let lastActivity = Date.now();
    let lastPing = Date.now();
    let warned = false;
    const mark = () => {
      lastActivity = Date.now();
      warned = false;
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true });

    const check = async () => {
      const now = Date.now();
      if (now - lastActivity >= idleMs) {
        void signOutAndReload("idle");
        return;
      }
      if (!warned && idleMs - (now - lastActivity) <= 60_000) {
        warned = true;
        toast.warning("You will be signed out in about 1 minute due to inactivity.");
      }
      // Active since the last ping? Tell the server so its idle clock matches.
      if (lastActivity > lastPing && now - lastPing >= 120_000) {
        lastPing = now;
        try {
          const user = await unwrap(me());
          if (!user) void signOutAndReload("idle");
        } catch {
          /* transient network error: try again next tick */
        }
      }
    };

    const timer = window.setInterval(() => void check(), 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      for (const e of events) window.removeEventListener(e, mark);
    };
  }, [idleMs]);
  return null;
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
  const [idleMs, setIdleMs] = useState(15 * 60_000);
  const [step, setStep] = useState<Step>("credentials");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Credentials are kept in memory only (never in browser storage) so the
  // second step can re-send them together with the code.
  const creds = useRef<{ username: string; password: string }>({ username: "", password: "" });
  const [setupData, setSetupData] = useState<{ secret: string; qr: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(IDLE_FLAG)) {
        sessionStorage.removeItem(IDLE_FLAG);
        setNotice("You were signed out because of inactivity. Please log in again.");
      }
    } catch {
      /* ignore */
    }
    unwrap(me())
      .then((user) => {
        if (user) setIdleMs(user.idleTimeoutMs);
        setIsAuthenticated(Boolean(user));
      })
      .catch(() => setIsAuthenticated(false))
      .finally(() => setIsReady(true));
  }, []);

  const enterApp = useCallback(async () => {
    const user = await unwrap(me());
    if (!user) throw new Error("No session after login");
    setIdleMs(user.idleTimeoutMs);
    creds.current = { username: "", password: "" };
    setIsAuthenticated(true);
  }, []);

  const startTotpSetup = useCallback(async () => {
    const res = await unwrap(totpSetupStart());
    if (res.status !== "ok") {
      setFormError(res.message);
      setStep("credentials");
      return;
    }
    setSetupData({ secret: res.secret, qr: res.qr });
    setStep("setup");
  }, []);

  /** Runs login() and moves to whichever screen the server asks for next. */
  async function runLogin(code?: string) {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await unwrap(login({ data: { ...creds.current, ...(code ? { code } : {}) } }));
      switch (res.status) {
        case "ok":
          await enterApp();
          break;
        case "need_totp":
          setStep("totp");
          break;
        case "need_activation":
          setStep("activation");
          break;
        case "change_password":
          setStep("newpassword");
          break;
        case "totp_setup":
          await startTotpSetup();
          break;
        case "error":
          setFormError(res.message);
          break;
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const nextErrors: LoginErrors = {};
    if (!username) nextErrors.username = "Enter your username.";
    if (!password) nextErrors.password = "Enter your password.";

    setErrors(nextErrors);
    setFormError(null);
    setNotice(null);
    if (Object.keys(nextErrors).length > 0) return;

    creds.current = { username, password };
    await runLogin();
  }

  async function handleCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    if (!code) {
      setFormError("Enter the code.");
      return;
    }
    await runLogin(code);
  }

  async function handleSetupConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    if (!code) {
      setFormError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await unwrap(totpSetupConfirm({ data: { code } }));
      if (res.status === "ok") {
        setRecoveryCodes(res.recoveryCodes);
        setStep("recovery");
      } else {
        setFormError(res.message);
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pw = String(form.get("newPassword") ?? "");
    const confirm = String(form.get("confirmPassword") ?? "");
    const problem = validatePassword(pw, creds.current.username);
    if (problem) return setFormError(problem);
    if (pw !== confirm) return setFormError("The two passwords do not match.");

    setSubmitting(true);
    setFormError(null);
    try {
      const res = await unwrap(completeActivation({ data: { newPassword: pw } }));
      if (res.status === "ok") {
        await enterApp();
      } else if (res.status === "relogin") {
        creds.current = { username: creds.current.username, password: pw };
        setNotice("Password saved. Log in once more to continue.");
        setStep("credentials");
      } else {
        setFormError(res.message);
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function backToStart() {
    creds.current = { username: "", password: "" };
    setFormError(null);
    setSetupData(null);
    setStep("credentials");
  }

  if (!isReady) {
    return <div className="min-h-screen bg-background" />;
  }

  if (isAuthenticated) {
    return (
      <>
        <IdleGuard idleMs={idleMs} />
        {children}
      </>
    );
  }

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
            <h2 className="text-2xl font-semibold text-foreground">{HEADINGS[step].title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{HEADINGS[step].text}</p>
          </div>

          {notice && step === "credentials" && (
            <p role="status" className="mb-5 rounded-md bg-accent px-3 py-2 text-xs font-medium">
              {notice}
            </p>
          )}

          {step === "credentials" && (
            <form className="space-y-5" onSubmit={handleCredentials} noValidate autoComplete="off">
              <div className="space-y-2">
                <Label htmlFor="username">
                  Username <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
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
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
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
              <FormError message={formError} />
              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting ? "Logging in…" : "Log in"}
              </Button>
            </form>
          )}

          {(step === "totp" || step === "activation") && (
            <form className="space-y-5" onSubmit={handleCode} noValidate autoComplete="off">
              <div className="space-y-2">
                <Label htmlFor="code">
                  {step === "totp" ? "Authentication code" : "Activation code"}
                </Label>
                <Input
                  id="code"
                  name="code"
                  autoComplete="off"
                  autoFocus
                  spellCheck={false}
                  inputMode={step === "totp" ? "numeric" : "text"}
                  placeholder={step === "totp" ? "123456" : "ABCD-EFGH"}
                  className="font-mono tracking-widest"
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
                {step === "totp" && (
                  <p className="text-xs text-muted-foreground">
                    Lost your phone? Type one of your backup codes here instead.
                  </p>
                )}
              </div>
              <FormError message={formError} />
              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting ? "Checking…" : "Continue"}
              </Button>
              <BackLink onClick={backToStart} />
            </form>
          )}

          {step === "setup" && setupData && (
            <form className="space-y-5" onSubmit={handleSetupConfirm} noValidate autoComplete="off">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  Install an authenticator app (Google Authenticator, Microsoft Authenticator or
                  Authy).
                </li>
                <li>Scan this QR code, or type the key below into the app.</li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
              <div className="flex justify-center rounded-lg border border-border bg-white p-3">
                <img src={setupData.qr} alt="Two-factor setup QR code" width={224} height={224} />
              </div>
              <p className="break-all rounded-md bg-muted px-3 py-2 text-center font-mono text-xs tracking-wider">
                {setupData.secret}
              </p>
              <div className="space-y-2">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  name="code"
                  autoComplete="off"
                  inputMode="numeric"
                  autoFocus
                  placeholder="123456"
                  className="font-mono tracking-widest"
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
              </div>
              <FormError message={formError} />
              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting ? "Verifying…" : "Turn on 2FA"}
              </Button>
              <BackLink onClick={backToStart} />
            </form>
          )}

          {step === "recovery" && (
            <div className="space-y-5">
              <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/50 p-3 font-mono text-sm">
                {recoveryCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    void navigator.clipboard?.writeText(recoveryCodes.join("\n"));
                    toast.success("Backup codes copied.");
                  }}
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => window.print()}
                >
                  Print
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Each code works once. They are not shown again after you continue.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  onChange={(e) => setSavedCodes(e.target.checked)}
                  className="size-4"
                />
                I have saved these codes somewhere safe.
              </label>
              <FormError message={formError} />
              <Button
                size="lg"
                className="w-full"
                disabled={!savedCodes || submitting}
                onClick={async () => {
                  try {
                    setRecoveryCodes([]);
                    await enterApp();
                  } catch {
                    setFormError("Something went wrong. Please log in again.");
                  }
                }}
              >
                Continue to LedgerFlow
              </Button>
            </div>
          )}

          {step === "newpassword" && (
            <form className="space-y-5" onSubmit={handleNewPassword} noValidate autoComplete="off">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
                <p className="text-xs text-muted-foreground">
                  At least 12 characters. Don&apos;t reuse a password from anywhere else.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
              </div>
              <FormError message={formError} />
              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting ? "Saving…" : "Save password and continue"}
              </Button>
            </form>
          )}
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

const HEADINGS: Record<Step, { title: string; text: string }> = {
  credentials: { title: "Log in", text: "Enter your credentials to access LedgerFlow." },
  totp: {
    title: "Two-factor check",
    text: "Enter the 6-digit code from your authenticator app.",
  },
  activation: {
    title: "Activate your account",
    text: "Enter the activation code your administrator gave you.",
  },
  setup: {
    title: "Set up two-factor login",
    text: "Administrator accounts must use an authenticator app.",
  },
  recovery: {
    title: "Save your backup codes",
    text: "Use one of these if you ever lose your phone.",
  },
  newpassword: {
    title: "Choose your password",
    text: "Pick a new password that only you know.",
  },
};

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
    >
      Back to login
    </button>
  );
}
