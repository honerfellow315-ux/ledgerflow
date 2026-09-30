import type { ReactNode } from "react";
import { LockKeyhole } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import type { Module } from "@/lib/permissions";

/**
 * Route-level guard: renders `children` only if the current user can view
 * `module`, otherwise shows a "not permitted" panel instead. This is a UX
 * nicety, not the security boundary — every server function behind this
 * screen has its own `requirePermission()` check, which is what actually
 * stops a disallowed request (see src/lib/server/auth.ts).
 *
 * Wrap each route's page component's returned JSX with this, e.g.:
 *   return <RequireView module="invoices"><InvoicesPageContent /></RequireView>
 */
export function RequireView({ module, children }: { module: Module; children: ReactNode }) {
  const { can, ready } = usePermissions();

  // Avoid a flash of "not permitted" before the initial `me()` call settles.
  if (!ready) return null;

  if (!can(module, "view")) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-sm border border-dashed border-border px-6 py-16 text-center">
        <span className="mb-4 flex size-10 items-center justify-center rounded-full border border-border bg-surface-muted text-muted-foreground">
          <LockKeyhole className="size-4.5" aria-hidden="true" />
        </span>
        <p className="text-[15px] font-semibold text-foreground">You don't have access to this</p>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          Ask an administrator to grant you view access to this section if you need it.
        </p>
      </div>
    );
  }

  return children;
}
