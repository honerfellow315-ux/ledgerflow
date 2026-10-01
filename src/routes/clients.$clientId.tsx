import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, FileText, Pencil, Plus, Wallet } from "@/lib/icons";
import { useLedger } from "@/lib/ledger/store";
import {
  formatDate,
  formatMoney,
  paymentOwnerClientId,
  round2,
  totalsForClient,
} from "@/lib/ledger/calc";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { SummaryCard } from "@/components/app/SummaryCard";
import { ClientDialog } from "@/components/app/ClientDialog";
import { InvoiceDialog } from "@/components/app/InvoiceDialog";
import { PaymentDialog } from "@/components/app/PaymentDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireView } from "@/components/app/RequireView";
import { usePermissions } from "@/lib/ledger/permissions";

export const Route = createFileRoute("/clients/$clientId")({
  head: () => ({
    meta: [
      { title: "Client Detail — LedgerFlow" },
      {
        name: "description",
        content:
          "Client account detail with contact information, invoices, payments and a running GBP statement.",
      },
      { property: "og:title", content: "Client Detail — LedgerFlow" },
      {
        property: "og:description",
        content: "Client account overview, invoices, payments and statement.",
      },
    ],
  }),
  component: ClientDetailPage,
  notFoundComponent: () => (
    <Panel>
      <EmptyState
        title="Client not found"
        description="This client does not exist or has been deleted."
      />
    </Panel>
  ),
});

function ClientDetailPage() {
  return (
    <RequireView module="clients">
      <ClientDetailPageContent />
    </RequireView>
  );
}

function ClientDetailPageContent() {
  const { clientId } = Route.useParams();
  const { data, invoiceViews, invoiceViewsWithCredit, creditBalanceByClient, hydrated } =
    useLedger();
  const { can } = usePermissions();
  const [editOpen, setEditOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const client = data.clients.find((c) => c.id === clientId);

  const invoices = useMemo(
    () =>
      invoiceViewsWithCredit
        .filter((i) => i.clientId === clientId)
        .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate)),
    [invoiceViewsWithCredit, clientId],
  );

  // Ownership follows the invoice a payment pays (calc.ts: paymentOwnerClientId).
  const payments = useMemo(() => {
    const byInvoice = new Map(invoiceViewsWithCredit.map((i) => [i.id, i]));
    return data.payments
      .filter((p) => paymentOwnerClientId(p, byInvoice) === clientId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data.payments, invoiceViewsWithCredit, clientId]);

  const statement = useMemo(() => {
    const byInvoice = new Map(invoiceViews.map((i) => [i.id, i]));
    const entries: {
      key: string;
      date: string;
      label: string;
      reference: string;
      debit: number;
      credit: number;
    }[] = [
      ...invoices.map((i) => ({
        key: `i-${i.id}`,
        date: i.invoiceDate,
        label: i.description || "Invoice raised",
        reference: i.number,
        debit: i.total,
        credit: 0,
      })),
      ...payments.map((p) => ({
        key: `p-${p.id}`,
        date: p.date,
        label: `Payment — ${p.method}`,
        reference: p.reference || byInvoice.get(p.invoiceId)?.number || "—",
        debit: 0,
        credit: p.amount,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));

    let balance = 0;
    return entries.map((e) => {
      balance = round2(balance + e.debit - e.credit);
      return { ...e, balance };
    });
  }, [invoices, payments, invoiceViews]);

  if (!hydrated && !client) {
    return (
      <Panel>
        <EmptyState title="Loading client…" />
      </Panel>
    );
  }

  if (!client) throw notFound();

  const totals = totalsForClient(client.id, invoiceViews);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to clients
        </Link>
        <div className="flex items-center gap-2">
          {can("clients", "edit") ? (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" /> Edit Client
            </Button>
          ) : null}
          {can("invoices", "create") ? (
            <Button variant="outline" size="sm" onClick={() => setInvoiceOpen(true)}>
              <FileText className="size-4" /> New Invoice
            </Button>
          ) : null}
          {can("payments", "create") ? (
            <Button size="sm" onClick={() => setPaymentOpen(true)}>
              <Plus className="size-4" /> Record Payment
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Invoiced" value={formatMoney(totals.invoiced)} icon={FileText} />
        <SummaryCard
          label="Total Paid"
          value={formatMoney(totals.paid)}
          tone="success"
          icon={Wallet}
        />
        <SummaryCard
          label="Outstanding"
          value={formatMoney(totals.outstanding)}
          tone={totals.outstanding > 0.004 ? "warning" : "success"}
        />
        <SummaryCard
          label="Invoices"
          value={String(totals.invoiceCount)}
          sublabel={`${payments.length} payments recorded`}
        />
      </div>

      {(creditBalanceByClient.get(clientId) ?? 0) > 0.004 ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-success/25 bg-success-soft px-4 py-2.5 text-[13px] text-success">
          <Wallet className="size-4 shrink-0" />
          <span>
            <strong className="font-semibold">
              {formatMoney(creditBalanceByClient.get(clientId) ?? 0)}
            </strong>{" "}
            credit balance — applied automatically to cover their next invoice(s) before anything is
            shown as outstanding.
          </span>
        </div>
      ) : null}

      <Tabs defaultValue="overview" className="space-y-3">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Panel>
            <PanelHeader
              title={client.company}
              description="Account details"
              actions={<StatusBadge status={client.status} kind="client" />}
            />
            <dl className="grid gap-4 p-4 sm:grid-cols-2">
              <Detail label="Client Name" value={client.name} />
              <Detail label="Company" value={client.company} />
              <Detail label="Email" value={client.email} />
              <Detail label="Phone" value={client.phone} />
              <Detail label="Address" value={client.address} className="sm:col-span-2" />
              <Detail label="Account Status" value={statusLabel(client.status)} />
              <Detail label="Notes" value={client.notes || "—"} />
            </dl>
          </Panel>
        </TabsContent>

        <TabsContent value="invoices">
          <Panel>
            <PanelHeader
              title="Invoices"
              description={`${invoices.length} invoices for this account`}
            />
            {invoices.length === 0 ? (
              <EmptyState
                title="No invoices yet"
                description="Create an invoice for this client."
              />
            ) : (
              <TableWrap>
                <Table className="min-w-[900px]">
                  <THead>
                    <TR>
                      <TH>Invoice No.</TH>
                      <TH>Invoice Date</TH>
                      <TH>Due Date</TH>
                      <TH align="right">Ex VAT</TH>
                      <TH align="right">VAT</TH>
                      <TH align="right">Inc VAT</TH>
                      <TH align="right">Paid</TH>
                      <TH align="right">Outstanding</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {invoices.map((i) => (
                      <TR key={i.id}>
                        <TD mono className="font-medium">
                          {i.number}
                        </TD>
                        <TD>{formatDate(i.invoiceDate)}</TD>
                        <TD>{formatDate(i.dueDate)}</TD>
                        <TD mono align="right">
                          {formatMoney(i.amountExVat)}
                        </TD>
                        <TD mono align="right">
                          {formatMoney(i.vat)}
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
        </TabsContent>

        <TabsContent value="payments">
          <Panel>
            <PanelHeader title="Payments" description={`${payments.length} payments recorded`} />
            {payments.length === 0 ? (
              <EmptyState title="No payments yet" description="Record a payment for this client." />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Payment Date</TH>
                      <TH>Invoice</TH>
                      <TH>Method</TH>
                      <TH align="right">Amount</TH>
                      <TH>Reference</TH>
                      <TH>Notes</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {payments.map((p) => (
                      <TR key={p.id}>
                        <TD>{formatDate(p.date)}</TD>
                        <TD mono>
                          {invoiceViews.find((i) => i.id === p.invoiceId)?.number ?? "—"}
                        </TD>
                        <TD>{p.method}</TD>
                        <TD mono align="right" className="font-medium">
                          {formatMoney(p.amount)}
                        </TD>
                        <TD mono>{p.reference || "—"}</TD>
                        <TD className="max-w-[220px] truncate text-muted-foreground">
                          {p.notes || "—"}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="statement">
          <Panel>
            <PanelHeader
              title="Statement of Account"
              description={`Running balance in GBP — closing balance ${formatMoney(totals.outstanding)}`}
            />
            {statement.length === 0 ? (
              <EmptyState title="No ledger activity" />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Date</TH>
                      <TH>Detail</TH>
                      <TH>Reference</TH>
                      <TH align="right">Debit</TH>
                      <TH align="right">Credit</TH>
                      <TH align="right">Balance</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {statement.map((e) => (
                      <TR key={e.key}>
                        <TD>{formatDate(e.date)}</TD>
                        <TD>{e.label}</TD>
                        <TD mono>{e.reference}</TD>
                        <TD mono align="right">
                          {e.debit ? formatMoney(e.debit) : "—"}
                        </TD>
                        <TD mono align="right">
                          {e.credit ? formatMoney(e.credit) : "—"}
                        </TD>
                        <TD mono align="right" className="font-medium">
                          {formatMoney(e.balance)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      <ClientDialog open={editOpen} onOpenChange={setEditOpen} client={client} />
      <InvoiceDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} defaultClientId={client.id} />
      <PaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} defaultClientId={client.id} />
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "on-hold") return "On hold";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function Detail({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] text-foreground">{value}</dd>
    </div>
  );
}
