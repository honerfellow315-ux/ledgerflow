import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useLedger } from "@/lib/ledger/store";
import { RequireView } from "@/components/app/RequireView";
import { formatDate, formatMoney, paymentOwnerClientId, round2 } from "@/lib/ledger/calc";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { SummaryCard } from "@/components/app/SummaryCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/reports/")({
  head: () => ({
    meta: [
      { title: "Reports — LedgerFlow" },
      {
        name: "description",
        content:
          "Outstanding receivables, client statements, payment history and invoice summary reports in GBP.",
      },
      { property: "og:title", content: "Reports — LedgerFlow" },
      {
        property: "og:description",
        content:
          "Outstanding receivables, client statements, payment history and an invoice summary.",
      },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <RequireView module="reports">
      <ReportsPageContent />
    </RequireView>
  );
}

function ReportsPageContent() {
  const { data, invoiceViews, invoiceViewsWithCredit } = useLedger();
  const [statementClient, setStatementClient] = useState(data.clients[0]?.id ?? "");

  const outstanding = useMemo(
    () =>
      invoiceViewsWithCredit
        .filter((i) => i.effectiveOutstanding > 0.004)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [invoiceViewsWithCredit],
  );

  const summary = useMemo(() => {
    const ex = round2(invoiceViews.reduce((s, i) => s + i.amountExVat, 0));
    const vat = round2(invoiceViews.reduce((s, i) => s + i.vat, 0));
    const total = round2(ex + vat);
    const paid = round2(invoiceViews.reduce((s, i) => s + i.paid, 0));
    return {
      ex,
      vat,
      total,
      paid,
      outstanding: round2(total - paid),
      counts: {
        paid: invoiceViewsWithCredit.filter((i) => i.effectiveStatus === "paid").length,
        partial: invoiceViewsWithCredit.filter((i) => i.effectiveStatus === "partial").length,
        unpaid: invoiceViewsWithCredit.filter((i) => i.effectiveStatus === "unpaid").length,
      },
    };
  }, [invoiceViews, invoiceViewsWithCredit]);

  const statement = useMemo(() => {
    const invoices = invoiceViews.filter((i) => i.clientId === statementClient);
    const byInvoice = new Map(invoiceViews.map((i) => [i.id, i]));
    const payments = data.payments.filter(
      (p) => paymentOwnerClientId(p, byInvoice) === statementClient,
    );
    const rows = [
      ...invoices.map((i) => ({
        key: `i-${i.id}`,
        date: i.invoiceDate,
        detail: `Invoice ${i.number}`,
        debit: i.total,
        credit: 0,
      })),
      ...payments.map((p) => ({
        key: `p-${p.id}`,
        date: p.date,
        detail: `Payment ${p.reference || byInvoice.get(p.invoiceId)?.number || ""} (${p.method})`,
        debit: 0,
        credit: p.amount,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    let balance = 0;
    return rows.map((r) => {
      balance = round2(balance + r.debit - r.credit);
      return { ...r, balance };
    });
  }, [invoiceViews, data.payments, statementClient]);

  const paymentHistory = useMemo(() => {
    const byInvoice = new Map(invoiceViews.map((i) => [i.id, i]));
    const byClient = new Map(data.clients.map((c) => [c.id, c]));
    return [...data.payments]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((p) => ({
        ...p,
        invoiceNumber: byInvoice.get(p.invoiceId)?.number ?? "—",
        company: byClient.get(p.clientId)?.company ?? "Unknown",
      }));
  }, [data.payments, data.clients, invoiceViews]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Net (ex VAT)" value={formatMoney(summary.ex)} />
        <SummaryCard label="VAT at 20%" value={formatMoney(summary.vat)} />
        <SummaryCard label="Received" value={formatMoney(summary.paid)} tone="success" />
        <SummaryCard label="Outstanding" value={formatMoney(summary.outstanding)} tone="warning" />
      </div>

      <Panel>
        <PanelHeader
          title="Outstanding Receivables"
          description={`${outstanding.length} invoices with a balance due, oldest due date first`}
        />
        {outstanding.length === 0 ? (
          <EmptyState title="Nothing outstanding" description="All invoices are settled." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Invoice No.</TH>
                  <TH>Client</TH>
                  <TH>Due Date</TH>
                  <TH align="right">Inc VAT</TH>
                  <TH align="right">Paid</TH>
                  <TH align="right">Outstanding</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {outstanding.map((i) => (
                  <TR key={i.id}>
                    <TD mono className="font-medium">
                      {i.number}
                    </TD>
                    <TD>{i.clientCompany}</TD>
                    <TD>{formatDate(i.dueDate)}</TD>
                    <TD mono align="right">
                      {formatMoney(i.total)}
                    </TD>
                    <TD mono align="right">
                      {formatMoney(i.paid)}
                    </TD>
                    <TD mono align="right" className="font-medium">
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
          title="Client Statement"
          description="Running balance for the selected client"
          actions={
            <Select value={statementClient} onValueChange={setStatementClient}>
              <SelectTrigger className="h-8 w-56 text-[13px]">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {data.clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {statement.length === 0 ? (
          <EmptyState title="No ledger activity for this client" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Detail</TH>
                  <TH align="right">Debit</TH>
                  <TH align="right">Credit</TH>
                  <TH align="right">Balance</TH>
                </TR>
              </THead>
              <TBody>
                {statement.map((r) => (
                  <TR key={r.key}>
                    <TD>{formatDate(r.date)}</TD>
                    <TD>{r.detail}</TD>
                    <TD mono align="right">
                      {r.debit ? formatMoney(r.debit) : "—"}
                    </TD>
                    <TD mono align="right">
                      {r.credit ? formatMoney(r.credit) : "—"}
                    </TD>
                    <TD mono align="right" className="font-medium">
                      {formatMoney(r.balance)}
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
          title="Payment History"
          description={`${paymentHistory.length} payments recorded across all clients`}
        />
        {paymentHistory.length === 0 ? (
          <EmptyState title="No payments recorded" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Client</TH>
                  <TH>Invoice</TH>
                  <TH>Method</TH>
                  <TH>Reference</TH>
                  <TH align="right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {paymentHistory.map((p) => (
                  <TR key={p.id}>
                    <TD>{formatDate(p.date)}</TD>
                    <TD>{p.company}</TD>
                    <TD mono>{p.invoiceNumber}</TD>
                    <TD>{p.method}</TD>
                    <TD mono>{p.reference || "—"}</TD>
                    <TD mono align="right" className="font-medium">
                      {formatMoney(p.amount)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Invoice Summary" description="Totals across the whole ledger" />
        <TableWrap>
          <Table className="min-w-0">
            <TBody>
              <SummaryRow label="Invoices raised" value={String(invoiceViews.length)} />
              <SummaryRow label="Net total (ex VAT)" value={formatMoney(summary.ex)} />
              <SummaryRow label="VAT total (20%)" value={formatMoney(summary.vat)} />
              <SummaryRow label="Gross total (inc VAT)" value={formatMoney(summary.total)} />
              <SummaryRow label="Total received" value={formatMoney(summary.paid)} />
              <SummaryRow label="Total outstanding" value={formatMoney(summary.outstanding)} />
              <SummaryRow label="Paid invoices" value={String(summary.counts.paid)} />
              <SummaryRow label="Partially paid invoices" value={String(summary.counts.partial)} />
              <SummaryRow label="Unpaid invoices" value={String(summary.counts.unpaid)} />
            </TBody>
          </Table>
        </TableWrap>
      </Panel>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <TR>
      <TD className="text-muted-foreground">{label}</TD>
      <TD mono align="right" className="font-medium">
        {value}
      </TD>
    </TR>
  );
}
