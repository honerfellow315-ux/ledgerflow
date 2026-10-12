import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FilePlus,
  Info,
  Search,
} from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pill } from "@/components/app/timesheets/badges";
import { DraftPreviewDialog } from "@/components/app/invoiceDrafts/DraftPreviewDialog";
import { LinkClientDialog } from "@/components/app/invoiceDrafts/LinkClientDialog";
import {
  createDrafts,
  listDraftMonths,
  listDrafts,
  type DraftFilter,
} from "@/lib/actions/invoiceDrafts";
import { formatMoney } from "@/lib/ledger/calc";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import { draftState, draftTotals, type Draft, type UnmatchedName } from "@/lib/invoiceDrafts/data";

export const Route = createFileRoute("/invoice-drafts/")({
  head: () => ({
    meta: [
      { title: "Invoice Drafts — LedgerFlow" },
      {
        name: "description",
        content: "Invoices prepared from the month's shifts, ready to check and create.",
      },
    ],
  }),
  component: InvoiceDraftsPage,
});

function InvoiceDraftsPage() {
  return (
    <RequireView module="invoices">
      <InvoiceDraftsContent />
    </RequireView>
  );
}

const PAGE_SIZE = 50;

function InvoiceDraftsContent() {
  const { can, ready } = usePermissions();
  const allowed = can("invoices", "view") && can("salary", "view");
  const canCreate = can("invoices", "create");
  const qc = useQueryClient();

  const [month, setMonth] = useState("");
  const [filter, setFilter] = useState<DraftFilter>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Draft | null>(null);
  const [linking, setLinking] = useState<UnmatchedName | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const monthsQ = useQuery({
    queryKey: ["invoiceDrafts", "months"],
    queryFn: () => unwrap(listDraftMonths()),
    enabled: ready && allowed,
  });
  const months = monthsQ.data ?? [];
  const active = months.find((m) => m.month === month) ?? months[0] ?? null;

  const listQ = useQuery({
    queryKey: ["invoiceDrafts", "list", active?.month, filter, search, page],
    queryFn: () =>
      unwrap(
        listDrafts({
          data: { month: active?.month ?? "", filter, search, page, pageSize: PAGE_SIZE },
        }),
      ),
    enabled: ready && allowed && active !== null,
    placeholderData: keepPreviousData,
  });
  const data = listQ.data;
  const rows = data?.rows ?? [];
  const sum = data?.summary;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!ready) return null;
  if (!allowed) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Invoice Drafts are built from the Salary Sheet, so you need to see both Invoices and the Salary Sheet."
        />
      </Panel>
    );
  }

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["invoiceDrafts"] }),
      // the Invoices and Hours screens read from these
      qc.invalidateQueries({ queryKey: ["invoices"] }),
      qc.invalidateQueries({ queryKey: ["hours"] }),
      qc.invalidateQueries({ queryKey: ["settings"] }),
    ]);

  async function create(ids: string[], allowWarnings: boolean) {
    if (!active || busy || ids.length === 0) return;
    setBusy(true);
    try {
      const res = await unwrap(
        createDrafts({ data: { month: active.month, clientIds: ids, allowWarnings } }),
      );
      if (res.created.length > 0) {
        const first = res.created[0]?.number ?? "";
        const last = res.created[res.created.length - 1]?.number ?? "";
        toast.success(
          res.created.length === 1
            ? `Invoice ${first} created for ${res.created[0]?.client ?? ""}.`
            : `${res.created.length} invoices created (${first} to ${last}).`,
        );
      }
      for (const s of res.skipped.slice(0, 4)) toast.warning(`${s.client}: ${s.reason}`);
      if (res.skipped.length > 4) toast.warning(`${res.skipped.length - 4} more were not created.`);
      setPicked(new Set());
      setOpen(null);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "The invoices could not be created."));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const pickable = rows.filter((d) => draftState(d).state === "ready");
  const allPicked = pickable.length > 0 && pickable.every((d) => picked.has(d.id));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const reset = () => {
    setPicked(new Set());
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Invoice Drafts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invoices prepared from the month's Salary Sheet shifts. Check each one, then create it.
          </p>
        </div>
        {canCreate ? (
          <Button disabled={picked.size === 0 || busy} onClick={() => setConfirmBulk(true)}>
            <FilePlus className="size-4" /> Create selected{picked.size ? ` (${picked.size})` : ""}
          </Button>
        ) : null}
      </div>

      {data && !data.periodFound ? (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-[13px] text-foreground"
        >
          <Info className="mt-0.5 size-4 text-primary" aria-hidden="true" />
          <p>There is no Salary Sheet for this month yet, so there is nothing to bill.</p>
        </div>
      ) : null}
      {data &&
      data.periodFound &&
      data.periodStatus !== "verified" &&
      data.periodStatus !== "closed" ? (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] text-foreground"
        >
          <Info className="mt-0.5 size-4 text-warning" aria-hidden="true" />
          <p>
            The Salary Sheet for this month is still <strong>{data.periodStatus || "draft"}</strong>{" "}
            (not verified yet), so the shifts can still change. Check it before you bill.
          </p>
        </div>
      ) : null}
      {data && data.unmatchedCount > 0 ? (
        <Panel>
          <PanelHeader
            title={`${data.unmatchedCount} client name${data.unmatchedCount === 1 ? "" : "s"} in the shifts could not be matched`}
            description="These hours are NOT in any draft until you link the name to a client."
          />
          <ul className="divide-y divide-border text-[13px]">
            {data.unmatched.slice(0, 10).map((u) => (
              <li
                key={u.name}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              >
                <span>
                  <span className="font-medium">{u.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    {u.shifts} shifts, {Number(u.hours.toFixed(2))} h
                    {u.reason === "several" ? " (matches several clients)" : ""}
                  </span>
                </span>
                {canCreate && u.name !== "(no client name)" ? (
                  <Button size="sm" variant="outline" onClick={() => setLinking(u)}>
                    Link to a client
                  </Button>
                ) : null}
              </li>
            ))}
            {data.unmatchedCount > 10 ? (
              <li className="px-4 py-2 text-muted-foreground">
                And {data.unmatchedCount - 10} more (biggest first is shown).
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Drafts"
          value={String(sum?.count ?? 0)}
          sublabel={active ? formatMonthLabel(active.month) : ""}
          icon={FilePlus}
        />
        <SummaryCard
          label="Ready"
          value={String(sum?.ready ?? 0)}
          sublabel="Nothing to fix"
          icon={CheckCircle2}
          tone="success"
        />
        <SummaryCard
          label="Need a look"
          value={String(sum?.check ?? 0)}
          sublabel={sum?.check ? "Check before creating" : "All clear"}
          icon={AlertTriangle}
          tone={sum?.check ? "warning" : "success"}
        />
        <SummaryCard label="Ready to bill, ex VAT" value={formatMoney(sum?.readyExVat ?? 0)} />
      </div>

      <Panel>
        <PanelHeader
          title="Clients"
          description={`${total} of ${sum?.count ?? 0} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={active?.month ?? ""}
                onValueChange={(v) => {
                  setMonth(v);
                  reset();
                }}
              >
                <SelectTrigger className="h-9 w-40">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.month} value={m.month}>
                      {formatMonthLabel(m.month)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filter}
                onValueChange={(v) => {
                  setFilter(v as DraftFilter);
                  reset();
                }}
              >
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All drafts</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="check">Need a look</SelectItem>
                  <SelectItem value="done">Invoiced</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search clients"
                  className="h-9 w-44 pl-8"
                />
              </div>
            </div>
          }
        />
        {monthsQ.isLoading || (active !== null && listQ.isLoading) ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : monthsQ.isError || listQ.isError ? (
          <EmptyState
            title="The drafts could not be loaded"
            description={errorMessage(monthsQ.error ?? listQ.error, "Please try again.")}
          />
        ) : active === null ? (
          <EmptyState
            title="No Salary Sheet months yet"
            description="Import shifts into a Salary Sheet month first, then come back here."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={(sum?.count ?? 0) === 0 ? "No billable shifts this month" : "No clients found"}
            description={
              (sum?.count ?? 0) === 0
                ? "There are no shifts matched to a client for this month."
                : "Try another name or filter."
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table className="min-w-[960px]">
                <THead>
                  <TR>
                    <TH>
                      {canCreate ? (
                        <Checkbox
                          aria-label="Select all ready drafts on this page"
                          checked={allPicked}
                          onCheckedChange={(v) =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              for (const d of pickable) {
                                if (v === true) next.add(d.id);
                                else next.delete(d.id);
                              }
                              return next;
                            })
                          }
                        />
                      ) : null}
                    </TH>
                    <TH>Client</TH>
                    <TH align="right">Hours</TH>
                    <TH align="right">Rate</TH>
                    <TH align="right">Ex VAT</TH>
                    <TH align="right">Total</TH>
                    <TH>Status</TH>
                    <TH align="right">Draft</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((d) => {
                    const t = draftTotals(d);
                    const s = draftState(d);
                    return (
                      <TR key={d.id} onClick={() => setOpen(d)}>
                        <TD>
                          <div onClick={(e) => e.stopPropagation()}>
                            {canCreate ? (
                              <Checkbox
                                aria-label={`Select ${d.client}`}
                                disabled={s.state !== "ready"}
                                checked={picked.has(d.id)}
                                onCheckedChange={() => toggle(d.id)}
                              />
                            ) : null}
                          </div>
                        </TD>
                        <TD className="font-medium">{d.client}</TD>
                        <TD align="right" mono>
                          {Number(t.hours.toFixed(2))} h
                        </TD>
                        <TD align="right" mono>
                          {d.rate ? formatMoney(d.rate) : "—"}
                        </TD>
                        <TD align="right" mono>
                          {formatMoney(t.exVat)}
                        </TD>
                        <TD align="right" mono>
                          {formatMoney(t.total)}
                        </TD>
                        <TD>
                          <Pill
                            tone={
                              s.state === "ready" ? "good" : s.state === "done" ? "mute" : "warn"
                            }
                          >
                            {s.text}
                          </Pill>
                        </TD>
                        <TD align="right">
                          <div onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="outline" onClick={() => setOpen(d)}>
                              Review
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
            {pages > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
                <span>
                  Page {page} of {pages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="size-4" /> Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  >
                    Next <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <DraftPreviewDialog
        draft={open}
        busy={busy}
        canCreate={canCreate}
        onClose={() => setOpen(null)}
        onCreate={(d, allow) => void create([d.clientId], allow)}
      />
      <LinkClientDialog
        item={linking}
        onClose={() => setLinking(null)}
        onLinked={() => void refresh()}
      />
      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Create ${picked.size} invoice${picked.size === 1 ? "" : "s"}?`}
        description="Each one is created from its draft with the next invoice number. You can still edit or delete an invoice on the Invoices screen afterwards."
        confirmLabel="Create invoices"
        onConfirm={() => void create([...picked], false)}
      />
    </div>
  );
}
