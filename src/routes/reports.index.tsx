import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLedger } from "@/lib/ledger/store";
import { RequireView } from "@/components/app/RequireView";
import {
  formatDate,
  formatMoney,
  paymentOwnerClientId,
  creditNoteOwnerClientId,
  creditNoteTotal,
  round2,
} from "@/lib/ledger/calc";
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
  const {
    data,
    invoiceViews: allInvoices,
    invoiceViewsWithCredit: allCreditInvoices,
  } = useLedger();
  const [companyId, setCompanyId] = useState("");
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const clients = useMemo(
    () =>
      data.clients.filter(
        (c) => !companyId || (companyId === "default" ? !c.companyId : c.companyId === companyId),
      ),
    [data.clients, companyId],
  );
  const scopedIds = useMemo(
    () => new Set(clients.filter((c) => !clientId || c.id === clientId).map((c) => c.id)),
    [clients, clientId],
  );
  const inDates = useCallback(
    (date: string) => (!from || date >= from) && (!to || date <= to),
    [from, to],
  );
  const invalidDates = !!from && !!to && from > to;
  const invoiceViewsWithCredit = allCreditInvoices.filter(
    (i) =>
      !invalidDates &&
      scopedIds.has(i.clientId) &&
      inDates(i.invoiceDate) &&
      (!status ||
        (status === "overdue"
          ? i.ageing > 0 && i.effectiveOutstanding > 0.004
          : i.effectiveStatus === status)) &&
      (!search.trim() ||
        `${i.number} ${i.clientName} ${i.clientCompany} ${i.description}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const filteredIds = useMemo(
    () => new Set(invoiceViewsWithCredit.map((i) => i.id)),
    [invoiceViewsWithCredit],
  );
  const invoiceViews = allInvoices.filter((i) => filteredIds.has(i.id));
  const [statementClient, setStatementClient] = useState(data.clients[0]?.id ?? "");

  useEffect(() => {
    const available = clients.filter((c) => !clientId || c.id === clientId);
    if (!available.some((c) => c.id === statementClient))
      setStatementClient(available[0]?.id ?? "");
  }, [clients, clientId, statementClient]);

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
      outstanding: round2(
        invoiceViewsWithCredit.reduce((sum, i) => sum + i.effectiveOutstanding, 0),
      ),
      counts: {
        paid: invoiceViewsWithCredit.filter((i) => i.effectiveStatus === "paid").length,
        partial: invoiceViewsWithCredit.filter((i) => i.effectiveStatus === "partial").length,
        unpaid: invoiceViewsWithCredit.filter((i) => i.effectiveStatus === "unpaid").length,
      },
    };
  }, [invoiceViews, invoiceViewsWithCredit]);

  const statement = useMemo(() => {
    if (invalidDates || !scopedIds.has(statementClient)) return [];
    const byInvoice = new Map(allInvoices.map((i) => [i.id, i]));
    const ids = new Set(
      allCreditInvoices
        .filter(
          (i) =>
            i.clientId === statementClient &&
            (!status ||
              (status === "overdue"
                ? i.ageing > 0 && i.effectiveOutstanding > 0.004
                : i.effectiveStatus === status)) &&
            (!search.trim() ||
              `${i.number} ${i.clientName} ${i.clientCompany} ${i.description}`
                .toLowerCase()
                .includes(search.trim().toLowerCase())),
        )
        .map((i) => i.id),
    );
    const invoices = allInvoices.filter((i) => ids.has(i.id));
    const payments = data.payments.filter(
      (p) =>
        paymentOwnerClientId(p, byInvoice) === statementClient &&
        ((!status && !search.trim()) || ids.has(p.invoiceId)),
    );
    const credits = data.creditNotes.filter(
      (n) =>
        n.status !== "draft" &&
        creditNoteOwnerClientId(n, byInvoice) === statementClient &&
        ((!status && !search.trim()) || (!!n.invoiceId && ids.has(n.invoiceId))),
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
      ...credits.map((n) => ({
        key: `c-${n.id}`,
        date: n.date,
        detail: `Credit note ${n.number}`,
        debit: 0,
        credit: creditNoteTotal(n),
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    let balance = from
      ? round2(rows.filter((r) => r.date < from).reduce((sum, r) => sum + r.debit - r.credit, 0))
      : 0;
    const result = from
      ? [{ key: "opening", date: from, detail: "Opening balance", debit: 0, credit: 0, balance }]
      : [];
    for (const row of rows.filter((r) => inDates(r.date))) {
      balance = round2(balance + row.debit - row.credit);
      result.push({ ...row, balance });
    }
    return result;
  }, [
    allInvoices,
    allCreditInvoices,
    data.payments,
    data.creditNotes,
    statementClient,
    from,
    status,
    search,
    invalidDates,
    scopedIds,
    inDates,
  ]);

  const paymentHistory = useMemo(() => {
    const byInvoice = new Map(allInvoices.map((i) => [i.id, i]));
    const byClient = new Map(data.clients.map((c) => [c.id, c]));
    return data.payments
      .filter(
        (p) =>
          !invalidDates &&
          scopedIds.has(paymentOwnerClientId(p, byInvoice)) &&
          inDates(p.date) &&
          ((!status && !search.trim()) || filteredIds.has(p.invoiceId)),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((p) => ({
        ...p,
        invoiceNumber: byInvoice.get(p.invoiceId)?.number ?? "—",
        company: byClient.get(paymentOwnerClientId(p, byInvoice))?.company ?? "Unknown",
      }));
  }, [
    data.payments,
    data.clients,
    allInvoices,
    status,
    search,
    invalidDates,
    scopedIds,
    inDates,
    filteredIds,
  ]);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Report filters"
          description="Invoice totals use invoice dates. Payment rows use payment dates. Statements include the opening balance and issued credit notes."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-xs">
            Company
            <Select
              value={companyId || "all"}
              onValueChange={(value) => {
                setCompanyId(value === "all" ? "" : value);
                setClientId("");
              }}
            >
              <SelectTrigger aria-label="Company" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                <SelectItem value="default">Default business</SelectItem>
                {data.companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-xs">
            Client
            <Select
              value={clientId || "all"}
              onValueChange={(value) => {
                const id = value === "all" ? "" : value;
                setClientId(id);
                if (id) setStatementClient(id);
              }}
            >
              <SelectTrigger aria-label="Client" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company} · {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-xs">
            Invoice status
            <Select
              value={status || "all"}
              onValueChange={(value) => setStatus(value === "all" ? "" : value)}
            >
              <SelectTrigger aria-label="Invoice status" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partial">Partially paid</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="text-xs">
            From
            <input
              aria-label="From"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border bg-background px-2"
            />
          </label>
          <label className="text-xs">
            To
            <input
              aria-label="To"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border bg-background px-2"
            />
          </label>
          <label className="text-xs">
            Invoice / client search
            <input
              aria-label="Invoice or client search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border bg-background px-2"
              placeholder="Invoice number, client, description"
            />
          </label>
          <button
            type="button"
            className="text-left text-xs text-brand-mark hover:underline"
            onClick={() => {
              setCompanyId("");
              setClientId("");
              setStatus("");
              setSearch("");
              setFrom("");
              setTo("");
            }}
          >
            Reset filters
          </button>
          {invalidDates ? (
            <p role="alert" className="text-xs text-destructive">
              From date must be before or equal to To date.
            </p>
          ) : null}
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Net (ex VAT)" value={formatMoney(summary.ex)} />
        <SummaryCard label="VAT" value={formatMoney(summary.vat)} />
        <SummaryCard label="Received" value={formatMoney(summary.paid)} tone="success" />
        <SummaryCard label="Outstanding" value={formatMoney(summary.outstanding)} tone="warning" />
      </div>

      <Panel>
        <PanelHeader
          title="Invoices"
          description={`${invoiceViewsWithCredit.length} invoices matching these filters`}
        />
        {!invoiceViewsWithCredit.length ? (
          <EmptyState title="No matching invoices" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Client</TH>
                  <TH>Date</TH>
                  <TH>Due</TH>
                  <TH align="right">Total</TH>
                  <TH align="right">Credited</TH>
                  <TH align="right">Outstanding</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {invoiceViewsWithCredit.map((i) => (
                  <TR key={i.id}>
                    <TD mono>{i.number}</TD>
                    <TD>
                      {i.clientCompany} · {i.clientName}
                    </TD>
                    <TD>{formatDate(i.invoiceDate)}</TD>
                    <TD>{formatDate(i.dueDate)}</TD>
                    <TD align="right" mono>
                      {formatMoney(i.total)}
                    </TD>
                    <TD align="right" mono>
                      {formatMoney(i.credited)}
                    </TD>
                    <TD align="right" mono>
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
          description="Running balance for the selected client, including the opening balance before From"
          actions={
            <Select value={statementClient} onValueChange={setStatementClient}>
              <SelectTrigger className="h-8 w-56 text-[13px]">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {clients
                  .filter((c) => !clientId || c.id === clientId)
                  .map((c) => (
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
          description={`${paymentHistory.length} payments matching these filters`}
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
        <PanelHeader
          title="Invoice Summary"
          description="Totals for invoices matching these filters"
        />
        <TableWrap>
          <Table className="min-w-0">
            <TBody>
              <SummaryRow label="Invoices raised" value={String(invoiceViews.length)} />
              <SummaryRow label="Net total (ex VAT)" value={formatMoney(summary.ex)} />
              <SummaryRow label="VAT total" value={formatMoney(summary.vat)} />
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
