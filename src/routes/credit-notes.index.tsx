import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FileMinus, Pencil, Plus, Printer, Search, Trash2 } from "@/lib/icons";
import { toast } from "sonner";
import { useLedger } from "@/lib/ledger/store";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import {
  businessProfileFor,
  creditNoteTotal,
  creditNoteVat,
  formatDate,
  formatMoney,
  round2,
} from "@/lib/ledger/calc";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { CreditNoteDialog } from "@/components/app/CreditNoteDialog";
import { CreditNoteDocument } from "@/components/app/CreditNoteDocument";
import { CreditNoteDocumentSafari } from "@/components/app/CreditNoteDocument.safari";
import { shouldUseSafariPrintLayout } from "@/lib/print-browser";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CreditNote } from "@/lib/ledger/types";

export const Route = createFileRoute("/credit-notes/")({
  head: () => ({
    meta: [
      { title: "Credit Notes — LedgerFlow" },
      {
        name: "description",
        content:
          "Credit notes issued to clients, optionally linked to an invoice, with net, VAT and total amounts and draft, issued or applied status.",
      },
      { property: "og:title", content: "Credit Notes — LedgerFlow" },
      {
        property: "og:description",
        content: "Raise and track client credit notes against outstanding invoices.",
      },
    ],
  }),
  component: CreditNotesPage,
});

function CreditNotesPage() {
  return (
    <RequireView module="creditNotes">
      <CreditNotesPageContent />
    </RequireView>
  );
}

function CreditNotesPageContent() {
  const { data, deleteCreditNote } = useLedger();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("all");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CreditNote | null>(null);
  const [toDelete, setToDelete] = useState<CreditNote | null>(null);
  const [printNote, setPrintNote] = useState<CreditNote | null>(null);
  // Same Chrome-default / Safari-variant switch the invoices page uses.
  const [safariPrint, setSafariPrint] = useState(false);
  useEffect(() => {
    setSafariPrint(shouldUseSafariPrintLayout());
  }, []);

  // Open the browser print dialog once the selected credit note has rendered
  // into the print-only .invoice-doc, then clear it when printing is dismissed.
  useEffect(() => {
    if (!printNote) return;
    const frame = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(frame);
  }, [printNote]);
  useEffect(() => {
    const handler = () => setPrintNote(null);
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, []);

  const clientById = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const invoiceById = useMemo(() => new Map(data.invoices.map((i) => [i.id, i])), [data.invoices]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.creditNotes
      .filter((n) => (clientId === "all" ? true : n.clientId === clientId))
      .filter((n) => (status === "all" ? true : n.status === status))
      .filter((n) => {
        if (!q) return true;
        const client = clientById.get(n.clientId);
        return `${n.number} ${client?.company ?? ""} ${n.reason}`.toLowerCase().includes(q);
      })
      .map((n) => ({
        ...n,
        clientCompany: clientById.get(n.clientId)?.company ?? "—",
        invoiceNumber: n.invoiceId ? (invoiceById.get(n.invoiceId)?.number ?? "—") : "—",
        vat: creditNoteVat(n),
        total: creditNoteTotal(n),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data.creditNotes, clientById, invoiceById, query, clientId, status]);

  const totals = useMemo(
    () => ({
      total: round2(rows.reduce((s, r) => s + r.total, 0)),
      issued: round2(rows.filter((r) => r.status === "issued").reduce((s, r) => s + r.total, 0)),
      applied: round2(rows.filter((r) => r.status === "applied").reduce((s, r) => s + r.total, 0)),
    }),
    [rows],
  );

  const filtered = query || clientId !== "all" || status !== "all";

  const printClient = printNote ? data.clients.find((c) => c.id === printNote.clientId) : undefined;
  const printInvoiceNumber = printNote?.invoiceId
    ? invoiceById.get(printNote.invoiceId)?.number
    : undefined;

  return (
    <>
      <div className="invoices-screen space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            label="Credited (filtered)"
            value={formatMoney(totals.total)}
            icon={FileMinus}
          />
          <SummaryCard label="Issued" value={formatMoney(totals.issued)} tone="warning" />
          <SummaryCard label="Applied" value={formatMoney(totals.applied)} tone="success" />
        </div>

        <Panel>
          <PanelHeader
            title="Credit Notes"
            description={`${rows.length} of ${data.creditNotes.length} credit notes`}
            actions={
              can("creditNotes", "create") ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4" /> Add Credit Note
                </Button>
              ) : undefined
            }
          />

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search number, client or reason…"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="h-8 w-48 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {data.clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-36 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="issued">Issued</SelectItem>
                <SelectItem value="applied">Applied</SelectItem>
              </SelectContent>
            </Select>
            {filtered ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setClientId("all");
                  setStatus("all");
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={filtered ? "No credit notes match this view" : "No credit notes yet"}
              description={
                filtered
                  ? "Adjust the search or filters to see other credit notes."
                  : "Raise a credit note when a client is owed a credit against their account."
              }
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[1080px]">
                <THead>
                  <TR>
                    <TH>Number</TH>
                    <TH>Client</TH>
                    <TH>Linked Invoice</TH>
                    <TH>Date</TH>
                    <TH>Reason</TH>
                    <TH align="right">Amount (ex VAT)</TH>
                    <TH align="right">VAT</TH>
                    <TH align="right">Total</TH>
                    <TH>Status</TH>
                    <TH align="right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((n) => (
                    <TR key={n.id}>
                      <TD mono className="font-medium">
                        {n.number}
                      </TD>
                      <TD>
                        <Link
                          to="/clients/$clientId"
                          params={{ clientId: n.clientId }}
                          className="hover:underline"
                        >
                          {n.clientCompany}
                        </Link>
                      </TD>
                      <TD mono>{n.invoiceNumber}</TD>
                      <TD>{formatDate(n.date)}</TD>
                      <TD className="max-w-64 truncate whitespace-normal">{n.reason}</TD>
                      <TD mono align="right">
                        {formatMoney(n.amountExVat)}
                      </TD>
                      <TD mono align="right">
                        {formatMoney(n.vat)}
                      </TD>
                      <TD mono align="right" className="font-medium">
                        {formatMoney(n.total)}
                      </TD>
                      <TD>
                        <StatusBadge status={n.status} kind="credit" />
                      </TD>
                      <TD align="right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Print / PDF"
                            onClick={() => setPrintNote(n)}
                          >
                            <Printer className="size-4" />
                          </Button>
                          {can("creditNotes", "edit") ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Edit credit note"
                              onClick={() => {
                                setEditing(n);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          ) : null}
                          {can("creditNotes", "delete") ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete credit note"
                              onClick={() => setToDelete(n)}
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

        <CreditNoteDialog open={formOpen} onOpenChange={setFormOpen} note={editing} />

        <ConfirmDialog
          open={Boolean(toDelete)}
          onOpenChange={(v) => !v && setToDelete(null)}
          title="Delete credit note?"
          description={
            toDelete ? `Credit note ${toDelete.number} will be permanently removed.` : ""
          }
          confirmLabel="Delete"
          onConfirm={() => {
            if (toDelete) {
              deleteCreditNote(toDelete.id);
              toast.success("Credit note deleted.");
            }
            setToDelete(null);
          }}
        />
      </div>

      {printNote ? (
        safariPrint ? (
          <CreditNoteDocumentSafari
            settings={businessProfileFor(data.settings, data.companies, printClient)}
            client={printClient}
            note={printNote}
            invoiceNumber={printInvoiceNumber}
          />
        ) : (
          <CreditNoteDocument
            settings={businessProfileFor(data.settings, data.companies, printClient)}
            client={printClient}
            note={printNote}
            invoiceNumber={printInvoiceNumber}
          />
        )
      ) : null}
    </>
  );
}