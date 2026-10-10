import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Banknote, Download, Info, TrendingUp, Users } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgeingBars, MarginBar, TrendBars } from "@/components/app/owner/OwnerParts";
import { formatMoney } from "@/lib/ledger/calc";
import {
  AGEING,
  LOW_MARGIN,
  PERIODS,
  marginOf,
  marginPct,
  rowsFor,
  summaryLines,
  totals,
  trend,
  type Period,
} from "@/lib/owner/data";

export const Route = createFileRoute("/owner/")({
  head: () => ({
    meta: [
      { title: "Owner Overview — LedgerFlow" },
      { name: "description", content: "Margin, money still to collect and the week in short." },
    ],
  }),
  component: OwnerPage,
});

function OwnerPage() {
  // Admin-only while this is a preview, same pattern as the other new screens.
  return (
    <RequireView module="dashboard">
      <OwnerContent />
    </RequireView>
  );
}

type SortKey = "marginPct" | "margin" | "billed" | "outstanding";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "marginPct", label: "Lowest margin %" },
  { value: "margin", label: "Highest margin" },
  { value: "billed", label: "Most billed" },
  { value: "outstanding", label: "Most outstanding" },
];

function OwnerContent() {
  const { isAdmin, ready } = usePermissions();
  const [period, setPeriod] = useState<Period>("this_week");
  const [sort, setSort] = useState<SortKey>("marginPct");

  const rows = useMemo(() => rowsFor(period), [period]);
  const t = useMemo(() => totals(rows), [rows]);
  const lines = useMemo(() => summaryLines(period, rows, formatMoney), [period, rows]);
  const months = useMemo(() => trend(), []);
  const sorted = useMemo(() => {
    const by: Record<SortKey, (r: (typeof rows)[number]) => number> = {
      marginPct: (r) => marginPct(r),
      margin: (r) => -marginOf(r),
      billed: (r) => -r.billed,
      outstanding: (r) => -r.outstanding,
    };
    return [...rows].sort((a, b) => by[sort](a) - by[sort](b));
  }, [rows, sort]);

  if (!ready) return null;
  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState title="You don't have access to this" description="Only administrators can open Owner Overview for now." />
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Owner Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Which clients make you money, who still owes you, and how the week went.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <Button key={p.value} size="sm" variant={period === p.value ? "default" : "outline"} onClick={() => setPeriod(p.value)}>
              {p.label}
            </Button>
          ))}
          <Button
            variant="outline"
            onClick={() => toast.info("Preview only: the summary download is connected in the next phase.")}
          >
            <Download className="size-4" /> Download summary
          </Button>
        </div>
      </div>

      <div
        role="note"
        className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-[13px] text-foreground"
      >
        <Info className="mt-0.5 size-4 text-primary" aria-hidden="true" />
        <p>This is a preview with sample clients and numbers. Nothing here is saved or sent.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Billed, ex VAT" value={formatMoney(t.billed)} sublabel={`${t.hours} hours`} icon={Banknote} />
        <SummaryCard label="Staff cost" value={formatMoney(t.staffCost)} icon={Users} />
        <SummaryCard
          label="Margin"
          value={formatMoney(t.margin)}
          sublabel={`${t.marginPct}% of billed`}
          icon={TrendingUp}
          tone={t.marginPct < LOW_MARGIN ? "warning" : "success"}
        />
        <SummaryCard
          label="Still to collect"
          value={formatMoney(t.outstanding)}
          sublabel={`${formatMoney(t.overdue)} overdue`}
          icon={AlertTriangle}
          tone={t.overdue > 0 ? "danger" : "success"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="The week in short" description={PERIODS.find((p) => p.value === period)?.label ?? ""} />
          <ul className="space-y-2.5 p-4 text-[14px] leading-relaxed text-foreground">
            {lines.map((l) => (
              <li key={l} className="flex gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                {l}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Money still to collect" description="By how late it is" />
          <div className="p-4">
            <AgeingBars data={AGEING} />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Billed and received" description="The last 6 months" />
        <div className="p-4">
          <TrendBars data={months} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Margin by client"
          description={`Anything under ${LOW_MARGIN}% is marked`}
          actions={
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <TableWrap>
          <Table className="min-w-[940px]">
            <THead>
              <TR>
                <TH>Client</TH>
                <TH align="right">Hours</TH>
                <TH align="right">Billed</TH>
                <TH align="right">Staff cost</TH>
                <TH align="right">Margin</TH>
                <TH align="right">Margin %</TH>
                <TH align="right">Outstanding</TH>
                <TH align="right">Overdue</TH>
              </TR>
            </THead>
            <TBody>
              {sorted.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.client}</TD>
                  <TD align="right" mono>
                    {r.hours} h
                  </TD>
                  <TD align="right" mono>
                    {formatMoney(r.billed)}
                  </TD>
                  <TD align="right" mono>
                    {formatMoney(r.staffCost)}
                  </TD>
                  <TD align="right" mono>
                    {formatMoney(marginOf(r))}
                  </TD>
                  <TD align="right">
                    <MarginBar pct={marginPct(r)} />
                  </TD>
                  <TD align="right" mono>
                    {formatMoney(r.outstanding)}
                  </TD>
                  <TD align="right" mono>
                    {r.overdue > 0 ? <span className="font-medium text-destructive">{formatMoney(r.overdue)}</span> : formatMoney(0)}
                  </TD>
                </TR>
              ))}
              <TR>
                <TD className="font-semibold">All clients</TD>
                <TD align="right" mono className="font-semibold">
                  {t.hours} h
                </TD>
                <TD align="right" mono className="font-semibold">
                  {formatMoney(t.billed)}
                </TD>
                <TD align="right" mono className="font-semibold">
                  {formatMoney(t.staffCost)}
                </TD>
                <TD align="right" mono className="font-semibold">
                  {formatMoney(t.margin)}
                </TD>
                <TD align="right">
                  <MarginBar pct={t.marginPct} />
                </TD>
                <TD align="right" mono className="font-semibold">
                  {formatMoney(t.outstanding)}
                </TD>
                <TD align="right" mono className="font-semibold">
                  {formatMoney(t.overdue)}
                </TD>
              </TR>
            </TBody>
          </Table>
        </TableWrap>
      </Panel>
    </div>
  );
}
