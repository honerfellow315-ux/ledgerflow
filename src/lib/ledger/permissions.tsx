import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { me } from "@/lib/actions/auth";
import { hasPermission, type Action, type Module, type Permissions } from "@/lib/permissions";

export interface CurrentUser {
  username: string;
  displayName: string;
  role: "admin" | "user";
  permissions: Permissions;
}

interface PermissionsContextValue {
  user: CurrentUser | null;
  /** True once the initial `me()` fetch has settled (success or failure). */
  ready: boolean;
  isAdmin: boolean;
  can: (module: Module, action: Action) => boolean;
  refresh: () => void;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

/**
 * Hydrates the logged-in user's role + permissions once (LoginGate already
 * calls `me()` to decide whether to show the login form, but doesn't expose
 * the result — this fetches it again, which is cheap and keeps the two
 * concerns separate: "are we logged in" vs "what can this user do").
 *
 * Wrap the app with <PermissionsProvider> inside <LoginGate> (i.e. only once
 * we know there's a session) so `user` is non-null as soon as `ready` flips.
 */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    me()
      .then((result) => {
        if (cancelled) return;
        setUser(result);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const value = useMemo<PermissionsContextValue>(() => {
    const isAdmin = user?.role === "admin";
    return {
      user,
      ready,
      isAdmin,
      can: (module, action) =>
        hasPermission(user?.role ?? "user", user?.permissions, module, action),
      refresh: () => setNonce((n) => n + 1),
    };
  }, [user, ready]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions must be used inside PermissionsProvider");
  return ctx;
}
