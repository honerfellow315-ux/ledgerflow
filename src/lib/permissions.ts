/**
 * Canonical module x action permission model for LedgerFlow RBAC.
 *
 * This file is intentionally isomorphic (no `server/` in its path, no
 * server-only imports) so it can be imported by:
 *   - drizzle/schema.ts (to type the `users.permissions` jsonb column)
 *   - src/lib/server/auth.ts (requirePermission() — the real security gate)
 *   - src/lib/actions/*.ts (which module/action each server fn requires)
 *   - src/lib/ledger/permissions.tsx (the frontend usePermissions()/can() hook)
 *
 * Permission model is deliberately module x action, NOT field-level:
 * "can this user create invoices" rather than "can this user edit an
 * invoice's VAT rate". Every module gets `view`; most get
 * create/edit/delete; a few are read-only; `invoices` and `salary` additionally get
 * `approve` (approving/unapproving is treated as a distinct, more sensitive
 * action from ordinary editing).
 *
 * Admins bypass this map entirely (see hasPermission() below) — regular
 * users are gated by exactly what's ticked here.
 */

export const MODULES = [
  "dashboard",
  "clients",
  "companies",
  "invoices",
  "payments",
  "statements",
  "subcontracting",
  "expenses",
  "creditNotes",
  "hours",
  "salary",
  "payroll",
  "staff",
  "reports",
  "settings",
] as const;

export type Module = (typeof MODULES)[number];

export const ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * Which actions are meaningful for each module. Dashboard/Statements/Reports
 * are read-only surfaces (computed/derived views, nothing to create or
 * delete there). Invoices is the only module with `approve`. Settings has no
 * create/delete — just view (see the settings screen) and edit.
 */
export const MODULE_ACTIONS: Record<Module, readonly Action[]> = {
  dashboard: ["view"],
  clients: ["view", "create", "edit", "delete"],
  companies: ["view", "create", "edit", "delete"],
  invoices: ["view", "create", "edit", "delete", "approve"],
  payments: ["view", "create", "edit", "delete"],
  statements: ["view"],
  subcontracting: ["view", "create", "edit", "delete"],
  expenses: ["view", "create", "edit", "delete"],
  creditNotes: ["view", "create", "edit", "delete"],
  hours: ["view", "create", "edit", "delete"],
  // approve = verify / close / reopen a salary month (the sensitive steps)
  salary: ["view", "create", "edit", "delete", "approve"],
  // NI numbers + bank details live here, so it is granted separately
  // payroll sheets (All Payroll Format); approve = verify / close / reopen / push to salary sheet
  payroll: ["view", "create", "edit", "delete", "approve"],
  staff: ["view", "create", "edit"],
  reports: ["view"],
  settings: ["view", "edit"],
};

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Dashboard",
  clients: "Clients",
  companies: "Companies",
  invoices: "Invoices",
  payments: "Payments",
  statements: "Statements",
  subcontracting: "Subcontracting",
  expenses: "Expenses",
  creditNotes: "Credit Notes",
  hours: "Hours",
  salary: "Salary Sheet",
  payroll: "Payroll Sheet",
  staff: "Staff (NI & bank details)",
  reports: "Reports",
  settings: "Settings",
};

export const ACTION_LABELS: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
};

/** Sparse on purpose: a missing module or action key means "not granted". */
export type Permissions = Partial<Record<Module, Partial<Record<Action, boolean>>>>;

/** Every module/action pair set to `true` — used to seed the migrated
 * original admin (see README-BACKEND.md) and as the default when creating a
 * new admin through the Users screen. */
export function fullPermissions(): Permissions {
  const perms: Permissions = {};
  for (const module of MODULES) {
    const actionPerms: Partial<Record<Action, boolean>> = {};
    for (const action of MODULE_ACTIONS[module]) actionPerms[action] = true;
    perms[module] = actionPerms;
  }
  return perms;
}

/** Every module/action pair set to `false` (nothing granted) — the default
 * starting point when creating a plain "user" through the Users screen. */
export function emptyPermissions(): Permissions {
  const perms: Permissions = {};
  for (const module of MODULES) {
    const actionPerms: Partial<Record<Action, boolean>> = {};
    for (const action of MODULE_ACTIONS[module]) actionPerms[action] = false;
    perms[module] = actionPerms;
  }
  return perms;
}

/** The single source of truth for "is `module`/`action` granted". Admins
 * always pass; anyone else needs an explicit `true`. Used identically on the
 * server (requirePermission) and the client (usePermissions().can). */
export function hasPermission(
  role: "admin" | "user",
  permissions: Permissions | null | undefined,
  module: Module,
  action: Action,
): boolean {
  if (role === "admin") return true;
  return permissions?.[module]?.[action] === true;
}
