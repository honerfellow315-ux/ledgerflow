import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  const { user } = usePermissions();
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

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Here&apos;s your receivables overview.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          premium
          label="Total Invoiced"
          value={formatMoney(totals.invoiced)}
          sublabel={`${invoiceViews.length} invoices inc VAT`}
          icon={FileText}
        />
        <SummaryCard
          premium
          label="Total Received"
          value={formatMoney(totals.received)}
          sublabel={`${collectionRate.toFixed(1)}% collection rate · ${data.payments.length} payments`}
          icon={Wallet}
          tone="success"
        />
        <SummaryCard
          premium
          label="Outstanding Balance"
          value={formatMoney(totals.outstanding)}
          sublabel={`${outstandingShare.toFixed(1)}% of invoiced`}
          icon={ReceiptText}
          tone="warning"
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

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          premium
          label="Total Clients"
          value={String(data.clients.length)}
          sublabel={`${activeClients} active account${activeClients === 1 ? "" : "s"}`}
          icon={Users}
        />
        <SummaryCard
          premium
          label="Paid Invoices"
          value={String(totals.paidCount)}
          sublabel="Settled in full"
          icon={CheckCircle2}
          tone="success"
        />
        <SummaryCard
          premium
          label="Pending Invoices"
          value={String(totals.pendingCount)}
          sublabel="Partially paid or unpaid"
          icon={Clock}
          tone="warning"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelHeader
            title="Receivables Overview"
            description="Invoiced versus received over time."
            actions={
              <div
                role="group"
                aria-label="Chart period"
                className="inline-flex rounded-lg border border-border bg-surface p-0.5"
              >
                {(["6M", "12M", "YTD"] as RangeKey[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    aria-pressed={range === r}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
                      range === r
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            }
          />
          <div className="h-72 px-2 py-4">
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
                  <CartesianGrid
                    strokeDasharray="2 4"
                    vertical={false}
                    stroke="var(--color-border)"
                    strokeOpacity={0.8}
                  />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => formatMoney(v)}
                    cursor={{ fill: "var(--color-accent)", opacity: 0.45 }}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 10,
                      border: "1px solid var(--color-border)",
                      boxShadow: "0 8px 24px -10px rgba(0,0,0,0.25)",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                  <Bar
                    dataKey="invoiced"
                    name="Invoiced"
                    fill="var(--color-primary)"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="received"
                    name="Received"
                    fill="var(--color-brand-mark)"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Invoice Status" description="Where every invoice stands." />
          <div className="space-y-4 p-4">
            {statusTotal > 0 ? (
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="bg-brand-mark"
                  style={{ width: `${(statusPaid / statusTotal) * 100}%` }}
                />
                <span
                  className="bg-warning/70"
                  style={{ width: `${(statusPending / statusTotal) * 100}%` }}
                />
                <span
                  className="bg-destructive/70"
                  style={{ width: `${(statusOverdue / statusTotal) * 100}%` }}
                />
              </div>
            ) : null}
            <ul className="space-y-3 text-[13px]">
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-foreground">
                  <span className="size-2 rounded-full bg-brand-mark" />
                  Paid
                </span>
                <span className="num font-semibold">{statusPaid}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-foreground">
                  <span className="size-2 rounded-full bg-warning/70" />
                  Pending (not yet due)
                </span>
                <span className="num font-semibold">{statusPending}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-foreground">
                  <span className="size-2 rounded-full bg-destructive/70" />
                  Overdue
                </span>
                <span className="num font-semibold">{statusOverdue}</span>
              </li>
            </ul>
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              {statusTotal} invoice{statusTotal === 1 ? "" : "s"} in total
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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