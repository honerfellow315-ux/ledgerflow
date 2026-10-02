import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Pencil, Plus, Search, Trash2 } from "@/lib/icons";
import { toast } from "sonner";
import { useLedger } from "@/lib/ledger/store";
import {
  endClientOptions,
  formatDate,
  formatMoney,
  matchesEndClient,
  paymentOwnerClientId,
  round2,
  UNASSIGNED_END_CLIENT,
} from "@/lib/ledger/calc";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { PaymentDialog } from "@/components/app/PaymentDialog";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { RequireView } from "@/components/app/RequireView";
import { usePermissions } from "@/lib/ledger/permissions";
import { SummaryCard } from "@/components/app/SummaryCard";
import { downloadXlsx } from "@/lib/ledger/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Payment } from "@/lib/ledger/types";

export const Route = createFileRoute("/payments/")({
  head: () => ({
    meta: [
      { title: "Payments — LedgerFlow" },
      {
        name: "description",
        content: "Record and review GBP payments by bank transfer, cash, payroll or other methods.",
      },
      { property: "og:title", content: "Payments — LedgerFlow" },
      {
        property: "og:description",
        content: "Payment register that updates invoice outstanding balances instantly.",
      },
    ],
  }),
  component: PaymentsPage,
});

function PaymentsPage() {
  return (
    <RequireView module="payments">
      <PaymentsPageContent />
    </RequireView>
  );
}

function PaymentsPageContent() {
  const { data, invoiceViews, deletePayment } = useLedger();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [endClient, setEndClient] = useState("all");
  const [method, setMethod] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [toDelete, setToDelete] = useState<Payment | null>(null);

  const rows = useMemo(() => {
    const byInvoice = new Map(invoiceViews.map((i) => [i.id, i]));
    const byClient = new Map(data.clients.map((c) => [c.id, c]));
    const q = query.trim().toLowerCase();
    return [...data.payments]
      .map((p) => {
        // A payment belongs to whoever owns the invoice it pays (see
        // calc.ts: paymentOwnerClientId), so moving an invoice moves its payments.
        const ownerId = paymentOwnerClientId(p, byInvoice);
        return {
          payment: p,
          invoice: byInvoice.get(p.invoiceId),
          ownerId,
          client: byClient.get(ownerId),
        };
      })
      .filter((r) => (clientId === "all" ? true : r.ownerId === clientId))
      .filter((r) => (companyId === "all" ? true : (r.client?.companyId ?? null) === companyId))
      .filter((r) =>
        endClient === "all"
          ? true
          : r.invoice
            ? matchesEndClient(r.invoice, endClient)
            : endClient === UNASSIGNED_END_CLIENT,
      )
      .filter((r) => (method === "all" ? true : r.payment.method === method))
      .filter((r) =>
        q
          ? `${r.payment.reference} ${r.invoice?.number ?? ""} ${r.client?.company ?? ""} ${r.client?.name ?? ""}`
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => b.payment.date.localeCompare(a.payment.date));
  }, [data.payments, data.clients, invoiceViews, query, clientId, companyId, endClient, method]);

  const exportExcel = () => {
    const company = (id: string | null | undefined) =>
      id ? (data.companies.find((x) => x.id === id)?.name ?? "") : "";
    downloadXlsx(
      `payments-${new Date().toISOString().slice(0, 10)}`,
      "Payments",
      [
        { header: "Payment Date", width: 14 },
        { header: "Client", width: 28 },
        { header: "Company", width: 24 },
        { header: "End Client", width: 22 },
        { header: "Invoice", width: 16 },
        { header: "PO No.", width: 16 },
        { header: "Payment Method", width: 18 },
        { header: "Amount", width: 14, money: true },
        { header: "Reference", width: 20 },
        { header: "Notes", width: 30 },
      ],
      rows.map(({ payment, invoice, client }) => [
        payment.date,
        client?.company ?? "Unknown",
        company(client?.companyId),
        invoice?.endClient?.trim() ?? "",
        invoice?.number ?? "",
        invoice?.poReference?.trim() ?? "",
        payment.method,
        payment.amount,
        payment.reference,
        payment.notes ?? "",
      ]),
    ).catch(() => toast.error("Export failed."));
  };

  const clientChoices = useMemo(
    () => data.clients.filter((c) => companyId === "all" || (c.companyId ?? null) === companyId),
    [data.clients, companyId],
  );
  const endClientChoices = useMemo(() => {
    const byClient = new Map(data.clients.map((c) => [c.id, c]));
    return endClientOptions(
      invoiceViews.filter(
        (i) =>
          (clientId === "all" || i.clientId === clientId) &&
          (companyId === "all" || (byClient.get(i.clientId)?.companyId ?? null) === companyId),
      ),
    );
  }, [invoiceViews, data.clients, clientId, companyId]);

  const total = round2(rows.reduce((s, r) => s + r.payment.amount, 0));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Payments shown" value={String(rows.length)} />
        <SummaryCard label="Value received" value={formatMoney(total)} tone="success" />
        <SummaryCard
          label="Still outstanding"
          value={formatMoney(round2(invoiceViews.reduce((s, i) => s + i.outstanding, 0)))}
          tone="warning"
        />
      </div>

      <Panel>
        <PanelHeader
          title="Payments"
          description={`${rows.length} of ${data.payments.length} payments`}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportExcel} disabled={rows.length === 0}>
                <Download className="size-4" /> Export to Excel
              </Button>
              {can("payments", "create") ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4" /> Add Payment
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
              placeholder="Search reference, invoice or client…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Select
            value={companyId}
            onValueChange={(v) => {
              setCompanyId(v);
              setEndClient("all");
              const stillThere = data.clients.some(
                (c) => c.id === clientId && (v === "all" || (c.companyId ?? null) === v),
              );
              if (!stillThere) setClientId("all");
            }}
          >
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
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="h-8 w-40 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methods</SelectItem>
              {data.settings.paymentMethods.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No payments match this view"
            description="Adjust the filters, or record a new payment."
          />
        ) : (
          <TableWrap>
            <Table className="min-w-[900px]">
              <THead>
                <TR>
                  <TH>Payment Date</TH>
                  <TH>Client</TH>
                  <TH>Invoice</TH>
                  <TH>Payment Method</TH>
                  <TH align="right">Amount</TH>
                  <TH>Reference</TH>
                  <TH>Notes</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map(({ payment, invoice, client, ownerId }) => (
                  <TR key={payment.id}>
                    <TD>{formatDate(payment.date)}</TD>
                    <TD>
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: ownerId }}
                        className="hover:underline"
                      >
                        {client?.company ?? "Unknown"}
                      </Link>
                      {invoice?.endClient?.trim() ? (
                        <div className="text-[11px] font-normal text-muted-foreground">
                          End client: {invoice.endClient.trim()}
                        </div>
                      ) : null}
                    </TD>
                    <TD mono>{invoice?.number ?? "—"}</TD>
                    <TD>{payment.method}</TD>
                    <TD mono align="right" className="font-medium">
                      {formatMoney(payment.amount)}
                    </TD>
                    <TD mono>{payment.reference || "—"}</TD>
                    <TD className="max-w-[220px] truncate whitespace-nowrap text-muted-foreground">
                      {payment.notes || "—"}
                    </TD>
                    <TD align="right">
                      <div className="flex justify-end gap-1">
                        {can("payments", "edit") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Edit payment"
                            onClick={() => {
                              setEditing(payment);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                        {can("payments", "delete") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete payment"
                            onClick={() => setToDelete(payment)}
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

      <PaymentDialog
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) setEditing(null);
        }}
        payment={editing}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(v) => {
          if (!v) setToDelete(null);
        }}
        title="Delete payment?"
        description="The invoice paid amount, outstanding balance and status will be recalculated."
        confirmLabel="Delete"
        onConfirm={() => {
          if (toDelete) {
            deletePayment(toDelete.id);
            toast.success("Payment removed and balances recalculated.");
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
