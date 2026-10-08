import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FileText,
  Users,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ReceiptText,
  FilePlus,
  UserPlus,
  Receipt,
  ListChecks,
  History,
  ChevronRight,
  type LucideIcon,
} from "@/lib/icons";
import { useLedger } from "@/lib/ledger/store";
import { usePermissions } from "@/lib/ledger/permissions";
import { formatDate, formatMoney, round2 } from "@/lib/ledger/calc";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { cn } from "@/lib/utils";
import { RequireView } from "@/components/app/RequireView";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — LedgerFlow" },
      {
        name: "description",
        content:
          "Accounts receivable dashboard showing invoiced, received and outstanding balances in GBP.",
      },
      { property: "og:title", content: "Dashboard — LedgerFlow" },
      {
        property: "og:description",
        content: "Receivables overview with outstanding invoices and recent payments.",
      },
    ],
  }),
  component: Dashboard,
});

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

type RangeKey = "6M" | "12M" | "YTD";

function Dashboard() {
  return (
    <RequireView module="dashboard">
      <DashboardContent />
    </RequireView>
  );
}

function DashboardContent() {
  const { data, invoiceViews, invoiceViewsWithCredit } = useLedger();
  const { user, can, isAdmin } = usePermissions();
  const [range, setRange] = useState<RangeKey>("6M");

  const firstName = (user?.displayName || user?.username || "").split(/\s+/)[0] ?? "";

  const totals = useMemo(() => {
    const invoiced = round2(invoiceViews.reduce((s, i) => s + i.total, 0));
    const received = round2(invoiceViews.reduce((s, i) => s + i.paid, 0));
    return {
      invoiced,
      received,
      outstanding: round2(invoiced - received),
      paidCount: invoiceViewsWithCredit.filter((i) => i.effectiveStatus === "paid").length,
      pendingCount: invoiceViewsWithCredit.filter((i) => i.effectiveStatus !== "paid").length,
    };
  }, [invoiceViews, invoiceViewsWithCredit]);

  const outstandingRows = useMemo(
    () =>
      invoiceViewsWithCredit
        .filter((i) => i.effectiveOutstanding > 0.004)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 8),
    [invoiceViewsWithCredit],
  );

  const recentPayments = useMemo(() => {
    const byInvoice = new Map(invoiceViews.map((i) => [i.id, i]));
    return [...data.payments]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
      .map((p) => ({ ...p, invoice: byInvoice.get(p.invoiceId) }));
  }, [data.payments, invoiceViews]);

  // Same definition of "overdue" the header bell uses.
  const overdueRows = useMemo(
    () =>
      invoiceViewsWithCredit
        .filter((i) => i.effectiveOutstanding > 0.004 && i.ageing > 0)
        .sort((a, b) => b.ageing - a.ageing),
    [invoiceViewsWithCredit],
  );

  const overdueTotal = useMemo(
    () => round2(overdueRows.reduce((s, i) => s + i.effectiveOutstanding, 0)),
    [overdueRows],
  );

  // Open invoices that fall due within the next 14 days (read-only view).
  const upcomingRows = useMemo(() => {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return invoiceViewsWithCredit
      .filter((i) => i.effectiveOutstanding > 0.004 && i.ageing <= 0 && i.dueDate)
      .map((i) => ({
        ...i,
        daysLeft: Math.round(
          (new Date(i.dueDate + "T00:00:00").getTime() - todayMidnight) / 86_400_000,
        ),
      }))
      .filter((i) => i.daysLeft >= 0 && i.daysLeft <= 14)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [invoiceViewsWithCredit]);

  const chartData = useMemo(() => {
    const months = new Map<string, { month: string; invoiced: number; received: number }>();
    const ensure = (key: string) => {
      if (!months.has(key)) months.set(key, { month: key, invoiced: 0, received: 0 });
      return months.get(key)!;
    };
    invoiceViews.forEach((i) => (ensure(monthKey(i.invoiceDate)).invoiced += i.total));
    data.payments.forEach((p) => (ensure(monthKey(p.date)).received += p.amount));
    const sorted = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
    const visible =
      range === "6M"
        ? sorted.slice(-6)
        : range === "12M"
          ? sorted.slice(-12)
          : sorted.filter((m) => m.month.startsWith(String(new Date().getFullYear())));
    return visible.map((m) => ({
      month: new Date(m.month + "-01T00:00:00").toLocaleDateString("en-GB", {
        month: "short",
        year: "2-digit",
      }),
      invoiced: round2(m.invoiced),
      received: round2(m.received),
    }));
  }, [invoiceViews, data.payments, range]);

  // Display-only ratios derived from the totals above.
  const collectionRate = totals.invoiced > 0 ? (totals.received / totals.invoiced) * 100 : 0;
  const outstandingShare = totals.invoiced > 0 ? (totals.outstanding / totals.invoiced) * 100 : 0;
  const activeClients = data.clients.filter((c) => c.status === "active").length;

  const statusPaid = totals.paidCount;
  const statusOverdue = overdueRows.length;
  const statusPending = Math.max(0, totals.pendingCount - statusOverdue);
  const statusTotal = statusPaid + statusPending + statusOverdue;


  // ---- Display-only helpers for the glass dashboard (no calculation above is changed) ----
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const greeting = !now
    ? "Welcome,"
    : now.getHours() < 12
      ? "Good morning,"
      : now.getHours() < 18
        ? "Good afternoon,"
        : "Good evening,";
  const todayLabel = now
    ? now.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  // Last 6 calendar months: invoiced, received and running outstanding (for sparklines / trend).
  const monthly = useMemo(() => {
    if (!now) return null;
    const keys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const invoicedBy = new Map<string, number>();
    invoiceViews.forEach((i) => {
      const k = monthKey(i.invoiceDate);
      invoicedBy.set(k, (invoicedBy.get(k) ?? 0) + i.total);
    });
    const receivedBy = new Map<string, number>();
    data.payments.forEach((pm) => {
      const k = monthKey(pm.date);
      receivedBy.set(k, (receivedBy.get(k) ?? 0) + pm.amount);
    });
    const invoiced = keys.map((k) => invoicedBy.get(k) ?? 0);
    const received = keys.map((k) => receivedBy.get(k) ?? 0);
    const outstanding = keys.map((k) => {
      let inv = 0;
      let rec = 0;
      invoicedBy.forEach((v, mk) => {
        if (mk <= k) inv += v;
      });
      receivedBy.forEach((v, mk) => {
        if (mk <= k) rec += v;
      });
      return inv - rec;
    });
    return { invoiced, received, outstanding };
  }, [now, invoiceViews, data.payments]);

  const pctChange = (series?: number[]) => {
    if (!series || series.length < 2) return null;
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    if (Math.abs(prev) < 0.005) return null;
    return ((last - prev) / Math.abs(prev)) * 100;
  };

  const topClients = useMemo(() => {
    const m = new Map<string, { name: string; total: number }>();
    invoiceViews.forEach((i) => {
      const e = m.get(i.clientId) ?? { name: i.clientCompany || i.clientName, total: 0 };
      e.total += i.total;
      m.set(i.clientId, e);
    });
    return [...m.values()]
      .map((c) => ({ ...c, total: round2(c.total) }))
      .sort((x, y) => y.total - x.total)
      .slice(0, 5);
  }, [invoiceViews]);

  const recentActivity = useMemo(() => {
    const byInvoice = new Map(invoiceViews.map((i) => [i.id, i]));
    const items = [
      ...invoiceViews.map((i) => ({
        key: `inv-${i.id}`,
        kind: "invoice" as const,
        date: i.invoiceDate,
        title: "Invoice Created",
        detail: `${i.number} has been created`,
      })),
      ...data.payments.map((pm) => ({
        key: `pay-${pm.id}`,
        kind: "payment" as const,
        date: pm.date,
        title: "Payment Received",
        detail: `${formatMoney(pm.amount)} from ${byInvoice.get(pm.invoiceId)?.clientCompany ?? "client"}`,
      })),
    ];
    return items.sort((x, y) => y.date.localeCompare(x.date)).slice(0, 4);
  }, [invoiceViews, data.payments]);

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const invoiceCount = invoiceViews.length;

  // Donut segments for the Invoice Status card.
  const donut = (() => {
    const r = 46;
    const c = 2 * Math.PI * r;
    let acc = 0;
    return [
      { key: "paid", n: statusPaid, color: "var(--color-brand-mark)" },
      { key: "pending", n: statusPending, color: "var(--color-warning)" },
      { key: "overdue", n: statusOverdue, color: "var(--color-destructive)" },
    ]
      .filter((seg) => seg.n > 0 && statusTotal > 0)
      .map((seg) => {
        const len = (seg.n / statusTotal) * c;
        const out = { ...seg, dash: `${len} ${c - len}`, offset: -acc };
        acc += len;
        return out;
      });
  })();

  const quickActions: {
    to: "/invoices" | "/clients" | "/payments" | "/reports";
    label: string;
    icon: LucideIcon;
    tint: string;
    iconTint: string;
    show: boolean;
  }[] = [
    {
      to: "/invoices",
      label: "Create Invoice",
      icon: FilePlus,
      tint: "border-success/20 bg-success/[0.08] hover:bg-success/[0.14]",
      iconTint: "bg-success/20 text-success",
      show: can("invoices", "view"),
    },
    {
      to: "/clients",
      label: "Add Client",
      icon: UserPlus,
      tint: "border-info/20 bg-info/[0.08] hover:bg-info/[0.14]",
      iconTint: "bg-info/20 text-info",
      show: can("clients", "view"),
    },
    {
      to: "/payments",
      label: "Record Payment",
      icon: Wallet,
      tint: "border-[oklch(0.7_0.17_295/0.22)] bg-[oklch(0.6_0.2_295/0.1)] hover:bg-[oklch(0.6_0.2_295/0.17)]",
      iconTint: "bg-[oklch(0.6_0.2_295/0.25)] text-[oklch(0.8_0.14_295)]",
      show: can("payments", "view"),
    },
    {
      to: "/reports",
      label: "View Reports",
      icon: Receipt,
      tint: "border-info/20 bg-[oklch(0.55_0.17_265/0.1)] hover:bg-[oklch(0.55_0.17_265/0.17)]",
      iconTint: "bg-[oklch(0.55_0.17_265/0.28)] text-[oklch(0.8_0.12_265)]",
      show: can("reports", "view"),
    },
  ];
  const visibleActions = quickActions.filter((a) => a.show);

  return (
    <div className="lf-dash lf-stack">
      <div className="lf-dash-grid">
        {/* ------------------------------ main column ------------------------------ */}
        <div className="lf-col lf-stack">
          <Panel className="relative overflow-hidden">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_120%_at_85%_-20%,oklch(0.55_0.13_175/0.38),transparent_65%)]"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 top-1/2 h-48 w-2/3 -translate-y-1/2 rotate-[-8deg] rounded-[50%] border-t border-brand-mark/25 opacity-70"
            />
            <div className="lf-hero">
              <div className="min-w-0">
                <p className="text-[12.5px] text-muted-foreground">{greeting}</p>
                <h2 className="mt-0.5 text-[clamp(1.2rem,1.9vw,1.55rem)] font-semibold leading-tight tracking-tight text-foreground">
                  {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
                </h2>
                <p className="mt-1 text-[12.5px] text-foreground/80">
                  Here&apos;s your receivables overview.
                </p>
                <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/15 px-2.5 py-0.5 text-[11px] font-medium text-success">
                  <span className="size-1.5 rounded-full bg-success shadow-[0_0_8px_var(--color-success)]" />
                  All systems operational
                </span>
              </div>
              {todayLabel ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 backdrop-blur-md">
                  <span className="flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-foreground/85">
                    <Clock className="size-4" />
                  </span>
                  <div className="leading-tight">
                    <p className="text-[12.5px] font-semibold text-foreground">Today</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{todayLabel}</p>
                  </div>
                  <ChevronRight className="ml-1.5 size-3.5 text-muted-foreground" />
                </div>
              ) : null}
            </div>
          </Panel>

          <div className="lf-cards4">
            <SummaryCard
              premium
              label="Total Invoiced"
              value={formatMoney(totals.invoiced)}
              sublabel={`${invoiceViews.length} invoices inc VAT`}
              icon={FileText}
              tone="success"
              trend={pctChange(monthly?.invoiced)}
              spark={monthly?.invoiced}
            />
            <SummaryCard
              premium
              label="Total Received"
              value={formatMoney(totals.received)}
              sublabel={`${collectionRate.toFixed(1)}% collection rate · ${data.payments.length} payments`}
              icon={Wallet}
              tone="default"
              trend={pctChange(monthly?.received)}
              spark={monthly?.received}
            />
            <SummaryCard
              premium
              label="Outstanding Balance"
              value={formatMoney(totals.outstanding)}
              sublabel={`${outstandingShare.toFixed(1)}% of invoiced`}
              icon={ReceiptText}
              tone="warning"
              trend={pctChange(monthly?.outstanding)}
              spark={monthly?.outstanding}
            />
            <SummaryCard
              premium
              label="Overdue"
              value={formatMoney(overdueTotal)}
              sublabel={
                overdueRows.length === 0
                  ? "Nothing past due"
                  : `${overdueRows.length} invoice${overdueRows.length === 1 ? "" : "s"} past due date`
              }
              icon={AlertTriangle}
              tone="danger"
            />
          </div>

          <div className="lf-cards3">
            <MiniStat
              to="/clients"
              icon={Users}
              iconTint="bg-success/20 text-success border-success/25"
              label="Total Clients"
              value={String(data.clients.length)}
              sub={`${activeClients} active account${activeClients === 1 ? "" : "s"}`}
              pill={`${pct(activeClients, data.clients.length)}% active`}
              pillTone="success"
            />
            <MiniStat
              to="/invoices"
              icon={CheckCircle2}
              iconTint="bg-success/20 text-success border-success/25"
              label="Paid Invoices"
              value={String(totals.paidCount)}
              sub="Settled in full"
              pill={`${pct(totals.paidCount, invoiceCount)}%`}
              pillTone="info"
            />
            <MiniStat
              to="/invoices"
              icon={Clock}
              iconTint="bg-warning/20 text-warning border-warning/25"
              label="Pending Invoices"
              value={String(totals.pendingCount)}
              sub="Partially paid or unpaid"
              pill={`${pct(totals.pendingCount, invoiceCount)}%`}
              pillTone="warning"
            />
          </div>

          <div className="lf-chartrow">
            <Panel>
              <PanelHeader
                title="Receivables Overview"
                description="Invoiced versus received over time."
                actions={
                  <div
                    role="group"
                    aria-label="Chart period"
                    className="inline-flex rounded-lg border border-white/10 bg-white/[0.05] p-0.5"
                  >
                    {(["6M", "12M", "YTD"] as RangeKey[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRange(r)}
                        aria-pressed={range === r}
                        className={cn(
                          "rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                          range === r
                            ? "bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_oklch(0.74_0.15_170/0.7)]"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                }
              />
              <div className="lf-chart">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
                    No invoices or payments in this period.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
                      barGap={4}
                    >
                      <defs>
                        <linearGradient id="lfInvoiced" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="oklch(0.82 0.16 170)" />
                          <stop offset="100%" stopColor="oklch(0.6 0.13 185)" />
                        </linearGradient>
                        <linearGradient id="lfReceived" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="oklch(0.72 0.16 245)" />
                          <stop offset="100%" stopColor="oklch(0.5 0.17 255)" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="2 4"
                        vertical={false}
                        stroke="oklch(1 0 0 / 0.1)"
                      />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(v: number) => formatMoney(v)}
                        cursor={{ fill: "oklch(1 0 0)", opacity: 0.05 }}
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 12,
                          background: "var(--color-popover)",
                          color: "var(--color-popover-foreground)",
                          border: "1px solid oklch(1 0 0 / 0.12)",
                          boxShadow: "0 12px 30px -10px rgba(0,0,0,0.6)",
                        }}
                        labelStyle={{ color: "var(--color-muted-foreground)" }}
                        itemStyle={{ color: "var(--color-popover-foreground)" }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        align="left"
                        wrapperStyle={{
                          fontSize: 12,
                          paddingLeft: 12,
                          color: "var(--color-muted-foreground)",
                        }}
                        iconType="circle"
                        iconSize={8}
                      />
                      <Bar
                        dataKey="invoiced"
                        name="Invoiced"
                        fill="url(#lfInvoiced)"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={28}
                      />
                      <Bar
                        dataKey="received"
                        name="Received"
                        fill="url(#lfReceived)"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Invoice Status" description="Where every invoice stands." />
              <div className="flex flex-col items-center gap-4 p-4">
                <div className="relative size-32">
                  <svg viewBox="0 0 120 120" className="size-full -rotate-90">
                    <circle
                      cx="60"
                      cy="60"
                      r="46"
                      fill="none"
                      stroke="oklch(1 0 0 / 0.08)"
                      strokeWidth="11"
                    />
                    {donut.map((seg) => (
                      <circle
                        key={seg.key}
                        cx="60"
                        cy="60"
                        r="46"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="11"
                        strokeDasharray={seg.dash}
                        strokeDashoffset={seg.offset}
                        strokeLinecap="butt"
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
                    <span className="num text-[22px] font-semibold text-foreground">
                      {statusTotal}
                    </span>
                    <span className="text-[10px] text-muted-foreground">Total Invoices</span>
                  </div>
                </div>
                <ul className="w-full space-y-2 text-[12px]">
                  {[
                    { label: "Paid", n: statusPaid, dot: "bg-brand-mark" },
                    { label: "Pending (not yet due)", n: statusPending, dot: "bg-warning" },
                    { label: "Overdue", n: statusOverdue, dot: "bg-destructive" },
                  ].map((row) => (
                    <li key={row.label} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-foreground">
                        <span className={cn("size-2 rounded-full", row.dot)} />
                        {row.label}
                      </span>
                      <span className="flex items-center gap-4">
                        <span className="num font-medium">{row.n}</span>
                        <span className="num w-10 text-right text-muted-foreground">
                          {pct(row.n, statusTotal)}%
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          </div>
        </div>

        {/* ------------------------------- right rail ------------------------------- */}
        <div className="lf-rail">
          {visibleActions.length > 0 ? (
            <Panel>
              <div className="flex items-center gap-2 px-4 pb-1 pt-4">
                <ListChecks className="size-4 text-brand-mark" />
                <h3 className="text-[14px] font-semibold text-foreground">Quick Actions</h3>
              </div>
              <div className="space-y-2 p-3 pt-2">
                {visibleActions.map((a) => (
                  <Link
                    key={a.label}
                    to={a.to}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-xl border p-1.5 pr-2.5 text-[12.5px] font-medium text-foreground transition-colors",
                      a.tint,
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        a.iconTint,
                      )}
                    >
                      <a.icon className="size-4" />
                    </span>
                    {a.label}
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel>
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <div className="flex items-center gap-2">
                <History className="size-4 text-brand-mark" />
                <h3 className="text-[14px] font-semibold text-foreground">Recent Activity</h3>
              </div>
              {isAdmin ? (
                <Link to="/activity-log" className="text-xs font-medium text-brand-mark hover:underline">
                  View all
                </Link>
              ) : null}
            </div>
            {recentActivity.length === 0 ? (
              <p className="px-4 pb-4 pt-2 text-[12px] text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="space-y-0.5 p-2">
                {recentActivity.map((a) => (
                  <li key={a.key} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg border",
                        a.kind === "invoice"
                          ? "border-success/25 bg-success/15 text-success"
                          : "border-info/25 bg-info/15 text-info",
                      )}
                    >
                      {a.kind === "invoice" ? (
                        <FileText className="size-4" />
                      ) : (
                        <Wallet className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[12px] font-medium text-foreground">
                          {a.title}
                        </p>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatDate(a.date)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{a.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-brand-mark" />
                <h3 className="text-[14px] font-semibold text-foreground">Top Clients</h3>
              </div>
              {can("clients", "view") ? (
                <Link to="/clients" className="text-xs font-medium text-brand-mark hover:underline">
                  View all
                </Link>
              ) : null}
            </div>
            {topClients.length === 0 ? (
              <p className="px-4 pb-4 pt-2 text-[12px] text-muted-foreground">No invoices yet.</p>
            ) : (
              <ul className="space-y-3 p-4 pt-3">
                {topClients.map((c, idx) => {
                  const initials =
                    c.name
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w.charAt(0).toUpperCase())
                      .join("") || "?";
                  const width = topClients[0].total > 0 ? (c.total / topClients[0].total) * 100 : 0;
                  return (
                    <li key={`${c.name}-${idx}`} className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white",
                          idx % 2 === 0
                            ? "bg-gradient-to-br from-[oklch(0.6_0.17_285)] to-[oklch(0.5_0.18_270)]"
                            : "bg-gradient-to-br from-[oklch(0.62_0.17_250)] to-[oklch(0.5_0.17_255)]",
                        )}
                      >
                        {initials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2 text-[12px]">
                          <span className="truncate font-medium text-foreground">{c.name}</span>
                          <span className="num shrink-0 text-muted-foreground">
                            {formatMoney(c.total)}
                          </span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-brand-mark to-[oklch(0.65_0.14_190)]"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel className="lf-rail-promo relative overflow-hidden">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_100%,oklch(0.55_0.13_175/0.35),transparent_65%)]"
            />
            <div className="relative p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-brand-mark/20 text-brand-mark">
                  <ReceiptText className="size-3.5" />
                </span>
                <p className="text-[12.5px] font-semibold text-foreground">Streamline your receivables</p>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Automate follow-ups, track payments, and get better cash flow.
              </p>
              {can("reports", "view") ? (
                <Link
                  to="/reports"
                  className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-[oklch(0.72_0.15_170)] to-[oklch(0.6_0.13_180)] px-3 py-1.5 text-[11.5px] font-semibold text-primary-foreground shadow-[0_8px_20px_-8px_oklch(0.74_0.15_170/0.7)] transition-transform hover:-translate-y-px"
                >
                  Learn more
                  <ChevronRight className="size-3.5" />
                </Link>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>

      <div className="lf-two">
        <Panel>
          <PanelHeader
            title="Outstanding Invoices"
            description="Open invoices by due date."
            actions={
              <Link to="/invoices" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          {outstandingRows.length === 0 ? (
            <EmptyState title="Nothing outstanding" description="Every invoice is settled." />
          ) : (
            <TableWrap>
              <Table className="min-w-[600px]">
                <THead>
                  <TR>
                    <TH>Invoice No.</TH>
                    <TH>Client</TH>
                    <TH>Due Date</TH>
                    <TH align="right">Amount</TH>
                    <TH align="right">Paid</TH>
                    <TH align="right">Outstanding</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {outstandingRows.map((i) => (
                    <TR key={i.id}>
                      <TD mono>{i.number}</TD>
                      <TD>{i.clientCompany}</TD>
                      <TD>
                        {formatDate(i.dueDate)}
                        {i.ageing > 0 ? (
                          <span className="ml-1.5 text-[11px] font-medium text-destructive">
                            {i.ageing}d overdue
                          </span>
                        ) : null}
                      </TD>
                      <TD mono align="right">
                        {formatMoney(i.total)}
                      </TD>
                      <TD mono align="right">
                        {formatMoney(i.paid)}
                      </TD>
                      <TD mono align="right">
                        {formatMoney(i.effectiveOutstanding)}
                      </TD>
                      <TD>
                        <StatusBadge status={i.effectiveStatus} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent Payments"
            description="Latest receipts against invoices."
            actions={
              <Link to="/payments" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          {recentPayments.length === 0 ? (
            <EmptyState
              title="No payments recorded"
              description="Record a payment to see it here."
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[460px]">
                <THead>
                  <TR>
                    <TH>Payment Date</TH>
                    <TH>Client</TH>
                    <TH>Invoice</TH>
                    <TH>Payment Method</TH>
                    <TH align="right">Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {recentPayments.map((p) => (
                    <TR key={p.id}>
                      <TD>{formatDate(p.date)}</TD>
                      <TD>{p.invoice?.clientCompany ?? "—"}</TD>
                      <TD mono>{p.invoice?.number ?? "—"}</TD>
                      <TD>{p.method}</TD>
                      <TD mono align="right">
                        {formatMoney(p.amount)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Needs Attention"
          description="Overdue invoices and those falling due in the next 14 days."
        />
        <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
          <div className="p-4">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-destructive">
              <AlertTriangle className="size-3.5" />
              Overdue ({overdueRows.length})
            </p>
            {overdueRows.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing is past its due date.</p>
            ) : (
              <ul className="space-y-1">
                {overdueRows.slice(0, 5).map((i) => (
                  <li key={i.id}>
                    <Link
                      to="/invoices"
                      search={{ q: i.number }}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[13px] transition-colors hover:bg-accent/60"
                    >
                      <span className="min-w-0">
                        <span className="num font-medium text-foreground">{i.number}</span>
                        <span className="ml-2 truncate text-muted-foreground">
                          {i.clientCompany}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="num block font-semibold text-foreground">
                          {formatMoney(i.effectiveOutstanding)}
                        </span>
                        <span className="block text-[11px] text-destructive">
                          {i.ageing} day{i.ageing === 1 ? "" : "s"} overdue
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-4">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-warning">
              <Clock className="size-3.5" />
              Due soon ({upcomingRows.length})
            </p>
            {upcomingRows.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No invoices fall due in the next 14 days.
              </p>
            ) : (
              <ul className="space-y-1">
                {upcomingRows.slice(0, 5).map((i) => (
                  <li key={i.id}>
                    <Link
                      to="/invoices"
                      search={{ q: i.number }}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[13px] transition-colors hover:bg-accent/60"
                    >
                      <span className="min-w-0">
                        <span className="num font-medium text-foreground">{i.number}</span>
                        <span className="ml-2 truncate text-muted-foreground">
                          {i.clientCompany}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="num block font-semibold text-foreground">
                          {formatMoney(i.effectiveOutstanding)}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {i.daysLeft === 0
                            ? "Due today"
                            : `Due in ${i.daysLeft} day${i.daysLeft === 1 ? "" : "s"}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function MiniStat({
  to,
  icon: Icon,
  iconTint,
  label,
  value,
  sub,
  pill,
  pillTone,
}: {
  to: "/clients" | "/invoices";
  icon: LucideIcon;
  iconTint: string;
  label: string;
  value: string;
  sub: string;
  pill: string;
  pillTone: "success" | "info" | "warning";
}): ReactNode {
  const pillCls = {
    success: "border-success/25 bg-success/15 text-success",
    info: "border-info/25 bg-info/15 text-info",
    warning: "border-warning/25 bg-warning/15 text-warning",
  }[pillTone];
  return (
    <Link
      to={to}
      className="panel-interactive group flex flex-col gap-1.5 px-3.5 py-3"
      style={{ borderRadius: 16 }}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", iconTint)}
        >
          <Icon className="size-4" />
        </span>
        <p className="text-[12.5px] text-foreground/85">{label}</p>
        <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="num text-[20px] font-semibold leading-none text-foreground">{value}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10.5px] text-muted-foreground">{sub}</p>
        <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold", pillCls)}>
          {pill}
        </span>
      </div>
    </Link>
  );
}