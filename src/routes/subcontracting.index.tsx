import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { HardHat, Pencil, Plus, Printer, Search, Trash2 } from "@/lib/icons";
import { toast } from "sonner";
import { useLedger } from "@/lib/ledger/store";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import {
  businessProfileFor,
  formatDate,
  formatHours,
  formatMoney,
  formatMonth,
  invoiceHoursSummaries,
  invoiceTracksHours,
  remainingHours,
  remainingInvoiceHours,
  round2,
  subcontractValue,
  subcontractVat,
  subcontractValueIncVat,
} from "@/lib/ledger/calc";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SubcontractDialog } from "@/components/app/SubcontractDialog";
import { SubcontractDocument } from "@/components/app/SubcontractDocument";
import { SubcontractDocumentSafari } from "@/components/app/SubcontractDocument.safari";
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
import type { SubcontractEntry } from "@/lib/ledger/types";

export const Route = createFileRoute("/subcontracting/")({
  head: () => ({
    meta: [
      { title: "Subcontracting — LedgerFlow" },
      {
        name: "description",
        content:
          "Hours billed out to subcontracted clients each month, with rate, value and the invoice raised against them.",
      },
      { property: "og:title", content: "Subcontracting — LedgerFlow" },
      {
        property: "og:description",
        content: "Monthly subcontracted hours proceeded, rates and invoiced values.",
      },
    ],
  }),
  component: SubcontractingPage,
});

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Date filter: uses the entry's invoice date when it has one, otherwise the
 * month it covers overlaps the range. (yyyy-mm-31 is only for string compare.) */
const monthInRange = (month: string, from: string, to: string) =>
  (from ? `${month}-31` >= from : true) && (to ? `${month}-01` <= to : true);

const inDateRange = (s: { month: string; invoiceDate?: string | undefined }, from: string, to: string) => {
  if (s.invoiceDate) {
    return (from ? s.invoiceDate >= from : true) && (to ? s.invoiceDate <= to : true);
  }
  return (from ? `${s.month}-31` >= from : true) && (to ? `${s.month}-01` <= to : true);
};

function SubcontractingPage() {
  return (
    <RequireView module="subcontracting">
      <SubcontractingPageContent />
    </RequireView>
  );
}

function SubcontractingPageContent() {
  const { data, deleteSubcontract } = useLedger();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [openCompany, setOpenCompany] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SubcontractEntry | null>(null);
  const [toDelete, setToDelete] = useState<SubcontractEntry | null>(null);
  const [printEntry, setPrintEntry] = useState<SubcontractEntry | null>(null);
  // Chrome's print workflow (SubcontractDocument) stays the default; only
  // flips to the Safari-safe variant after mount. See src/lib/print-browser.ts.
  const [safariPrint, setSafariPrint] = useState(false);
  useEffect(() => {
    setSafariPrint(shouldUseSafariPrintLayout());
  }, []);

  // Same "hidden div + window.print()" approach as the client invoice print
  // flow in routes/invoices.index.tsx.
  useEffect(() => {
    if (!printEntry) return;
    const frame = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(frame);
  }, [printEntry]);

  useEffect(() => {
    const handler = () => setPrintEntry(null);
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, []);

  const clientById = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const invoiceById = useMemo(() => new Map(data.invoices.map((i) => [i.id, i])), [data.invoices]);
  // The billing-company each client is invoiced under — same map used by
  // the Invoices screen's Company filter (see routes/invoices.index.tsx).
  const clientCompanyId = useMemo(
    () => new Map(data.clients.map((c) => [c.id, c.companyId ?? null])),
    [data.clients],
  );
  // Clients visible in the Client filter narrow down as soon as a Company
  // is picked — matches the "Company: ABC Company" → its invoices example.
  const clientsForCompany = useMemo(
    () =>
      companyId === "all" ? data.clients : data.clients.filter((c) => c.companyId === companyId),
    [data.clients, companyId],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.subcontracts
      .filter((s) => (clientId === "all" ? true : s.clientId === clientId))
      .filter((s) => (companyId === "all" ? true : clientCompanyId.get(s.clientId) === companyId))
      .filter((s) => inDateRange(s, fromDate, toDate))
      .filter((s) => {
        if (!q) return true;
        const client = clientById.get(s.clientId);
        return `${s.month} ${client?.company ?? ""} ${s.subcontractorName} ${s.invoiceNumber ?? ""} ${s.reference ?? ""} ${s.notes ?? ""}`
          .toLowerCase()
          .includes(q);
      })
      .map((s) => ({
        ...s,
        clientCompany: clientById.get(s.clientId)?.company ?? "—",
        value: subcontractValue(s),
        vat: subcontractVat(s),
        total: subcontractValueIncVat(s),
      }))
      .sort(
        (a, b) => b.month.localeCompare(a.month) || a.clientCompany.localeCompare(b.clientCompany),
      );
  }, [
    data.subcontracts,
    clientById,
    clientCompanyId,
    query,
    clientId,
    companyId,
    fromDate,
    toDate,
  ]);

  // "Company: ABC Company → Invoice #101 → Total: 1,500 → Remaining: 400" —
  // shown once a Company or Client filter narrows things down, so it's
  // obvious how many hours are still available to process against each
  // invoice before opening the Add Entry form.
  const invoiceHoursRows = useMemo(() => {
    const summaries = invoiceHoursSummaries(data.invoices, data.subcontracts);
    return summaries
      .filter((s) => (clientId === "all" ? true : s.clientId === clientId))
      .filter((s) => (companyId === "all" ? true : clientCompanyId.get(s.clientId) === companyId))
      .map((s) => ({ ...s, clientCompany: clientById.get(s.clientId)?.company ?? "—" }))
      .sort(
        (a, b) =>
          a.clientCompany.localeCompare(b.clientCompany) ||
          a.invoiceNumber.localeCompare(b.invoiceNumber),
      );
  }, [data.invoices, data.subcontracts, clientById, clientCompanyId, clientId, companyId]);

  // Company-wise remaining hours: the Hours page's "Remaining Hours" summed
  // over every client of the company, minus hours already proceeded here.
  const companyHours = useMemo(() => {
    type ClientRow = { clientId: string; name: string; remaining: number; proceeded: number };
    const groups = new Map<string, { id: string; name: string; clients: Map<string, ClientRow> }>();
    const rowFor = (clientId: string): ClientRow | null => {
      const client = clientById.get(clientId);
      if (!client) return null;
      const gid = client.companyId ?? "none";
      let g = groups.get(gid);
      if (!g) {
        g = {
          id: gid,
          name: (client.companyId && data.companies.find((c) => c.id === client.companyId)?.name) || "No company",
          clients: new Map(),
        };
        groups.set(gid, g);
      }
      let r = g.clients.get(clientId);
      if (!r) {
        r = { clientId, name: client.company, remaining: 0, proceeded: 0 };
        g.clients.set(clientId, r);
      }
      return r;
    };
    for (const h of data.hours) {
      if (!monthInRange(h.month, fromDate, toDate)) continue;
      const r = rowFor(h.clientId);
      if (r) r.remaining += remainingHours(h);
    }
    for (const sc of data.subcontracts) {
      if (!monthInRange(sc.month, fromDate, toDate)) continue;
      const r = rowFor(sc.clientId);
      if (r) r.proceeded += sc.hoursProceed;
    }
    return [...groups.values()]
      .map((g) => {
        const clients = [...g.clients.values()]
          .filter((c) => c.remaining !== 0 || c.proceeded !== 0)
          .map((c) => ({
            ...c,
            remaining: round2(c.remaining),
            proceeded: round2(c.proceeded),
            available: round2(c.remaining - c.proceeded),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const remaining = round2(clients.reduce((x, c) => x + c.remaining, 0));
        const proceeded = round2(clients.reduce((x, c) => x + c.proceeded, 0));
        return { id: g.id, name: g.name, clients, remaining, proceeded, available: round2(remaining - proceeded) };
      })
      .filter((g) => g.clients.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.hours, data.subcontracts, data.companies, clientById, fromDate, toDate]);

  const totals = useMemo(() => {
    const current = thisMonth();
    return {
      hoursThisMonth: round2(
        data.subcontracts
          .filter((s) => s.month === current)
          .reduce((sum, s) => sum + s.hoursProceed, 0),
      ),
      value: round2(rows.reduce((sum, r) => sum + r.value, 0)),
    };
  }, [data.subcontracts, rows]);

  const filtered = query || clientId !== "all" || companyId !== "all" || fromDate || toDate;

  return (
    <>
      <div className="subcontracting-screen space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryCard
            label="Hours Proceed This Month"
            value={formatHours(totals.hoursThisMonth)}
            sublabel={formatMonth(thisMonth())}
            icon={HardHat}
          />
          <SummaryCard label="Total Value" value={formatMoney(totals.value)} tone="success" />
        </div>

        {companyHours.length > 0 ? (
          <Panel>
            <PanelHeader
              title="Remaining Hours by Company"
              description="Remaining hours from the Hours page, added up per company, less hours already proceeded below."
            />
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Company</TH>
                    <TH align="right">Clients</TH>
                    <TH align="right">Remaining Hours</TH>
                    <TH align="right">Already Proceeded</TH>
                    <TH align="right">Available to Invoice</TH>
                  </TR>
                </THead>
                <TBody>
                  {companyHours.map((g) => (
                    <Fragment key={g.id}>
                      <TR
                        className="cursor-pointer"
                        onClick={() => setOpenCompany(openCompany === g.id ? null : g.id)}
                      >
                        <TD className="font-medium">
                          {openCompany === g.id ? "▾" : "▸"} {g.name}
                        </TD>
                        <TD mono align="right">
                          {g.clients.length}
                        </TD>
                        <TD mono align="right">
                          {formatHours(g.remaining)}
                        </TD>
                        <TD mono align="right">
                          {formatHours(g.proceeded)}
                        </TD>
                        <TD mono align="right" className="font-medium">
                          {formatHours(g.available)}
                        </TD>
                      </TR>
                      {openCompany === g.id
                        ? g.clients.map((c) => (
                            <TR key={c.clientId} className="text-muted-foreground">
                              <TD className="pl-8">{c.name}</TD>
                              <TD />
                              <TD mono align="right">
                                {formatHours(c.remaining)}
                              </TD>
                              <TD mono align="right">
                                {formatHours(c.proceeded)}
                              </TD>
                              <TD mono align="right">
                                {formatHours(c.available)}
                              </TD>
                            </TR>
                          ))
                        : null}
                    </Fragment>
                  ))}
                  <TR>
                    <TD className="font-semibold">Total</TD>
                    <TD mono align="right" className="font-semibold">
                      {companyHours.reduce((x, g) => x + g.clients.length, 0)}
                    </TD>
                    <TD mono align="right" className="font-semibold">
                      {formatHours(round2(companyHours.reduce((x, g) => x + g.remaining, 0)))}
                    </TD>
                    <TD mono align="right" className="font-semibold">
                      {formatHours(round2(companyHours.reduce((x, g) => x + g.proceeded, 0)))}
                    </TD>
                    <TD mono align="right" className="font-semibold">
                      {formatHours(round2(companyHours.reduce((x, g) => x + g.available, 0)))}
                    </TD>
                  </TR>
                </TBody>
              </Table>
            </TableWrap>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            title="Subcontracting"
            description={`${rows.length} of ${data.subcontracts.length} monthly entries`}
            actions={
              can("subcontracting", "create") ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4" /> Add Entry
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
                placeholder="Search client or invoice…"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <Select
              value={companyId}
              onValueChange={(v) => {
                setCompanyId(v);
                // Drop the client filter if it no longer belongs to the
                // newly-selected company, so the two filters never disagree.
                if (v !== "all" && clientId !== "all") {
                  const client = clientById.get(clientId);
                  if (client?.companyId !== v) setClientId("all");
                }
              }}
            >
              <SelectTrigger className="h-8 w-44 text-[13px]">
                <SelectValue placeholder="All companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {data.companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="h-8 w-48 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {clientsForCompany.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 w-40 text-[13px]"
              aria-label="Date from"
              title="Date from"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 w-40 text-[13px]"
              aria-label="Date to"
              title="Date to"
            />
            {filtered ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setClientId("all");
                  setCompanyId("all");
                  setFromDate("");
                  setToDate("");
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {invoiceHoursRows.length > 0 && (companyId !== "all" || clientId !== "all") ? (
            <div className="border-b border-border px-4 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Invoice Hours{" "}
                {companyId !== "all"
                  ? `— ${data.companies.find((c) => c.id === companyId)?.name ?? ""}`
                  : null}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {invoiceHoursRows.map((r) => (
                  <div
                    key={r.invoiceId}
                    className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface-muted px-3 py-2 text-[12px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.invoiceNumber}</p>
                      <p className="truncate text-muted-foreground">{r.clientCompany}</p>
                    </div>
                    <div className="shrink-0 text-right num">
                      <p className="text-muted-foreground">Total {formatHours(r.totalHours)}</p>
                      <p
                        className={
                          r.remainingHours <= 0.004
                            ? "font-semibold text-destructive"
                            : "font-semibold text-success"
                        }
                      >
                        Remaining {formatHours(r.remainingHours)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              title={filtered ? "No entries match this view" : "No subcontracted hours yet"}
              description={
                filtered
                  ? "Adjust the filters to see other months or clients."
                  : "Add an entry to record hours billed out to a subcontracted client."
              }
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[1580px]">
                <THead>
                  <TR>
                    <TH>Month</TH>
                    <TH>Client</TH>
                    <TH>Subcontractor</TH>
                    <TH align="right">Hours Proceed</TH>
                    <TH align="right">Rate</TH>
                    <TH align="right">Value</TH>
                    <TH align="right">VAT</TH>
                    <TH align="right">Total</TH>
                    <TH>Invoice</TH>
                    <TH>Invoice Date</TH>
                    <TH>Due Date</TH>
                    <TH>Invoice No.</TH>
                    <TH>Notes</TH>
                    <TH align="right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((s) => {
                    const linkedInvoice = s.invoiceId ? invoiceById.get(s.invoiceId) : undefined;
                    const remaining = linkedInvoice
                      ? remainingInvoiceHours(linkedInvoice, data.subcontracts)
                      : null;
                    return (
                      <TR key={s.id}>
                        <TD className="font-medium">{formatMonth(s.month)}</TD>
                        <TD>{s.clientCompany}</TD>
                        <TD>{s.subcontractorName || "—"}</TD>
                        <TD mono align="right">
                          {formatHours(s.hoursProceed)}
                        </TD>
                        <TD mono align="right">
                          {formatMoney(s.rate)}
                        </TD>
                        <TD mono align="right" className="font-medium">
                          {formatMoney(s.value)}
                        </TD>
                        <TD
                          mono
                          align="right"
                          className={s.vat > 0 ? undefined : "text-muted-foreground"}
                        >
                          {s.vat > 0 ? formatMoney(s.vat) : "—"}
                        </TD>
                        <TD mono align="right" className="font-medium">
                          {formatMoney(s.total)}
                        </TD>
                        <TD>
                          {linkedInvoice ? (
                            <div className="whitespace-nowrap">
                              <span className="font-medium">{linkedInvoice.number}</span>
                              {invoiceTracksHours(linkedInvoice) ? (
                                <span className="ml-1.5 text-[11px] text-muted-foreground">
                                  ({formatHours(remaining ?? 0)}h remaining)
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TD>
                        <TD>{formatDate(s.invoiceDate ?? "")}</TD>
                        <TD>{formatDate(s.dueDate ?? "")}</TD>
                        <TD mono>{s.invoiceNumber || "—"}</TD>
                        <TD className="max-w-56 truncate whitespace-normal">{s.notes || "—"}</TD>
                        <TD align="right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Print subcontractor document"
                              onClick={() => setPrintEntry(s)}
                            >
                              <Printer className="size-4" />
                            </Button>
                            {can("subcontracting", "edit") ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Edit subcontract entry"
                                onClick={() => {
                                  setEditing(s);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil className="size-4" />
                              </Button>
                            ) : null}
                            {can("subcontracting", "delete") ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Delete subcontract entry"
                                onClick={() => setToDelete(s)}
                              >
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            ) : null}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Panel>

        <SubcontractDialog open={formOpen} onOpenChange={setFormOpen} entry={editing} />

        <ConfirmDialog
          open={Boolean(toDelete)}
          onOpenChange={(v) => !v && setToDelete(null)}
          title="Delete subcontract entry?"
          description={
            toDelete
              ? `The entry for ${formatMonth(toDelete.month)} will be permanently removed.`
              : ""
          }
          confirmLabel="Delete"
          onConfirm={() => {
            if (toDelete) {
              deleteSubcontract(toDelete.id);
              toast.success("Subcontract entry deleted.");
            }
            setToDelete(null);
          }}
        />
      </div>

      {printEntry ? (
        safariPrint ? (
          <SubcontractDocumentSafari
            settings={businessProfileFor(
              data.settings,
              data.companies,
              data.clients.find((c) => c.id === printEntry.clientId),
            )}
            client={data.clients.find((c) => c.id === printEntry.clientId)}
            entry={printEntry}
          />
        ) : (
          <SubcontractDocument
            settings={businessProfileFor(
              data.settings,
              data.companies,
              data.clients.find((c) => c.id === printEntry.clientId),
            )}
            client={data.clients.find((c) => c.id === printEntry.clientId)}
            entry={printEntry}
          />
        )
      ) : null}
    </>
  );
}
