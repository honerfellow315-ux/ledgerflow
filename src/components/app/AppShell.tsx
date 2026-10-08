import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Banknote,
  FileSpreadsheet,
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  FileMinus,
  FileText,
  HardHat,
  History,
  IdCard,
  LayoutDashboard,
  ListChecks,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  | "/timesheets"
  | "/tasks"
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
      { to: "/timesheets", label: "Timesheet Check", icon: ListChecks, module: null },
      { to: "/tasks", label: "Tasks", icon: ClipboardList, module: null },
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

const COLLAPSE_KEY = "lf-nav-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { can, isAdmin } = usePermissions();

  // Remember the collapsed/expanded choice between visits (UI preference only).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage unavailable — default to expanded */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => (item.module ? can(item.module, "view") : isAdmin)),
  })).filter((group) => group.items.length > 0);

  return (
    <TooltipProvider delayDuration={80}>
      <div className="lf-shell" data-collapsed={collapsed ? "true" : "false"}>
        <aside
          data-collapsed={collapsed ? "true" : "false"}
          data-open={mobileOpen ? "true" : "false"}
          className="sidebar-shell lf-sidebar text-sidebar-foreground"
        >
          {/* Brand + collapse toggle */}
          <div className="lf-brand">
            <span className="lf-logo">LF</span>
            <div className="lf-brand-text">
              <p className="lf-brand-name">LedgerFlow</p>
              <p className="lf-brand-sub">Receivables Suite</p>
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!collapsed}
              className="lf-toggle"
            >
              <ChevronDown />
            </button>
            <button
              type="button"
              className="lf-close"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="lf-nav">
            {visibleGroups.map((group, gi) => (
              <div key={group.heading}>
                {group.heading !== "Overview" ? (
                  <>
                    <p className="lf-group-title">{group.heading}</p>
                    {gi > 0 ? <div className="lf-sep" /> : null}
                  </>
                ) : null}
                {group.items.map((item) => {
                  const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
                  const link = (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      aria-label={item.label}
                      className={cn("lf-item", active && "nav-active")}
                    >
                      <span className="lf-item-icon">
                        <item.icon />
                      </span>
                      <span className="lf-item-label">{item.label}</span>
                      <ChevronRight className="lf-chev" />
                    </Link>
                  );
                  return collapsed ? (
                    <Tooltip key={item.to}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent
                        side="right"
                        sideOffset={14}
                        className="rounded-xl border border-white/10 bg-popover px-3 py-1.5 text-[12px] font-medium text-popover-foreground shadow-menu"
                      >
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Footer card */}
          <div className="lf-footer">
            <div className="lf-footer-card">
              <span className="lf-dot" />
              <div className="lf-footer-text">
                <b>LedgerFlow</b>
                <span>Receivables Suite</span>
                <span>v2.4.0</span>
              </div>
              <ChevronRight className="lf-chev" style={{ marginLeft: "auto" }} />
            </div>
          </div>
        </aside>

        {mobileOpen ? <div className="lf-scrim" onClick={() => setMobileOpen(false)} /> : null}

        <div className="app-content lf-content">
          <AppHeader title={titleFor(pathname)} onMenu={() => setMobileOpen(true)} />
          <main className="lf-main">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function AppHeader({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { data, invoiceViews, invoiceViewsWithCredit } = useLedger();
  const { user } = usePermissions();
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const displayName = user?.displayName || user?.username || "Account";
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "U";

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
    <header role="banner" className="lf-header">
      <button className="lf-menu-btn" onClick={onMenu} aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      {title !== "Dashboard" ? <h1>{title}</h1> : null}

      <div className="lf-search">
        <Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients, companies, invoices…"
          aria-label="Search clients or invoices"
        />
        <kbd className="lf-kbd">⌘ K</kbd>
        {showResults ? (
          <div className="absolute left-0 right-0 top-12 z-30 max-h-80 overflow-y-auto rounded-2xl border border-white/10 bg-popover/95 p-1.5 shadow-menu backdrop-blur-xl">
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
          <button className="lf-icon-btn" aria-label="Notifications">
            <Bell />
            {overdueInvoices > 0 ? <span className="lf-badge">{overdueInvoices}</span> : null}
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="lf-user" aria-label="Account menu">
            <span className="lf-avatar">{initials}</span>
            <span className="lf-user-name">{displayName}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-[13px] font-semibold text-foreground">{displayName}</p>
            {user?.username ? (
              <p className="truncate text-xs text-muted-foreground">
                {user.username}
                {user.role === "admin" ? " · Administrator" : ""}
              </p>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void signOutAndReload()}
            className="cursor-pointer text-[13px]"
          >
            <LogOut />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}