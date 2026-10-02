import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Download,
  FilePlus,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Wallet,
} from "@/lib/icons";
import { toast } from "sonner";
import { useLedger } from "@/lib/ledger/store";
import {
  businessProfileFor,
  creditNoteTotal,
  endClientOptions,
  formatDate,
  formatHours,
  formatMoney,
  invoiceTracksHours,
  matchesEndClient,
  processedHoursForInvoice,
  remainingInvoiceHours,
  round2,
  UNASSIGNED_END_CLIENT,
} from "@/lib/ledger/calc";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { InvoiceDialog } from "@/components/app/InvoiceDialog";
import { InvoiceDocument } from "@/components/app/InvoiceDocument";
import { InvoiceDocumentSafari } from "@/components/app/InvoiceDocument.safari";
import { shouldUseSafariPrintLayout } from "@/lib/print-browser";
import { PaymentDialog } from "@/components/app/PaymentDialog";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { SummaryCard } from "@/components/app/SummaryCard";
import { downloadXlsx } from "@/lib/ledger/excel";
import { RequireView } from "@/components/app/RequireView";
import { usePermissions } from "@/lib/ledger/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Invoice, InvoiceStatus } from "@/lib/ledger/types";
import type { InvoiceView } from "@/lib/ledger/calc";

export const Route = createFileRoute("/invoices/")({
  validateSearch: (search: Record<string, unknown>): { q?: string; client?: string } => {
    const out: { q?: string; client?: string } = {};
    const q = search["q"];
    const client = search["client"];
    if (typeof q === "string") out.q = q;
    if (typeof client === "string") out.client = client;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Invoices — LedgerFlow" },
      {
        name: "description",
        content: "Search, filter and manage GBP invoices with VAT, paid and outstanding amounts.",
      },
      { property: "og:title", content: "Invoices — LedgerFlow" },
      {
        property: "og:description",
        content: "Invoice register with VAT at 20% and outstanding balances in GBP.",
      },
    ],
  }),
  component: InvoicesPage,
});

function InvoicesPage() {
  return (
    <RequireView module="invoices">
      <InvoicesPageContent />
    </RequireView>
  );
}

function InvoicesPageContent() {
  const search = Route.useSearch();
  const {
    data,
    invoiceViewsWithCredit,
    creditBalanceByClient,
    deleteInvoice,
    clearInvoicePayments,
  } = useLedger();
  const { can } = usePermissions();
  const [query, setQuery] = useState(search.q ?? "");
  const [status, setStatus] = useState("all");
  const [approval, setApproval] = useState("all");
  const [clientId, setClientId] = useState(search.client ?? "all");
  const [companyId, setCompanyId] = useState("all");
  // "all" = every invoice; UNASSIGNED_END_CLIENT = invoices with no End Client.
  const [endClient, setEndClient] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [duplicating, setDuplicating] = useState<Invoice | null>(null);
  const [additionalFor, setAdditionalFor] = useState<Invoice | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payForBlank, setPayForBlank] = useState(false);
  const [toDelete, setToDelete] = useState<Invoice | null>(null);
  const [printInvoice, setPrintInvoice] = useState<InvoiceView | null>(null);
  const [toMarkUnpaid, setToMarkUnpaid] = useState<InvoiceView | null>(null);
  const [clearingPayments, setClearingPayments] = useState(false);
  // Chrome's print workflow (InvoiceDocument) stays the default; only flips
  // to the Safari-safe variant after mount, once we can check the browser.
  // See src/lib/print-browser.ts.
  const [safariPrint, setSafariPrint] = useState(false);
  useEffect(() => {
    setSafariPrint(shouldUseSafariPrintLayout());
  }, []);

  // Controlled status change: status is never stored directly (it's always
  // computed from payments — see calc.ts:statusFor), so every option here
  // routes through the real payment actions instead of writing a status
  // field. "Paid"/"Partial" open the same Record Payment flow used
  // elsewhere; "Unpaid" clears the invoice's existing payments after a
  // confirm, since that's the only way its computed status can go back down.
  const handleStatusChange = (inv: InvoiceView, target: InvoiceStatus) => {
    if (target === inv.status) return;
    if (target === "unpaid") {
      setToMarkUnpaid(inv);
      return;
    }
    setPayForBlank(target === "partial");
    setPayFor(inv.id);
  };

  // Trigger the browser print dialog once the selected invoice has rendered
  // into the print-only .invoice-doc (see styles.css), then clear the
  // selection once printing is dismissed so it doesn't linger in the DOM.
  useEffect(() => {
    if (!printInvoice) return;
    const frame = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(frame);
  }, [printInvoice]);

  useEffect(() => {
    const handler = () => setPrintInvoice(null);
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, []);

  // Keep filters in sync when navigating here via header search or ?client= links.
  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);
  useEffect(() => {
    setClientId(search.client ?? "all");
  }, [search.client]);

  const clientCompanyId = useMemo(
    () => new Map(data.clients.map((c) => [c.id, c.companyId ?? null])),
    [data.clients],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoiceViewsWithCredit
      .filter((i) => (status === "all" ? true : i.effectiveStatus === status))
      .filter((i) =>
        approval === "all" ? true : (i.approved ? "approved" : "unapproved") === approval,
      )
      .filter((i) => (clientId === "all" ? true : i.clientId === clientId))
      .filter((i) => (companyId === "all" ? true : clientCompanyId.get(i.clientId) === companyId))
      .filter((i) => matchesEndClient(i, endClient === "all" ? "" : endClient))
      .filter((i) => (from ? i.invoiceDate >= from : true))
      .filter((i) => (to ? i.invoiceDate <= to : true))
      .filter((i) =>
        q
          ? `${i.number} ${i.clientName} ${i.clientCompany} ${i.endClient ?? ""} ${i.description}`
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  }, [
    invoiceViewsWithCredit,
    query,
    status,
    approval,
    clientId,
    companyId,
    endClient,
    from,
    to,
    clientCompanyId,
  ]);

  // Clients offered in the Client dropdown: only those under the chosen billing company.
  const clientChoices = useMemo(
    () => data.clients.filter((c) => companyId === "all" || (c.companyId ?? null) === companyId),
    [data.clients, companyId],
  );

  // End Clients that exist for the current Company/Client selection. The
  // dropdown is hidden until at least one invoice has an End Client.
  const endClientChoices = useMemo(
    () =>
      endClientOptions(
        data.invoices.filter(
          (i) =>
            (clientId === "all" || i.clientId === clientId) &&
            (companyId === "all" || clientCompanyId.get(i.clientId) === companyId),
        ),
      ),
    [data.invoices, clientId, companyId, clientCompanyId],
  );

  const exportExcel = () => {
    const companyName = (clientId: string) => {
      const co = data.clients.find((x) => x.id === clientId)?.companyId;
      return co ? (data.companies.find((x) => x.id === co)?.name ?? "") : "";
    };
    downloadXlsx(
      `invoices-${new Date().toISOString().slice(0, 10)}`,
      "Invoices",
      [
        { header: "Invoice No.", width: 16 },
        { header: "Client", width: 28 },
        { header: "Company", width: 24 },
        { header: "End Client", width: 22 },
        { header: "PO No.", width: 16 },
        { header: "Invoice Date", width: 13 },
        { header: "Due Date", width: 13 },
        { header: "Description", width: 36 },
        { header: "Second Description", width: 36 },
        { header: "Ex VAT", width: 14, money: true },
        { header: "VAT", width: 12, money: true },
        { header: "Inc VAT", width: 14, money: true },
        { header: "Paid", width: 14, money: true },
        { header: "Outstanding", width: 14, money: true },
        { header: "Status", width: 10 },
        { header: "Approval", width: 12 },
      ],
      rows.map((inv) => [
        inv.number,
        inv.clientCompany,
        companyName(inv.clientId),
        inv.endClient?.trim() ?? "",
        inv.poReference?.trim() ?? "",
        inv.invoiceDate,
        inv.dueDate,
        inv.description,
        inv.description2 ?? "",
        inv.amountExVat,
        inv.vat,
        inv.total,
        inv.paid,
        inv.effectiveOutstanding,
        inv.effectiveStatus,
        inv.approved ? "Approved" : "Unapproved",
      ]),
    ).catch(() => toast.error("Export failed."));
  };

  const changeCompany = (value: string) => {
    setCompanyId(value);
    setEndClient("all");
    // Keep the chosen client only if it belongs to the new company.
    if (value !== "all" && clientId !== "all") {
      const stillThere = data.clients.some(
        (c) => c.id === clientId && (c.companyId ?? null) === value,
      );
      if (!stillThere) setClientId("all");
    }
  };

  const totals = useMemo(
    () => ({
      total: round2(rows.reduce((s, r) => s + r.total, 0)),
      paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
      outstanding: round2(rows.reduce((s, r) => s + r.effectiveOutstanding, 0)),
    }),
    [rows],
  );

  // Only meaningful once the list is narrowed to one client — credit is
  // per-client, so a mixed "all clients" total wouldn't mean anything.
  const selectedClientCredit = clientId !== "all" ? (creditBalanceByClient.get(clientId) ?? 0) : 0;

  return (
    <>
      <div className="invoices-screen space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Invoiced (filtered)" value={formatMoney(totals.total)} />
          <SummaryCard label="Received" value={formatMoney(totals.paid)} tone="success" />
          <SummaryCard label="Outstanding" value={formatMoney(totals.outstanding)} tone="warning" />
        </div>

        {selectedClientCredit > 0.004 ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-success/25 bg-success-soft px-4 py-2.5 text-[13px] text-success">
            <Wallet className="size-4 shrink-0" />
            <span>
              <strong className="font-semibold">{formatMoney(selectedClientCredit)}</strong> credit
              balance on this client — it's applied automatically to cover their next invoice(s)
              before anything is shown as outstanding.
            </span>
          </div>
        ) : null}

        <Panel>
          <PanelHeader
            title="Invoices"
            description={`${rows.length} of ${invoiceViewsWithCredit.length} invoices`}
            actions={
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={exportExcel} disabled={rows.length === 0}>
                  <Download className="size-4" /> Export to Excel
                </Button>
                {can("invoices", "create") ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                      setDuplicating(null);
                      setAdditionalFor(null);
                      setFormOpen(true);
                    }}
                  >
                    <Plus className="size-4" /> Add Invoice
                  </Button>
                ) : null}
              </div>
            }
          />

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search invoice or client…"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-36 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={approval} onValueChange={setApproval}>
              <SelectTrigger className="h-8 w-40 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="unapproved">Unapproved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={companyId} onValueChange={changeCompany}>
              <SelectTrigger className="h-8 w-48 text-[13px]" aria-label="Billing company">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All billing companies</SelectItem>
                {data.companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={clientId}
              onValueChange={(v) => {
                setClientId(v);
                setEndClient("all");
              }}
            >
              <SelectTrigger className="h-8 w-48 text-[13px]" aria-label="Client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {clientChoices.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {endClientChoices.names.length > 0 ? (
              <Select value={endClient} onValueChange={setEndClient}>
                <SelectTrigger className="h-8 w-48 text-[13px]" aria-label="End client">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All end clients</SelectItem>
                  {endClientChoices.names.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                  {endClientChoices.hasUnassigned ? (
                    <SelectItem value={UNASSIGNED_END_CLIENT}>Not assigned</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            ) : null}
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-40 text-[13px]"
              aria-label="Invoice date from"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-40 text-[13px]"
              aria-label="Invoice date to"
            />
            {query ||
            status !== "all" ||
            approval !== "all" ||
            clientId !== "all" ||
            companyId !== "all" ||
            endClient !== "all" ||
            from ||
            to ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  setApproval("all");
                  setClientId("all");
                  setCompanyId("all");
                  setEndClient("all");
                  setFrom("");
                  setTo("");
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No invoices match this view"
              description="Adjust the filters, or create a new invoice."
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[1440px]">
                <THead>
                  <TR>
                    <TH>Invoice No.</TH>
                    <TH>Client</TH>
                    <TH>Invoice Date</TH>
                    <TH>Due Date</TH>
                    <TH align="right">Ex VAT</TH>
                    <TH align="right">VAT</TH>
                    <TH align="right">Inc VAT</TH>
                    <TH align="right">Paid</TH>
                    <TH align="right">Outstanding</TH>
                    <TH align="right">Total Hrs</TH>
                    <TH align="right">Processed Hrs</TH>
                    <TH align="right">Remaining Hrs</TH>
                    <TH>Status</TH>
                    <TH>Approval</TH>
                    <TH align="right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((inv) => (
                    <TR key={inv.id}>
                      <TD mono className="font-medium">
                        {inv.number}
                      </TD>
                      <TD>
                        <Link
                          to="/clients/$clientId"
                          params={{ clientId: inv.clientId }}
                          className="hover:underline"
                        >
                          {inv.clientCompany}
                        </Link>
                        {inv.endClient?.trim() ? (
                          <div className="text-[11px] font-normal text-muted-foreground">
                            End client: {inv.endClient.trim()}
                          </div>
                        ) : null}
                      </TD>
                      <TD>{formatDate(inv.invoiceDate)}</TD>
                      <TD>{formatDate(inv.dueDate)}</TD>
                      <TD mono align="right">
                        {formatMoney(inv.amountExVat)}
                      </TD>
                      <TD mono align="right">
                        {formatMoney(inv.vat)}
                      </TD>
                      <TD mono align="right" className="font-medium">
                        {formatMoney(inv.total)}
                      </TD>
                      <TD mono align="right">
                        {formatMoney(inv.paid)}
                      </TD>
                      <TD mono align="right">
                        <div>{formatMoney(inv.effectiveOutstanding)}</div>
                        {inv.creditApplied > 0.004 ? (
                          <div className="text-[10px] font-normal text-success">
                            −{formatMoney(inv.creditApplied)} from credit
                          </div>
                        ) : null}
                        {inv.linkedCreditNotes.length > 0 ? (
                          <div className="mt-0.5 space-y-0.5 text-[10px] font-normal">
                            {inv.linkedCreditNotes.map((n) => {
                              const deducts = n.status !== "draft";
                              return (
                                <div
                                  key={n.id}
                                  className={deducts ? "text-success" : "text-muted-foreground"}
                                  title={
                                    deducts
                                      ? `Credit note ${n.number} (${n.status}) is deducted from this invoice.`
                                      : `Credit note ${n.number} is still a draft, so it is not deducted yet.`
                                  }
                                >
                                  <Link to="/credit-notes" className="hover:underline">
                                    {deducts ? "−" : ""}
                                    {formatMoney(creditNoteTotal(n))} {n.number}
                                    {deducts ? "" : " (draft)"}
                                  </Link>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </TD>
                      <TD mono align="right" className="text-muted-foreground">
                        {invoiceTracksHours(inv) ? formatHours(inv.hours ?? 0) : "—"}
                      </TD>
                      <TD mono align="right" className="text-muted-foreground">
                        {invoiceTracksHours(inv)
                          ? formatHours(processedHoursForInvoice(inv.id, data.subcontracts))
                          : "—"}
                      </TD>
                      <TD
                        mono
                        align="right"
                        className={
                          invoiceTracksHours(inv) &&
                          (remainingInvoiceHours(inv, data.subcontracts) ?? 0) <= 0.004
                            ? "font-medium text-destructive"
                            : "font-medium"
                        }
                      >
                        {invoiceTracksHours(inv)
                          ? formatHours(remainingInvoiceHours(inv, data.subcontracts) ?? 0)
                          : "—"}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-1.5">
                          <Select
                            value={inv.status}
                            onValueChange={(v) => handleStatusChange(inv, v as InvoiceStatus)}
                            disabled={!can("payments", "create") && !can("payments", "delete")}
                          >
                            <SelectTrigger
                              className="h-6 w-auto gap-1 border-none bg-transparent p-0 shadow-none focus-visible:ring-1 [&_svg]:opacity-60 [&>span]:inline-flex"
                              aria-label={`Change status for ${inv.number}`}
                            >
                              <StatusBadge status={inv.effectiveStatus} />
                            </SelectTrigger>
                            <SelectContent align="start">
                              <SelectItem value="unpaid" disabled={!can("payments", "delete")}>
                                Unpaid
                              </SelectItem>
                              <SelectItem value="partial" disabled={!can("payments", "create")}>
                                Partially Paid
                              </SelectItem>
                              <SelectItem value="paid" disabled={!can("payments", "create")}>
                                Paid
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          {inv.creditApplied > 0.004 && inv.effectiveStatus !== inv.status ? (
                            <span
                              className="text-[10px] font-medium text-success"
                              title="Cleared using a prior overpayment on another invoice, not a payment recorded directly against this one."
                            >
                              via credit
                            </span>
                          ) : null}
                        </div>
                      </TD>
                      <TD>
                        <StatusBadge
                          kind="approval"
                          status={inv.approved ? "approved" : "unapproved"}
                        />
                      </TD>
                      <TD align="right">
                        <div className="flex items-center justify-end gap-1">
                          {can("payments", "create") ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Record payment"
                              disabled={inv.effectiveOutstanding <= 0.004}
                              onClick={() => setPayFor(inv.id)}
                            >
                              <Wallet className="size-4" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Print / PDF"
                            onClick={() => setPrintInvoice(inv)}
                          >
                            <Printer className="size-4" />
                          </Button>
                          {can("invoices", "edit") ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Edit invoice"
                              onClick={() => {
                                setEditing(inv);
                                setDuplicating(null);
                                setAdditionalFor(null);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          ) : null}
                          {can("invoices", "create") ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Copy invoice"
                              onClick={() => {
                                setEditing(null);
                                setDuplicating(inv);
                                setAdditionalFor(null);
                                setFormOpen(true);
                              }}
                            >
                              <Copy className="size-4" />
                            </Button>
                          ) : null}
                          {can("invoices", "create") ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Create additional invoice"
                              title="Additional Invoice"
                              onClick={() => {
                                setEditing(null);
                                setDuplicating(null);
                                setAdditionalFor(inv);
                                setFormOpen(true);
                              }}
                            >
                              <FilePlus className="size-4" />
                            </Button>
                          ) : null}
                          {can("invoices", "delete") ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete invoice"
                              onClick={() => setToDelete(inv)}
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Panel>

        <InvoiceDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          invoice={editing}
          duplicateFrom={duplicating}
          additionalFor={additionalFor}
        />
        <PaymentDialog
          open={payFor !== null}
          onOpenChange={(v) => {
            if (!v) {
              setPayFor(null);
              setPayForBlank(false);
            }
          }}
          defaultInvoiceId={payFor ?? undefined}
          blankAmount={payForBlank}
        />
        <ConfirmDialog
          open={toDelete !== null}
          onOpenChange={(v) => !v && setToDelete(null)}
          title="Delete invoice?"
          description={`${toDelete?.number ?? ""} and its recorded payments will be removed from the ledger.`}
          confirmLabel="Delete"
          onConfirm={() => {
            if (toDelete) {
              deleteInvoice(toDelete.id);
              toast.success("Invoice deleted.");
            }
            setToDelete(null);
          }}
        />
        <ConfirmDialog
          open={toMarkUnpaid !== null}
          onOpenChange={(v) => !v && setToMarkUnpaid(null)}
          title="Mark as Unpaid?"
          description={
            toMarkUnpaid
              ? `This deletes ${formatMoney(toMarkUnpaid.paid)} of payment(s) recorded against ${toMarkUnpaid.number} — the only way to move it back to Unpaid, since status is always calculated from actual payments, never set directly. This cannot be undone.`
              : ""
          }
          confirmLabel={clearingPayments ? "Clearing…" : "Clear payments"}
          onConfirm={() => {
            if (!toMarkUnpaid) return;
            setClearingPayments(true);
            clearInvoicePayments(toMarkUnpaid.id)
              .then(() => toast.success(`${toMarkUnpaid.number} marked as Unpaid.`))
              .catch(() => toast.error("Could not clear payments. Try again."))
              .finally(() => {
                setClearingPayments(false);
                setToMarkUnpaid(null);
              });
          }}
        />
      </div>

      {printInvoice ? (
        safariPrint ? (
          <InvoiceDocumentSafari
            settings={businessProfileFor(
              data.settings,
              data.companies,
              data.clients.find((c) => c.id === printInvoice.clientId),
            )}
            client={data.clients.find((c) => c.id === printInvoice.clientId)}
            invoice={printInvoice}
          />
        ) : (
          <InvoiceDocument
            settings={businessProfileFor(
              data.settings,
              data.companies,
              data.clients.find((c) => c.id === printInvoice.clientId),
            )}
            client={data.clients.find((c) => c.id === printInvoice.clientId)}
            invoice={printInvoice}
          />
        )
      ) : null}
    </>
  );
}
