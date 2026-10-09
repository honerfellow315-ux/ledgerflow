import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FilePlus, Info, Search } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/app/timesheets/badges";
import { DraftPreviewDialog } from "@/components/app/invoiceDrafts/DraftPreviewDialog";
import { formatMoney } from "@/lib/ledger/calc";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { buildDrafts, draftMonths, draftState, draftTotals, type Draft } from "@/lib/invoiceDrafts/data";

export const Route = createFileRoute("/invoice-drafts/")({
  head: () => ({
    meta: [
      { title: "Invoice Drafts — LedgerFlow" },
      { name: "description", content: "Invoices prepared from the month's shifts, ready to check and create." },
    ],
  }),
  component: InvoiceDraftsPage,
});

function InvoiceDraftsPage() {
  // Admin-only while this is a preview, same pattern as the other new screens.
  return (
    <RequireView module="dashboard">
      <InvoiceDraftsContent />
    </RequireView>
  );
}

const MONTHS = draftMonths();

function InvoiceDraftsContent() {
  const { isAdmin, ready } = usePermissions();
  const [month, setMonth] = useState(MONTHS[1] ?? MONTHS[0]!);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Draft | null>(null);

  const all = useMemo(() => buildDrafts(month), [month]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((d) => d.client.toLowerCase().includes(needle)) : all;
  }, [all, q]);

  if (!ready) return null;
  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState title="You don't have access to this" description="Only administrators can open Invoice Drafts for now." />
      </Panel>
    );
  }

  const ready_ = all.filter((d) => draftState(d).state === "ready");
  const check = all.filter((d) => draftState(d).state === "check");
  const readyTotal = ready_.reduce((a, d) => a + draftTotals(d).exVat, 0);
  const pickable = rows.filter((d) => draftState(d).state === "ready");
  const allPicked = pickable.length > 0 && pickable.every((d) => picked.has(d.id));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Invoice Drafts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invoices prepared from the month's shifts. Check each one, then create it.
          </p>
        </div>
        <Button
          disabled={picked.size === 0}
          onClick={() => {
            toast.info("Preview only: creating invoices is connected in the next phase.");
            setPicked(new Set());
          }}
        >
          <FilePlus className="size-4" /> Create selected{picked.size ? ` (${picked.size})` : ""}
        </Button>
      </div>

      <div
        role="note"
        className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-[13px] text-foreground"
      >
        <Info className="mt-0.5 size-4 text-primary" aria-hidden="true" />
        <p>This is a preview with sample clients and shifts. Nothing here is saved or created.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Drafts" value={String(all.length)} sublabel={formatMonthLabel(month)} icon={FilePlus} />
        <SummaryCard label="Ready" value={String(ready_.length)} sublabel="Nothing to fix" icon={CheckCircle2} tone="success" />
        <SummaryCard
          label="Need a look"
          value={String(check.length)}
          sublabel={check.length ? "Check before creating" : "All clear"}
          icon={AlertTriangle}
          tone={check.length ? "warning" : "success"}
        />
        <SummaryCard label="Ready to bill, ex VAT" value={formatMoney(readyTotal)} />
      </div>

      <Panel>
        <PanelHeader
          title="Clients"
          description={`${rows.length} of ${all.length} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={month} onValueChange={(v) => { setMonth(v); setPicked(new Set()); }}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {formatMonthLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="h-9 w-44 pl-8" />
              </div>
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="No clients found" description="Try another name or month." />
        ) : (
          <TableWrap>
            <Table className="min-w-[960px]">
              <THead>
                <TR>
                  <TH>
                    <Checkbox
                      aria-label="Select all ready drafts"
                      checked={allPicked}
                      onCheckedChange={(v) => setPicked(v === true ? new Set(pickable.map((d) => d.id)) : new Set())}
                    />
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
                          <Checkbox
                            aria-label={`Select ${d.client}`}
                            disabled={s.state !== "ready"}
                            checked={picked.has(d.id)}
                            onCheckedChange={() => toggle(d.id)}
                          />
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
                        <Pill tone={s.state === "ready" ? "good" : s.state === "done" ? "mute" : "warn"}>{s.text}</Pill>
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
        )}
      </Panel>

      <DraftPreviewDialog draft={open} onClose={() => setOpen(null)} />
    </div>
  );
}
