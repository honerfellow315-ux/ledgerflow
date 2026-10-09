import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Printer, Wallet } from "@/lib/icons";
import { useLedger } from "@/lib/ledger/store";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import {
  CompanyClientPicker,
  ALL_COMPANIES,
  clientsInCompany,
} from "@/components/app/CompanyClientPicker";
import {
  applyClientCredit,
  businessProfileFor,
  creditNoteOwnerClientId,
  creditNoteTotal,
  endClientOptions,
  matchesEndClient,
  paymentOwnerClientId,
  totalsForViews,
  UNASSIGNED_END_CLIENT,
  formatDate,
  formatMonth,
  formatMoney,
  round2,
  type InvoiceViewWithCredit,
} from "@/lib/ledger/calc";
import { downloadCsv } from "@/lib/ledger/csv";
import { downloadStatementXlsx } from "@/lib/ledger/statementExcel";
import { shouldUseSafariPrintLayout } from "@/lib/print-browser";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Client, Settings } from "@/lib/ledger/types";

export const Route = createFileRoute("/statements/")({
  head: () => ({
    meta: [
      { title: "Statements — LedgerFlow" },
      {
        name: "description",
        content:
          "Per-client statement of account combining invoices, payments and credit notes with a running balance, ready to export as CSV or print for the client.",
      },
      { property: "og:title", content: "Statements — LedgerFlow" },
      {
        property: "og:description",
        content: "Running account statements per client with CSV export and a print-ready layout.",
      },
    ],
  }),
  component: StatementsPage,
});

type EntryType = "Invoice" | "Payment" | "Credit Note";

interface StatementEntry {
  key: string;
  date: string;
  type: EntryType;
  reference: string;
  description: string;
  debit: number;
  credit: number;
}

export interface StatementRow extends StatementEntry {
  balance: number;
}

/** Same-day ordering: invoices first, then credit notes, then payments. */
const TYPE_ORDER: Record<EntryType, number> = { Invoice: 0, "Credit Note": 1, Payment: 2 };

const TYPE_STYLES: Record<EntryType, string> = {
  Invoice: "bg-info-soft text-info border-info/25",
  Payment: "bg-success-soft text-success border-success/25",
  "Credit Note": "bg-warning-soft text-warning border-warning/25",
};

type DueFilter = "all" | "due" | "overdue";
export type DueStatus = "due" | "overdue";

export interface OutstandingRow extends InvoiceViewWithCredit {
  dueStatus: DueStatus;
}

const DUE_STATUS_STYLES: Record<DueStatus, string> = {
  due: "bg-warning-soft text-warning border-warning/25",
  overdue: "bg-danger-soft text-destructive border-destructive/25",
};

export const DUE_STATUS_LABEL: Record<DueStatus, string> = {
  due: "Due",
  overdue: "Overdue",
};

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Neutralise spreadsheet formula injection in exported free-text cells. */
function safeCsvText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "client"
  );
}

function StatementsPage() {
  return (
    <RequireView module="statements">
      <StatementsPageContent />
    </RequireView>
  );
}

function StatementsPageContent() {
  const { data, invoiceViews } = useLedger();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Billing company filter for the client list. ALL_COMPANIES = everyone
  // (the behaviour before this filter existed).
  const [companyKey, setCompanyKey] = useState<string>(ALL_COMPANIES);
  // "" = every invoice of the client; UNASSIGNED_END_CLIENT = only invoices with
  // no End Client; otherwise one End Client's own statement.
  const [endClientFilter, setEndClientFilter] = useState<string>("");
  // "" = whole account history (previous behaviour, unchanged default).
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  // Filters the Outstanding Invoices table only; the three totals above it
  // always reflect every outstanding invoice regardless of this filter.
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  // Chrome's print workflow (StatementDocument) stays the default so SSR
  // and first paint never change — only flips to the Safari-safe variant
  // after mount, once we can actually check the browser. See
  // src/lib/print-browser.ts for why iOS needs this regardless of which
  // browser app is being used there.
  const [safariPrint, setSafariPrint] = useState(false);
  useEffect(() => {
    setSafariPrint(shouldUseSafariPrintLayout());
  }, []);

  // Defaults to the first active client of the chosen billing company; falls
  // back to the first client of any status.
  const companyClients = useMemo(
    () => clientsInCompany(data.clients, companyKey),
    [data.clients, companyKey],
  );
  const client = useMemo<Client | undefined>(
    () =>
      companyClients.find((c) => c.id === selectedId) ??
      companyClients.find((c) => c.status === "active") ??
      companyClients[0],
    [companyClients, selectedId],
  );

  // End Clients used on this client's invoices. The selector only appears when
  // at least one invoice has an End Client set.
  const endClients = useMemo(
    () => endClientOptions(data.invoices, client?.id),
    [data.invoices, client?.id],
  );
  const hasEndClients = endClients.names.length > 0;
  const effectiveEndClient = (() => {
    if (!hasEndClients || !endClientFilter) return "";
    if (endClientFilter === UNASSIGNED_END_CLIENT) {
      return endClients.hasUnassigned ? UNASSIGNED_END_CLIENT : "";
    }
    return endClients.names.some((n) => matchesEndClient({ endClient: n }, endClientFilter))
      ? endClientFilter
      : "";
  })();
  const endClientLabel =
    effectiveEndClient === UNASSIGNED_END_CLIENT
      ? "Not assigned to an end client"
      : effectiveEndClient;

  // The client's invoices inside the chosen End Client scope. Payments and
  // credit notes below are attached to these invoices, so ownership always
  // follows the invoice (see calc.ts: paymentOwnerClientId).
  const scopedViews = useMemo(
    () =>
      client
        ? invoiceViews.filter(
            (v) => v.clientId === client.id && matchesEndClient(v, effectiveEndClient),
          )
        : [],
    [client, invoiceViews, effectiveEndClient],
  );
  const { views: scopedViewsWithCredit, remainingCredit: creditOnAccount } = useMemo(
    () => applyClientCredit(scopedViews),
    [scopedViews],
  );

  const { rows, draftCreditNotes } = useMemo(() => {
    if (!client) return { rows: [] as StatementRow[], draftCreditNotes: 0 };
    const invoiceById = new Map(invoiceViews.map((i) => [i.id, i]));
    const scopedIds = new Set(scopedViews.map((v) => v.id));
    const scoped = effectiveEndClient !== "";

    const invoiceEntries: StatementEntry[] = scopedViews.map((i) => ({
      key: `i-${i.id}`,
      date: i.invoiceDate,
      type: "Invoice",
      reference: i.number,
      description: i.description || "Invoice raised",
      debit: i.total,
      credit: 0,
    }));

    const paymentEntries: StatementEntry[] = data.payments
      .filter(
        (p) =>
          paymentOwnerClientId(p, invoiceById) === client.id &&
          (!scoped || scopedIds.has(p.invoiceId)),
      )
      .map((p) => {
        const invoice = invoiceById.get(p.invoiceId);
        return {
          key: `p-${p.id}`,
          date: p.date,
          type: "Payment",
          reference: p.reference || invoice?.number || "—",
          description: invoice
            ? `Payment received (${p.method}) against ${invoice.number}`
            : `Payment received (${p.method})`,
          debit: 0,
          credit: p.amount,
        };
      });

    // Ledger direction for credit notes: issued and applied notes both reduce the
    // balance (credit), the same way they reduce the invoice they are linked to.
    // Drafts are not a ledger event yet.
    // A credit note without a linked invoice has no End Client, so it only shows
    // in the client's full statement.
    const clientNotes = data.creditNotes.filter(
      (n) =>
        creditNoteOwnerClientId(n, invoiceById) === client.id &&
        (!scoped || (n.invoiceId !== undefined && scopedIds.has(n.invoiceId))),
    );
    const creditNoteEntries: StatementEntry[] = clientNotes
      .filter((n) => n.status !== "draft")
      .map((n) => {
        const total = creditNoteTotal(n);
        return {
          key: `c-${n.id}`,
          date: n.date,
          type: "Credit Note",
          reference: n.number,
          description: `${n.reason || "Credit note"} (${n.status})`,
          debit: 0,
          credit: total,
        };
      });

    const sorted = [...invoiceEntries, ...paymentEntries, ...creditNoteEntries].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
        a.key.localeCompare(b.key),
    );

    let balance = 0;
    const withBalance: StatementRow[] = sorted.map((e) => {
      balance = round2(balance + e.debit - e.credit);
      return { ...e, balance };
    });

    return {
      rows: withBalance,
      draftCreditNotes: clientNotes.filter((n) => n.status === "draft").length,
    };
  }, [client, invoiceViews, scopedViews, effectiveEndClient, data.payments, data.creditNotes]);

  // Every unpaid/partial invoice for this client, tagged Due (not yet past
  // its due date) or Overdue (past it), oldest due date first. The three
  // totals below always cover every one of them — only the table rendered
  // from `filteredOutstandingInvoices` narrows with `dueFilter`.
  const { outstandingInvoices, outstandingTotals } = useMemo(() => {
    if (!client) {
      return {
        outstandingInvoices: [] as OutstandingRow[],
        outstandingTotals: { total: 0, overdue: 0, due: 0 },
      };
    }
    // Uses the credit-adjusted figures: an earlier overpayment on one invoice is
    // automatically netted off the client's next unpaid invoice(s), oldest first.
    const invoicesOwed: OutstandingRow[] = scopedViewsWithCredit
      .filter((v) => v.effectiveOutstanding > 0.004)
      .map((v) => ({ ...v, dueStatus: (v.ageing > 0 ? "overdue" : "due") as DueStatus }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
    const total = round2(invoicesOwed.reduce((s, r) => s + r.effectiveOutstanding, 0));
    const overdue = round2(
      invoicesOwed
        .filter((r) => r.dueStatus === "overdue")
        .reduce((s, r) => s + r.effectiveOutstanding, 0),
    );
    return {
      outstandingInvoices: invoicesOwed,
      outstandingTotals: { total, overdue, due: round2(total - overdue) },
    };
  }, [client, scopedViewsWithCredit]);

  const filteredOutstandingInvoices = useMemo(
    () =>
      dueFilter === "all"
        ? outstandingInvoices
        : outstandingInvoices.filter((r) => r.dueStatus === dueFilter),
    [outstandingInvoices, dueFilter],
  );

  // Every month that has any ledger activity for this client, newest first —
  // populates the Month filter without offering empty months.
  const availableMonths = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.date.slice(0, 7)))).sort((a, b) => b.localeCompare(a)),
    [rows],
  );

  // Reset an out-of-range month selection when the client changes (each
  // client has its own activity history), rather than silently showing an
  // empty statement.
  useEffect(() => {
    if (selectedMonth && !availableMonths.includes(selectedMonth)) setSelectedMonth("");
  }, [availableMonths, selectedMonth]);

  // The running balance always reflects full account history (so it stays
  // meaningful), but the visible rows — and the opening balance carried into
  // them — narrow to the selected month. Selecting "All months" is
  // unchanged from before this filter existed.
  const visibleRows = selectedMonth
    ? rows.filter((r) => r.date.slice(0, 7) === selectedMonth)
    : rows;
  const openingBalance = selectedMonth
    ? (rows.filter((r) => r.date.slice(0, 7) < selectedMonth).at(-1)?.balance ?? 0)
    : 0;

  const totals = client ? totalsForViews(scopedViews) : null;
  const closingBalance = visibleRows.at(-1)?.balance ?? openingBalance;
  // Reconciliation check always compares the *account's* true closing
  // balance (all history) to totalsForClient — not the month-scoped one,
  // which will legitimately differ from the account balance whenever a
  // month is selected and isn't a sign of anything being wrong.
  const accountClosingBalance = rows.at(-1)?.balance ?? 0;
  const balanceDiffers =
    totals !== null && Math.abs(accountClosingBalance - totals.outstanding) > 0.004;
  const statementDate = useMemo(() => todayIso(), []);
  const settings = businessProfileFor(data.settings, data.companies, client);

  const exportCsv = () => {
    if (!client) return;
    const openingRow: (string | number)[][] = selectedMonth
      ? [["", "Opening Balance", "", "Balance brought forward", "", "", openingBalance]]
      : [];
    downloadCsv(
      `statement-${fileSlug(client.company)}${effectiveEndClient ? `-${fileSlug(endClientLabel)}` : ""}-${statementDate}${selectedMonth ? `-${selectedMonth}` : ""}.csv`,
      ["Date", "Type", "Reference", "Description", "Debit", "Credit", "Running Balance"],
      [
        ...openingRow,
        ...visibleRows.map((r) => [
          r.date,
          r.type,
          safeCsvText(r.reference),
          safeCsvText(r.description),
          r.debit ? r.debit : "",
          r.credit ? r.credit : "",
          r.balance,
        ]),
      ],
    );
  };

  const exportExcel = () => {
    if (!client || !totals) return;
    const creditNotesNet = round2(accountClosingBalance - totals.outstanding);
    void downloadStatementXlsx({
      filename: `statement-${fileSlug(client.company)}${effectiveEndClient ? `-${fileSlug(endClientLabel)}` : ""}-${statementDate}${selectedMonth ? `-${selectedMonth}` : ""}.xlsx`,
      business: {
        name: settings.businessName,
        address: settings.businessAddress,
        email: settings.businessEmail,
        phone: settings.businessPhone,
        vatNumber: settings.vatNumber,
        companyNumber: settings.companyNumber,
      },
      client: {
        company: client.company,
        name: client.name,
        address: client.address ?? "",
        vatNumber: client.vatNumber ?? "",
        accountReference: client.accountReference ?? "",
      },
      endClientLabel: endClientLabel || undefined,
      periodLabel: selectedMonth ? formatMonth(selectedMonth) : undefined,
      statementDate,
      outstandingTotals,
      outstandingInvoices: filteredOutstandingInvoices.map((r) => ({
        invoiceDate: r.invoiceDate,
        number: r.number,
        outstanding: r.effectiveOutstanding,
        dueDate: r.dueDate,
        status: DUE_STATUS_LABEL[r.dueStatus] as "Due" | "Overdue",
        ageing: r.dueStatus === "overdue" ? r.ageing : null,
        description: r.description || "",
        poReference: r.poReference || "",
        note: [
          r.credited > 0.004 ? `after ${formatMoney(r.credited)} credit note deducted` : "",
          r.creditApplied > 0.004 ? `after ${formatMoney(r.creditApplied)} credit applied` : "",
        ]
          .filter(Boolean)
          .join("; "),
      })),
      openingBalance: selectedMonth ? openingBalance : undefined,
      ledger: visibleRows.map((r) => ({
        date: r.date,
        type: r.type,
        reference: r.reference,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
      })),
      summary: {
        invoiced: totals.invoiced,
        paid: totals.paid,
        creditNotesNet,
        balanceDue: closingBalance,
      },
    });
  };

  if (data.clients.length === 0 || !client || !totals) {
    return (
      <Panel>
        <PanelHeader
          title="Statement of Account"
          description="Running balance per client across invoices, payments and credit notes."
        />
        <EmptyState
          title="No clients yet"
          description="Add a client and record invoices or payments to generate a statement."
        />
      </Panel>
    );
  }

  return (
    <>
      <div className="statement-screen space-y-4">
        <Panel>
          <PanelHeader
            title="Statement of Account"
            description="Running balance per client across invoices, payments and credit notes."
          />
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <CompanyClientPicker
              clients={data.clients}
              companies={data.companies}
              companyKey={companyKey}
              clientId={client.id}
              showNameFilter
              onCompanyChange={setCompanyKey}
              onClientChange={(id) => {
                setSelectedId(id);
                setEndClientFilter("");
              }}
            />
            {hasEndClients ? (
              <Select
                value={effectiveEndClient || "all"}
                onValueChange={(v) => setEndClientFilter(v === "all" ? "" : v)}
              >
                <SelectTrigger className="h-8 w-full text-[13px] sm:w-56" aria-label="End client">
                  <SelectValue placeholder="All end clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All end clients (whole account)</SelectItem>
                  {endClients.names.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                  {endClients.hasUnassigned ? (
                    <SelectItem value={UNASSIGNED_END_CLIENT}>
                      Not assigned to an end client
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            ) : null}
            <Select
              value={selectedMonth || "all"}
              onValueChange={(v) => setSelectedMonth(v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-8 w-full text-[13px] sm:w-44" aria-label="Select month">
                <SelectValue placeholder="All months" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All months</SelectItem>
                {availableMonths.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatMonth(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 sm:ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={exportExcel}
                disabled={visibleRows.length === 0 && outstandingInvoices.length === 0}
              >
                <Download className="size-4" /> Export Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={visibleRows.length === 0}
              >
                <Download className="size-4" /> Export CSV
              </Button>
              <Button size="sm" onClick={() => window.print()}>
                <Printer className="size-4" /> Print / PDF
              </Button>
            </div>
          </div>
          {!settings.businessName.trim() ? (
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              Your business details are not set, so printed statements will not show a letterhead.{" "}
              <Link to="/settings" className="font-medium text-primary hover:underline">
                Add them in Settings
              </Link>
              .
            </p>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader
            title={client.company}
            description={
              endClientLabel ? `${client.name} — End client: ${endClientLabel}` : client.name
            }
            actions={<StatusBadge status={client.status} kind="client" />}
          />
          <dl className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            <Detail label="Client Name" value={client.name} />
            <Detail label="Company" value={client.company} />
            {endClientLabel ? <Detail label="End Client" value={endClientLabel} /> : null}
            <Detail label="VAT Number" value={client.vatNumber || "—"} mono />
            <Detail label="Account Reference" value={client.accountReference || "—"} mono />
            <Detail label="Email" value={client.email || "—"} />
            <Detail label="Address" value={client.address || "—"} />
          </dl>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            label="Total Invoiced"
            value={formatMoney(totals.invoiced)}
            sublabel={`${totals.invoiceCount} invoice${totals.invoiceCount === 1 ? "" : "s"} inc VAT`}
            icon={FileText}
          />
          <SummaryCard
            label="Total Paid"
            value={formatMoney(totals.paid)}
            icon={Wallet}
            tone="success"
          />
          <SummaryCard
            label="Outstanding"
            value={formatMoney(totals.outstanding)}
            tone={totals.outstanding > 0.004 ? "warning" : "success"}
          />
        </div>

        <Panel>
          <PanelHeader
            title="Outstanding Invoices"
            description={
              outstandingInvoices.length === 0
                ? "Nothing outstanding for this client."
                : `Showing ${filteredOutstandingInvoices.length} of ${outstandingInvoices.length} unpaid invoice${outstandingInvoices.length === 1 ? "" : "s"}`
            }
            actions={
              outstandingInvoices.length > 0 ? (
                <Select value={dueFilter} onValueChange={(v) => setDueFilter(v as DueFilter)}>
                  <SelectTrigger className="h-8 w-32 text-[13px]" aria-label="Filter by due status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="due">Due</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              ) : undefined
            }
          />
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
            <SummaryCard label="Total Outstanding" value={formatMoney(outstandingTotals.total)} />
            <SummaryCard
              label="Overdue Amount"
              value={formatMoney(outstandingTotals.overdue)}
              tone="danger"
            />
            <SummaryCard
              label="Due Amount"
              value={formatMoney(outstandingTotals.due)}
              tone="warning"
            />
          </div>
          {creditOnAccount > 0.004 ? (
            <div className="border-b border-border bg-success-soft px-4 py-2.5 text-[13px] text-success">
              <span className="font-semibold">
                Credit on account: {formatMoney(creditOnAccount)}
              </span>{" "}
              — client has paid more than invoiced. It will be netted off their next invoice
              automatically.
            </div>
          ) : null}
          {filteredOutstandingInvoices.length === 0 ? (
            <EmptyState
              title={outstandingInvoices.length === 0 ? "Nothing outstanding" : "No matches"}
              description={
                outstandingInvoices.length === 0
                  ? "Every invoice for this client is fully paid."
                  : "Try switching the filter back to All."
              }
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[920px]">
                <THead>
                  <TR>
                    <TH>Invoice Date</TH>
                    <TH>Invoice No.</TH>
                    <TH align="right">Outstanding</TH>
                    <TH>Due Date</TH>
                    <TH>Status</TH>
                    <TH align="right">Ageing</TH>
                    <TH>Description</TH>
                    <TH>PO No.</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredOutstandingInvoices.map((r) => (
                    <TR key={r.id}>
                      <TD>{formatDate(r.invoiceDate)}</TD>
                      <TD mono className="font-medium">
                        {r.number}
                      </TD>
                      <TD mono align="right">
                        {formatMoney(r.effectiveOutstanding)}
                        {r.creditApplied > 0.004 ? (
                          <div className="text-[11px] font-normal text-muted-foreground">
                            after {formatMoney(r.creditApplied)} credit applied
                          </div>
                        ) : null}
                      </TD>
                      <TD>{formatDate(r.dueDate)}</TD>
                      <TD>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                            DUE_STATUS_STYLES[r.dueStatus],
                          )}
                        >
                          {DUE_STATUS_LABEL[r.dueStatus]}
                        </span>
                      </TD>
                      <TD mono align="right">
                        {r.dueStatus === "overdue" ? r.ageing : "—"}
                      </TD>
                      <TD className="max-w-64 truncate">{r.description || "—"}</TD>
                      <TD mono>{r.poReference || "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Ledger"
            description={
              selectedMonth
                ? `${formatMonth(selectedMonth)} — ${visibleRows.length} ${visibleRows.length === 1 ? "entry" : "entries"}`
                : `${rows.length} ${rows.length === 1 ? "entry" : "entries"}, oldest first`
            }
          />
          {visibleRows.length === 0 ? (
            <EmptyState
              title={
                selectedMonth ? "No activity in this month" : "No ledger activity for this client"
              }
              description={
                selectedMonth
                  ? "Try a different month, or switch back to All months."
                  : "Invoices, payments and credit notes appear here as soon as they are recorded."
              }
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[920px]">
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH>Reference</TH>
                    <TH>Description</TH>
                    <TH align="right">Debit</TH>
                    <TH align="right">Credit</TH>
                    <TH align="right">Running Balance</TH>
                  </TR>
                </THead>
                <TBody>
                  {selectedMonth ? (
                    <TR className="bg-surface-muted/40">
                      <TD colSpan={6} className="text-muted-foreground">
                        Opening balance (brought forward)
                      </TD>
                      <TD mono align="right" className="font-medium">
                        {formatMoney(openingBalance)}
                      </TD>
                    </TR>
                  ) : null}
                  {visibleRows.map((r) => (
                    <TR key={r.key}>
                      <TD>{formatDate(r.date)}</TD>
                      <TD>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                            TYPE_STYLES[r.type],
                          )}
                        >
                          {r.type}
                        </span>
                      </TD>
                      <TD mono className="font-medium">
                        {r.reference}
                      </TD>
                      <TD className="max-w-80 truncate">{r.description}</TD>
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
                  <TR className="bg-surface-muted/55 font-semibold hover:bg-surface-muted/55">
                    <TD colSpan={6} align="right">
                      Closing balance
                    </TD>
                    <TD mono align="right">
                      {formatMoney(closingBalance)}
                    </TD>
                  </TR>
                </TBody>
              </Table>
            </TableWrap>
          )}
          {balanceDiffers || draftCreditNotes > 0 ? (
            <div className="space-y-1 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              {balanceDiffers ? (
                <p>
                  The closing balance includes credit notes. The outstanding figure above is
                  invoices less payments only.
                </p>
              ) : null}
              {draftCreditNotes > 0 ? (
                <p>
                  {draftCreditNotes} draft credit note{draftCreditNotes === 1 ? " is" : "s are"} not
                  included until issued.
                </p>
              ) : null}
            </div>
          ) : null}
        </Panel>
      </div>

      {safariPrint ? (
        <StatementDocumentSafari
          settings={settings}
          client={client}
          endClientLabel={endClientLabel || undefined}
          rows={visibleRows}
          statementDate={statementDate}
          totals={totals}
          closingBalance={closingBalance}
          openingBalance={selectedMonth ? openingBalance : undefined}
          periodLabel={selectedMonth ? formatMonth(selectedMonth) : undefined}
          accountClosingBalance={accountClosingBalance}
          outstandingInvoices={filteredOutstandingInvoices}
          outstandingTotals={outstandingTotals}
        />
      ) : (
        <StatementDocument
          settings={settings}
          client={client}
          endClientLabel={endClientLabel || undefined}
          rows={visibleRows}
          statementDate={statementDate}
          totals={totals}
          closingBalance={closingBalance}
          openingBalance={selectedMonth ? openingBalance : undefined}
          periodLabel={selectedMonth ? formatMonth(selectedMonth) : undefined}
          accountClosingBalance={accountClosingBalance}
          outstandingInvoices={filteredOutstandingInvoices}
          outstandingTotals={outstandingTotals}
        />
      )}
    </>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 whitespace-pre-line break-words text-[13px] text-foreground",
          mono && "num",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Print-only statement. Hidden on screen and shown in place of the app UI under
 * @media print (see the `.statement-doc` rules in styles.css), so it can be sent
 * to a client as a PDF or paper copy.
 */
function StatementDocument({
  settings,
  client,
  rows,
  statementDate,
  totals,
  closingBalance,
  openingBalance,
  periodLabel,
  accountClosingBalance,
  outstandingInvoices,
  outstandingTotals,
  endClientLabel,
}: {
  /** Set when the statement is limited to one End Client. */
  endClientLabel?: string | undefined;
  settings: Settings;
  client: Client;
  rows: StatementRow[];
  statementDate: string;
  totals: { invoiced: number; paid: number; outstanding: number };
  closingBalance: number;
  /** Set only when a single month is selected — printed as a "brought forward" line. */
  openingBalance?: number | undefined;
  /** e.g. "January 2026" — printed in the header when a month is selected. */
  periodLabel?: string | undefined;
  /** Full-account closing balance, used for the credit-note reconciliation
   * line below — always the whole-history figure, even when a month is
   * selected and `closingBalance` above is scoped to it. */
  accountClosingBalance: number;
  /** Unpaid invoices for this client, already narrowed to the on-screen Due/Overdue filter. */
  outstandingInvoices: OutstandingRow[];
  /** Always the full (unfiltered) totals, matching the three summary boxes on screen. */
  outstandingTotals: { total: number; overdue: number; due: number };
}) {
  const contact = [settings.businessEmail, settings.businessPhone].filter((v) => v.trim());
  // Credit notes are what separates "invoiced less paid" from the ledger balance.
  // Showing that as its own line keeps the printed totals reconciling to one balance due.
  // Always computed from the full account balance, not a month-scoped one.
  const creditNoteAdjustment = round2(accountClosingBalance - totals.outstanding);

  // Same "print on the company's pre-printed letterhead" behaviour as
  // InvoiceDocument: when a letterhead image is set, it's laid down as a
  // full-page background and the plain text business header is swapped out
  // so it doesn't collide with the letterhead's own artwork.
  const letterhead = (settings.businessLetterhead ?? "").trim();
  const marginTop = settings.letterheadMarginTop ?? 0;
  const marginBottom = settings.letterheadMarginBottom ?? 0;

  // Safe top/bottom gap to leave clear of the letterhead's own header/footer
  // artwork. Falls back to a plain 14mm when there's no letterhead to
  // protect. This is NOT set via `@page { margin: ... }` — see the print
  // workflow note below for why.
  const pageMarginTop = letterhead ? marginTop : 14;
  const pageMarginBottom = letterhead ? marginBottom : 14;

  // --- Print workflow ---------------------------------------------------
  // `@page` is deliberately always `margin: 0` (see the global rule in
  // styles.css) so the letterhead image — `position: fixed; top:0; left:0`,
  // sized to the full 210mm x 297mm sheet — prints truly edge-to-edge on
  // every page with no inset math. A non-zero `@page` margin used to be
  // used for the content's safe top/bottom gap, but that pushed the
  // *printable area* itself inward, and Chrome clips fixed-position content
  // to that shrunken area — which is exactly why the letterhead's own
  // header/footer bands were getting cut off ("out of the page") even
  // though they were told to print full-bleed.
  //
  // Instead, the safe top/bottom gap comes from a plain HTML/CSS mechanism
  // that repeats on every printed page independent of `@page`: a `<table>`
  // whose `<thead>`/`<tfoot>` are blank spacer rows the height of the
  // letterhead's header/footer artwork. Browsers natively reprint a table's
  // `thead`/`tfoot` at the top/bottom of every page the table spans, so the
  // real content (in a single `<tbody>` cell) is automatically kept clear
  // of the letterhead on page 1, 2, 3 — however many pages this statement
  // runs to — while whatever doesn't fit on one page just flows onto the
  // next, same as normal table pagination.
  const pageSideMarginMm = 12;

  return (
    <div className={letterhead ? "statement-doc has-letterhead" : "statement-doc"}>
      {letterhead ? <img className="sd-letterhead-bg" src={letterhead} alt="" /> : null}
      <table className="sd-page">
        <thead>
          <tr>
            <td style={{ height: `${pageMarginTop}mm` }} />
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td style={{ height: `${pageMarginBottom}mm` }} />
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="sd-page-body" style={{ padding: `0 ${pageSideMarginMm}mm` }}>
              <header className="sd-head">
                {letterhead ? (
                  <div />
                ) : (
                  <div>
                    {settings.businessName.trim() ? (
                      <h1 className="sd-business">{settings.businessName}</h1>
                    ) : null}
                    {settings.businessAddress.trim() ? (
                      <p className="sd-lines">{settings.businessAddress}</p>
                    ) : null}
                    {contact.length > 0 ? <p className="sd-lines">{contact.join("\n")}</p> : null}
                    {settings.vatNumber.trim() ? (
                      <p className="sd-lines">VAT No. {settings.vatNumber}</p>
                    ) : null}
                    {settings.companyNumber.trim() ? (
                      <p className="sd-lines">Company No. {settings.companyNumber}</p>
                    ) : null}
                  </div>
                )}
                <div className="sd-title-block">
                  <h2 className="sd-title">Statement of Account</h2>
                  {periodLabel ? <p className="sd-lines">Period: {periodLabel}</p> : null}
                  <p className="sd-lines">Statement date: {formatDate(statementDate)}</p>
                  {client.accountReference ? (
                    <p className="sd-lines">Account ref: {client.accountReference}</p>
                  ) : null}
                </div>
              </header>

              <section className="sd-client">
                <p className="sd-label">Statement for</p>
                <p className="sd-client-name">{client.company}</p>
                <p className="sd-lines">{client.name}</p>
                {endClientLabel ? <p className="sd-lines">Client: {endClientLabel}</p> : null}
                {client.address ? <p className="sd-lines">{client.address}</p> : null}
                {client.vatNumber ? <p className="sd-lines">VAT No. {client.vatNumber}</p> : null}
              </section>

              {outstandingTotals.total > 0.004 ? (
                <section className="sd-outstanding">
                  <div className="sd-ob-grid">
                    <div className="sd-ob-box sd-ob-total">
                      <p className="sd-ob-label">Total Outstanding</p>
                      <p className="sd-ob-value">{formatMoney(outstandingTotals.total)}</p>
                    </div>
                    <div className="sd-ob-box sd-ob-overdue">
                      <p className="sd-ob-label">Overdue Amount</p>
                      <p className="sd-ob-value">{formatMoney(outstandingTotals.overdue)}</p>
                    </div>
                    <div className="sd-ob-box sd-ob-due">
                      <p className="sd-ob-label">Due Amount</p>
                      <p className="sd-ob-value">{formatMoney(outstandingTotals.due)}</p>
                    </div>
                  </div>
                  {outstandingInvoices.length > 0 ? (
                    <table className="sd-ob-table">
                      <thead>
                        <tr>
                          <th>Invoice Date</th>
                          <th>Invoice No.</th>
                          <th className="sd-num">Outstanding</th>
                          <th>Due Date</th>
                          <th>Status</th>
                          <th className="sd-num">Ageing</th>
                          <th>Description</th>
                          <th>PO No.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outstandingInvoices.map((r) => (
                          <tr key={r.id}>
                            <td className="sd-nowrap">{formatDate(r.invoiceDate)}</td>
                            <td className="sd-nowrap">{r.number}</td>
                            <td className="sd-num">
                              {formatMoney(r.effectiveOutstanding)}
                              {r.credited > 0.004 ? (
                                <div style={{ fontSize: "0.85em", opacity: 0.7 }}>
                                  after {formatMoney(r.credited)} credit note deducted
                                </div>
                              ) : null}
                              {r.creditApplied > 0.004 ? (
                                <div style={{ fontSize: "0.85em", opacity: 0.7 }}>
                                  after {formatMoney(r.creditApplied)} credit applied
                                </div>
                              ) : null}
                            </td>
                            <td className="sd-nowrap">{formatDate(r.dueDate)}</td>
                            <td
                              className={
                                r.dueStatus === "overdue" ? "sd-status-overdue" : "sd-status-due"
                              }
                            >
                              {DUE_STATUS_LABEL[r.dueStatus]}
                            </td>
                            <td className="sd-num">{r.dueStatus === "overdue" ? r.ageing : "—"}</td>
                            <td>{r.description || "—"}</td>
                            <td className="sd-nowrap">{r.poReference || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </section>
              ) : null}

              {rows.length === 0 ? (
                <p className="sd-empty">
                  {periodLabel
                    ? `There is no account activity in ${periodLabel} for this client.`
                    : "There is no account activity to show for this client."}
                </p>
              ) : (
                <>
                  {outstandingTotals.total > 0.004 ? (
                    <h3 className="sd-section-title">Account Ledger</h3>
                  ) : null}
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Reference</th>
                        <th>Description</th>
                        <th className="sd-num">Debit</th>
                        <th className="sd-num">Credit</th>
                        <th className="sd-num">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openingBalance !== undefined ? (
                        <tr>
                          <td className="sd-nowrap"></td>
                          <td className="sd-nowrap">—</td>
                          <td className="sd-nowrap"></td>
                          <td>Opening balance (brought forward)</td>
                          <td className="sd-num"></td>
                          <td className="sd-num"></td>
                          <td className="sd-num">{formatMoney(openingBalance)}</td>
                        </tr>
                      ) : null}
                      {rows.map((r) => (
                        <tr key={r.key}>
                          <td className="sd-nowrap">{formatDate(r.date)}</td>
                          <td className="sd-nowrap">{r.type}</td>
                          <td className="sd-nowrap">{r.reference}</td>
                          <td>{r.description}</td>
                          <td className="sd-num">{r.debit ? formatMoney(r.debit) : ""}</td>
                          <td className="sd-num">{r.credit ? formatMoney(r.credit) : ""}</td>
                          <td className="sd-num">{formatMoney(r.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <section className="sd-summary">
                <dl>
                  <div>
                    <dt>Total invoiced</dt>
                    <dd>{formatMoney(totals.invoiced)}</dd>
                  </div>
                  <div>
                    <dt>Total paid</dt>
                    <dd>{formatMoney(totals.paid)}</dd>
                  </div>
                  {Math.abs(creditNoteAdjustment) > 0.004 ? (
                    <div>
                      <dt>Credit notes (net)</dt>
                      <dd>{formatMoney(creditNoteAdjustment)}</dd>
                    </div>
                  ) : null}
                  <div className="sd-total">
                    <dt>Balance due</dt>
                    <dd>{formatMoney(closingBalance)}</dd>
                  </div>
                </dl>
              </section>

              {!letterhead && contact.length > 0 ? (
                <p className="sd-footer">
                  If anything on this statement looks wrong, please contact {contact.join(" or ")}.
                </p>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Safari/iOS-safe variant of StatementDocument — same content, same props.
 * Kept in this file (not its own) because StatementRow/OutstandingRow are
 * local types here; splitting it out would mean exporting them just for
 * this. See InvoiceDocument.safari.tsx for the full explanation of why the
 * letterhead is handled differently here — short version: WebKit's print
 * engine doesn't repaint `position: fixed` past the first printed page, so
 * the letterhead is instead painted as a background on the thead/tfoot
 * spacer cells, which repeat on every page in every engine including
 * Safari. Do NOT change StatementDocument above to match this — that one is
 * the working Chrome/Edge/Firefox path.
 */
function StatementDocumentSafari({
  settings,
  client,
  rows,
  statementDate,
  totals,
  closingBalance,
  openingBalance,
  periodLabel,
  accountClosingBalance,
  outstandingInvoices,
  outstandingTotals,
  endClientLabel,
}: {
  /** Set when the statement is limited to one End Client. */
  endClientLabel?: string | undefined;
  settings: Settings;
  client: Client;
  rows: StatementRow[];
  statementDate: string;
  totals: { invoiced: number; paid: number; outstanding: number };
  openingBalance?: number | undefined;
  periodLabel?: string | undefined;
  closingBalance: number;
  accountClosingBalance: number;
  outstandingInvoices: OutstandingRow[];
  outstandingTotals: { total: number; overdue: number; due: number };
}) {
  const contact = [settings.businessEmail, settings.businessPhone].filter((v) => v.trim());
  const creditNoteAdjustment = round2(accountClosingBalance - totals.outstanding);

  const letterhead = (settings.businessLetterhead ?? "").trim();
  const marginTop = settings.letterheadMarginTop ?? 0;
  const marginBottom = settings.letterheadMarginBottom ?? 0;
  const pageMarginTop = letterhead ? marginTop : 14;
  const pageMarginBottom = letterhead ? marginBottom : 14;
  const pageSideMarginMm = 12;

  const letterheadStyle = letterhead
    ? ({ "--sd-letterhead-image": `url(${letterhead})` } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={letterhead ? "statement-doc-safari has-letterhead" : "statement-doc-safari"}
      style={letterheadStyle}
    >
      <table className="sd-page">
        <thead>
          <tr>
            <td style={{ height: `${pageMarginTop}mm` }} />
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td style={{ height: `${pageMarginBottom}mm` }} />
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="sd-page-body" style={{ padding: `0 ${pageSideMarginMm}mm` }}>
              <header className="sd-head">
                {letterhead ? (
                  <div />
                ) : (
                  <div>
                    {settings.businessName.trim() ? (
                      <h1 className="sd-business">{settings.businessName}</h1>
                    ) : null}
                    {settings.businessAddress.trim() ? (
                      <p className="sd-lines">{settings.businessAddress}</p>
                    ) : null}
                    {contact.length > 0 ? <p className="sd-lines">{contact.join("\n")}</p> : null}
                    {settings.vatNumber.trim() ? (
                      <p className="sd-lines">VAT No. {settings.vatNumber}</p>
                    ) : null}
                    {settings.companyNumber.trim() ? (
                      <p className="sd-lines">Company No. {settings.companyNumber}</p>
                    ) : null}
                  </div>
                )}
                <div className="sd-title-block">
                  <h2 className="sd-title">Statement of Account</h2>
                  {periodLabel ? <p className="sd-lines">Period: {periodLabel}</p> : null}
                  <p className="sd-lines">Statement date: {formatDate(statementDate)}</p>
                  {client.accountReference ? (
                    <p className="sd-lines">Account ref: {client.accountReference}</p>
                  ) : null}
                </div>
              </header>

              <section className="sd-client">
                <p className="sd-label">Statement for</p>
                <p className="sd-client-name">{client.company}</p>
                <p className="sd-lines">{client.name}</p>
                {endClientLabel ? <p className="sd-lines">Client: {endClientLabel}</p> : null}
                {client.address ? <p className="sd-lines">{client.address}</p> : null}
                {client.vatNumber ? <p className="sd-lines">VAT No. {client.vatNumber}</p> : null}
              </section>

              {outstandingTotals.total > 0.004 ? (
                <section className="sd-outstanding">
                  <div className="sd-ob-grid">
                    <div className="sd-ob-box sd-ob-total">
                      <p className="sd-ob-label">Total Outstanding</p>
                      <p className="sd-ob-value">{formatMoney(outstandingTotals.total)}</p>
                    </div>
                    <div className="sd-ob-box sd-ob-overdue">
                      <p className="sd-ob-label">Overdue Amount</p>
                      <p className="sd-ob-value">{formatMoney(outstandingTotals.overdue)}</p>
                    </div>
                    <div className="sd-ob-box sd-ob-due">
                      <p className="sd-ob-label">Due Amount</p>
                      <p className="sd-ob-value">{formatMoney(outstandingTotals.due)}</p>
                    </div>
                  </div>
                  {outstandingInvoices.length > 0 ? (
                    <table className="sd-ob-table">
                      <thead>
                        <tr>
                          <th>Invoice Date</th>
                          <th>Invoice No.</th>
                          <th className="sd-num">Outstanding</th>
                          <th>Due Date</th>
                          <th>Status</th>
                          <th className="sd-num">Ageing</th>
                          <th>Description</th>
                          <th>PO No.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outstandingInvoices.map((r) => (
                          <tr key={r.id}>
                            <td className="sd-nowrap">{formatDate(r.invoiceDate)}</td>
                            <td className="sd-nowrap">{r.number}</td>
                            <td className="sd-num">
                              {formatMoney(r.effectiveOutstanding)}
                              {r.credited > 0.004 ? (
                                <div style={{ fontSize: "0.85em", opacity: 0.7 }}>
                                  after {formatMoney(r.credited)} credit note deducted
                                </div>
                              ) : null}
                              {r.creditApplied > 0.004 ? (
                                <div style={{ fontSize: "0.85em", opacity: 0.7 }}>
                                  after {formatMoney(r.creditApplied)} credit applied
                                </div>
                              ) : null}
                            </td>
                            <td className="sd-nowrap">{formatDate(r.dueDate)}</td>
                            <td
                              className={
                                r.dueStatus === "overdue" ? "sd-status-overdue" : "sd-status-due"
                              }
                            >
                              {DUE_STATUS_LABEL[r.dueStatus]}
                            </td>
                            <td className="sd-num">{r.dueStatus === "overdue" ? r.ageing : "—"}</td>
                            <td>{r.description || "—"}</td>
                            <td className="sd-nowrap">{r.poReference || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </section>
              ) : null}

              {rows.length === 0 ? (
                <p className="sd-empty">
                  {periodLabel
                    ? `There is no account activity in ${periodLabel} for this client.`
                    : "There is no account activity to show for this client."}
                </p>
              ) : (
                <>
                  {outstandingTotals.total > 0.004 ? (
                    <h3 className="sd-section-title">Account Ledger</h3>
                  ) : null}
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Reference</th>
                        <th>Description</th>
                        <th className="sd-num">Debit</th>
                        <th className="sd-num">Credit</th>
                        <th className="sd-num">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openingBalance !== undefined ? (
                        <tr>
                          <td className="sd-nowrap"></td>
                          <td className="sd-nowrap">—</td>
                          <td className="sd-nowrap"></td>
                          <td>Opening balance (brought forward)</td>
                          <td className="sd-num"></td>
                          <td className="sd-num"></td>
                          <td className="sd-num">{formatMoney(openingBalance)}</td>
                        </tr>
                      ) : null}
                      {rows.map((r) => (
                        <tr key={r.key}>
                          <td className="sd-nowrap">{formatDate(r.date)}</td>
                          <td className="sd-nowrap">{r.type}</td>
                          <td className="sd-nowrap">{r.reference}</td>
                          <td>{r.description}</td>
                          <td className="sd-num">{r.debit ? formatMoney(r.debit) : ""}</td>
                          <td className="sd-num">{r.credit ? formatMoney(r.credit) : ""}</td>
                          <td className="sd-num">{formatMoney(r.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <section className="sd-summary">
                <dl>
                  <div>
                    <dt>Total invoiced</dt>
                    <dd>{formatMoney(totals.invoiced)}</dd>
                  </div>
                  <div>
                    <dt>Total paid</dt>
                    <dd>{formatMoney(totals.paid)}</dd>
                  </div>
                  {Math.abs(creditNoteAdjustment) > 0.004 ? (
                    <div>
                      <dt>Credit notes (net)</dt>
                      <dd>{formatMoney(creditNoteAdjustment)}</dd>
                    </div>
                  ) : null}
                  <div className="sd-total">
                    <dt>Balance due</dt>
                    <dd>{formatMoney(closingBalance)}</dd>
                  </div>
                </dl>
              </section>

              {!letterhead && contact.length > 0 ? (
                <p className="sd-footer">
                  If anything on this statement looks wrong, please contact {contact.join(" or ")}.
                </p>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}