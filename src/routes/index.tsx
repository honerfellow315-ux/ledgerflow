import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
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
import { FileText, Users, Wallet, AlertTriangle, CheckCircle2, Clock } from "@/lib/icons";
import { useLedger } from "@/lib/ledger/store";
import { formatDate, formatMoney, round2 } from "@/lib/ledger/calc";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
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

function Dashboard() {
  return (
    <RequireView module="dashboard">
      <DashboardContent />
    </RequireView>
  );
}

function DashboardContent() {
  const { data, invoiceViews, invoiceViewsWithCredit } = useLedger();

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

  const chartData = useMemo(() => {
    const months = new Map<string, { month: string; invoiced: number; received: number }>();
    const ensure = (key: string) => {
      if (!months.has(key)) months.set(key, { month: key, invoiced: 0, received: 0 });
      return months.get(key)!;
    };
    invoiceViews.forEach((i) => (ensure(monthKey(i.invoiceDate)).invoiced += i.total));
    data.payments.forEach((p) => (ensure(monthKey(p.date)).received += p.amount));
    return [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6)
      .map((m) => ({
        month: new Date(m.month + "-01T00:00:00").toLocaleDateString("en-GB", {
          month: "short",
          year: "2-digit",
        }),
        invoiced: round2(m.invoiced),
        received: round2(m.received),
      }));
  }, [invoiceViews, data.payments]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          label="Total Clients"
          value={String(data.clients.length)}
          sublabel={`${data.clients.filter((c) => c.status === "active").length} active accounts`}
          icon={Users}
        />
        <SummaryCard
          label="Total Invoiced"
          value={formatMoney(totals.invoiced)}
          sublabel={`${invoiceViews.length} invoices inc VAT`}
          icon={FileText}
        />
        <SummaryCard
          label="Total Received"
          value={formatMoney(totals.received)}
          sublabel={`${data.payments.length} payments recorded`}
          icon={Wallet}
          tone="success"
        />
        <SummaryCard
          label="Outstanding Balance"
          value={formatMoney(totals.outstanding)}
          sublabel="Across all open invoices"
          icon={AlertTriangle}
          tone="danger"
        />
        <SummaryCard
          label="Paid Invoices"
          value={String(totals.paidCount)}
          sublabel="Settled in full"
          icon={CheckCircle2}
          tone="success"
        />
        <SummaryCard
          label="Pending Invoices"
          value={String(totals.pendingCount)}
          sublabel="Partially paid or unpaid"
          icon={Clock}
          tone="warning"
        />
      </div>

      <Panel>
        <PanelHeader
          title="Receivables Overview"
          description="Invoiced versus received by month."
        />
        <div className="h-64 px-2 py-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
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
                contentStyle={{ fontSize: 12, borderRadius: 4 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="invoiced"
                name="Invoiced"
                fill="var(--color-primary)"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="received"
                name="Received"
                fill="var(--color-success)"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Outstanding Receivables"
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
              <Table>
                <THead>
                  <TR>
                    <TH>Invoice No.</TH>
                    <TH>Client</TH>
                    <TH>Invoice Date</TH>
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
                      <TD>{formatDate(i.invoiceDate)}</TD>
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
              <Table>
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
    </div>
  );
}
