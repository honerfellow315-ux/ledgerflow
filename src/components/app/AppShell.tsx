import { useMemo, useState, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Banknote,
  FileSpreadsheet,
  Bell,
  Building2,
  ChevronRight,
  ClipboardList,
  Clock,
  FileMinus,
  FileText,
  HardHat,
  History,
  IdCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  ReceiptText,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useLedger } from "@/lib/ledger/store";
import { usePermissions } from "@/lib/ledger/permissions";
import { signOutAndReload } from "@/components/app/LoginGate";
import { formatMoney } from "@/lib/ledger/calc";
import type { Module } from "@/lib/permissions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type NavPath =
  | "/"
  | "/clients"
  | "/companies"
  | "/invoices"
  | "/payments"
  | "/expenses"
  | "/hours"
  | "/subcontracting"
  | "/salary"
  | "/payroll"
  | "/staff"
  | "/credit-notes"
  | "/statements"
  | "/reports"
  | "/settings"
  | "/users"
  | "/recycle-bin"
  | "/activity-log";

interface NavItem {
  to: NavPath;
  label: string;
  icon: typeof LayoutDashboard;
  /** The permission module gating this link's visibility. `null` for links
   * (like the admin-only Users screen) that aren't part of the module x
   * action permission map — those are gated separately (isAdmin). */
  module: Module | null;
  exact?: boolean;
}

const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, module: "dashboard", exact: true },
    ],
  },
  {
    heading: "Receivables",
    items: [
      { to: "/clients", label: "Clients", icon: Users, module: "clients" },
      { to: "/companies", label: "Companies", icon: Building2, module: "companies" },
      { to: "/invoices", label: "Invoices", icon: FileText, module: "invoices" },
      { to: "/payments", label: "Payments", icon: Wallet, module: "payments" },
      { to: "/credit-notes", label: "Credit Notes", icon: FileMinus, module: "creditNotes" },
      { to: "/statements", label: "Statements", icon: ClipboardList, module: "statements" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { to: "/hours", label: "Hours", icon: Clock, module: "hours" },
      { to: "/subcontracting", label: "Subcontracting", icon: HardHat, module: "subcontracting" },
      { to: "/salary", label: "Salary Sheet", icon: Banknote, module: "salary" },
      { to: "/payroll", label: "Payroll Sheet", icon: FileSpreadsheet, module: "payroll" },
      { to: "/staff", label: "Staff", icon: IdCard, module: "staff" },
      { to: "/expenses", label: "Expenses", icon: ReceiptText, module: "expenses" },
    ],
  },
  {
    heading: "Insight",
    items: [
      { to: "/reports", label: "Reports", icon: Receipt, module: "reports" },
      { to: "/settings", label: "Settings", icon: SettingsIcon, module: "settings" },
    ],
  },
  {
    heading: "Admin",
    items: [
      { to: "/users", label: "Users", icon: ShieldCheck, module: null },
      { to: "/recycle-bin", label: "Recycle Bin", icon: RotateCcw, module: null },
      { to: "/activity-log", label: "Activity Log", icon: History, module: null },
    ],
  },
];

const ALL_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function titleFor(pathname: string) {
  if (pathname === "/") return "Dashboard";
  if (pathname.startsWith("/clients/")) return "Client Detail";
  const match = ALL_NAV.find((n) => n.to !== "/" && pathname.startsWith(n.to));
  return match?.label ?? "LedgerFlow";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { can, isAdmin } = usePermissions();

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => (item.module ? can(item.module, "view") : isAdmin)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "sidebar-shell fixed inset-y-0 left-0 z-40 flex w-60 flex-col text-sidebar-foreground transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border/80 px-4">
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-mark to-primary text-xs font-bold text-brand-mark-foreground shadow-[0_4px_14px_-3px_oklch(0.7_0.135_168/0.5)] ring-1 ring-white/15 after:absolute after:inset-0 after:rounded-xl after:bg-gradient-to-b after:from-white/25 after:to-transparent">
            LF
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[14px] font-semibold tracking-tight text-sidebar-accent-foreground">
              LedgerFlow
            </p>
            <p className="sidebar-glow-text truncate text-[9.5px] font-semibold uppercase tracking-[0.16em]">
              Receivables Suite
            </p>
          </div>
          <button
            className="ml-auto shrink-0 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto p-3">
          {visibleGroups.map((group) => (
            <div key={group.heading} className="space-y-0.5">
              <p className="flex items-center gap-1.5 px-2 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
                <span className="h-px flex-1 bg-gradient-to-r from-sidebar-border/0 via-sidebar-border to-sidebar-border/0" />
                {group.heading}
                <span className="h-px flex-1 bg-gradient-to-r from-sidebar-border/0 via-sidebar-border to-sidebar-border/0" />
              </p>
              {group.items.map((item) => {
                const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150",
                      active
                        ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/75 text-sidebar-primary-foreground shadow-[0_3px_12px_-2px_oklch(0.2_0.03_258/0.55)] ring-1 ring-white/10"
                        : "text-sidebar-foreground/80 hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6.5 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
                        active
                          ? "bg-white/15 text-sidebar-primary-foreground"
                          : "bg-white/[0.04] text-sidebar-foreground/70 group-hover:bg-white/10 group-hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="size-3.5 shrink-0" />
                    </span>
                    {item.label}
                    {active ? <ChevronRight className="ml-auto size-3.5 opacity-70" /> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border/80 bg-black/10 p-3">
          <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
            <span className="flex size-1.5 shrink-0 rounded-full bg-brand-mark shadow-[0_0_6px_1px_oklch(0.7_0.135_168/0.7)]" />
            <p className="truncate text-[10px] font-medium tracking-wide text-sidebar-foreground/50">
              LedgerFlow · Receivables Suite
            </p>
          </div>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="app-content flex min-w-0 flex-1 flex-col lg:pl-60">
        <AppHeader title={titleFor(pathname)} onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function AppHeader({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { data, invoiceViews, invoiceViewsWithCredit } = useLedger();
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return { clients: [], invoices: [] };
    return {
      clients: data.clients
        .filter((c) => `${c.name} ${c.company}`.toLowerCase().includes(q))
        .slice(0, 4),
      invoices: invoiceViews
        .filter((i) => `${i.number} ${i.clientCompany}`.toLowerCase().includes(q))
        .slice(0, 4),
    };
  }, [query, data.clients, invoiceViews]);

  // Credit-adjusted: an invoice already covered by an earlier overpayment is
  // neither "open" nor "overdue".
  const openInvoices = invoiceViewsWithCredit.filter((i) => i.effectiveStatus !== "paid").length;
  const overdueInvoices = invoiceViewsWithCredit.filter(
    (i) => i.effectiveOutstanding > 0.004 && i.ageing > 0,
  ).length;
  const showResults = query.trim().length >= 2;

  return (
    <header
      role="banner"
      className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 shadow-[0_1px_0_0_var(--color-border),0_4px_12px_-8px_oklch(0.25_0.03_255/0.15)] backdrop-blur-sm lg:px-6"
    >
      <button className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <div className="flex items-center gap-2">
        <span className="hidden h-4 w-1 rounded-full bg-gradient-to-b from-primary to-primary-emphasis sm:block" />
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h1>
      </div>

      <div className="relative ml-auto hidden w-72 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients or invoices…"
          aria-label="Search clients or invoices"
          className="h-8 w-full rounded-full border border-input bg-surface-muted pl-8 pr-3 text-[13px] outline-none transition-all duration-150 placeholder:text-muted-foreground focus:border-ring focus:bg-surface focus:shadow-[0_0_0_3px_oklch(0.51_0.09_190/0.14)]"
        />
        {showResults ? (
          <div className="absolute left-0 right-0 top-9 z-30 max-h-80 overflow-y-auto rounded-sm border border-border bg-popover p-1 shadow-lg">
            {results.clients.length === 0 && results.invoices.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">No matches found.</p>
            ) : null}
            {results.clients.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setQuery("");
                  navigate({ to: "/clients/$clientId", params: { clientId: c.id } });
                }}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent"
              >
                <span className="truncate">{c.company}</span>
                <span className="text-[10px] uppercase text-muted-foreground">Client</span>
              </button>
            ))}
            {results.invoices.map((i) => (
              <button
                key={i.id}
                onClick={() => {
                  setQuery("");
                  navigate({ to: "/invoices", search: { q: i.number } });
                }}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent"
              >
                <span className="num truncate">{i.number}</span>
                <span className="num text-xs text-muted-foreground">{formatMoney(i.total)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <button
            className="relative ml-auto flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:border-primary/30 hover:bg-accent hover:text-accent-foreground md:ml-0"
            aria-label="Notifications"
          >
            <Bell className="size-4" />
            {overdueInvoices > 0 ? (
              <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                {overdueInvoices}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <p className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Notifications
          </p>
          <div className="space-y-1 p-3 text-[13px]">
            {openInvoices === 0 && overdueInvoices === 0 ? (
              <p className="text-muted-foreground">No notifications.</p>
            ) : (
              <>
                <p className="font-medium">
                  {openInvoices} invoice{openInvoices === 1 ? "" : "s"} awaiting settlement
                </p>
                <p className="text-xs text-muted-foreground">{overdueInvoices} past the due date</p>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        onClick={() => void signOutAndReload()}
        className="flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:border-primary/30 hover:bg-accent hover:text-accent-foreground"
        aria-label="Log out"
        title="Log out"
      >
        <LogOut className="size-3.5" />
        <span className="hidden sm:inline">Log out</span>
      </button>
    </header>
  );
}
