import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Banknote, Download, Info, TrendingUp, Users } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgeingBars, MarginBar, TrendBars } from "@/components/app/owner/OwnerParts";
import { getOwnerOverview } from "@/lib/actions/owner";
import { formatDate, formatMoney } from "@/lib/ledger/calc";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import { downloadOwnerSummary } from "@/lib/owner/summaryExport";
import {
  LOW_MARGIN,
  PERIODS,
  UNLINKED_ID,
  marginOf,
  marginPct,
  summaryLines,
  totals,
  type ClientRow,
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
  // Admin only: it shows what staff cost per client. The server checks this too (actions/owner.ts).
  return (
    <RequireView module="dashboard">
      <OwnerContent />
    </RequireView>
  );
}

type SortKey = "marginPct" | "margin" | "billed" | "outstanding";
const SORTS: { value: SortKey; label: string; monthOnly: boolean }[] = [
  { value: "marginPct", label: "Lowest margin %", monthOnly: true },
  { value: "margin", label: "Highest margin", monthOnly: true },
  { value: "billed", label: "Most billed", monthOnly: false },
  { value: "outstanding", label: "Most outstanding", monthOnly: false },
];

function OwnerContent() {
  const { isAdmin, ready } = usePermissions();
  const [period, setPeriod] = useState<Period>("this_week");
  const [sort, setSort] = useState<SortKey>("outstanding");
  const [downloading, setDownloading] = useState(false);

  const q = useQuery({
    queryKey: ["owner", "overview", period],
    queryFn: () => unwrap(getOwnerOverview({ data: { period } })),
    enabled: ready && isAdmin,
    placeholderData: keepPreviousData,
  });
  const data = q.data;
  const isMonth = data?.range.kind === "month";
  // A sort that needs a margin can't be used on a week.
  const activeSort: SortKey =
    !isMonth && (sort === "marginPct" || sort === "margin") ? "outstanding" : sort;

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const t = useMemo(() => totals(rows), [rows]);
  const lines = useMemo(
    () => (data ? summaryLines(data.range, rows, formatMoney) : []),
    [data, rows],
  );
  const sorted = useMemo(() => {
    const by: Record<SortKey, (r: ClientRow) => number> = {
      marginPct: (r) => marginPct(r) ?? 1000,
      margin: (r) => -marginOf(r),
      billed: (r) => -r.billed,
      outstanding: (r) => -r.outstanding,
    };
    const linked = rows.filter((r) => r.id !== UNLINKED_ID);
    const unlinked = rows.filter((r) => r.id === UNLINKED_ID);
    return [...linked.sort((a, b) => by[activeSort](a) - by[activeSort](b)), ...unlinked];
  }, [rows, activeSort]);

  if (!ready) return null;
  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Only administrators can open Owner Overview."
        />
      </Panel>
    );
  }

  async function download() {
    if (!data || downloading) return;
    setDownloading(true);
    try {
      await downloadOwnerSummary(data);
    } catch (err) {
      toast.error(errorMessage(err, "The summary could not be downloaded."));
    } finally {
      setDownloading(false);
    }
  }

  const switching = q.isFetching && q.isPlaceholderData;

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
            <Button
              key={p.value}
              size="sm"
              variant={period === p.value ? "default" : "outline"}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
          <Button variant="outline" onClick={download} disabled={!data || downloading || switching}>
            <Download className="size-4" /> {downloading ? "Preparing..." : "Download summary"}
          </Button>
        </div>
      </div>

      {q.isError && !data ? (
        <Panel>
          <EmptyState
            title="The overview could not be loaded"
            description={errorMessage(q.error, "Please try again in a moment.")}
          />
          <div className="flex justify-center pb-6">
            <Button variant="outline" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        </Panel>
      ) : !data ? (
        <Panel>
          <div className="p-8 text-center text-sm text-muted-foreground">
            Working out the numbers...
          </div>
        </Panel>
      ) : (
        <div
          className={switching ? "space-y-5 opacity-60 transition-opacity" : "space-y-5"}
          aria-busy={switching}
        >
          <p className="text-[13px] text-muted-foreground">
            {data.range.label}: {formatDate(data.range.from)} to {formatDate(data.range.to)}
            {data.range.inProgress ? " (not over yet)" : ""}
          </p>

          {data.notes.length > 0 && (
            <div
              role="note"
              className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-foreground"
            >
              <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <ul className="space-y-1">
                {data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label={isMonth ? "Billed, ex VAT" : "Invoiced, ex VAT"}
              value={formatMoney(t.billed)}
              sublabel={`${t.hours} hours worked`}
              icon={Banknote}
            />
            <SummaryCard
              label="Staff cost"
              value={formatMoney(t.staffCost)}
              sublabel="What the shifts paid"
              icon={Users}
            />
            {isMonth ? (
              <SummaryCard
                label="Margin"
                value={t.billed > 0 ? formatMoney(t.margin) : "—"}
                sublabel={t.marginPct !== null ? `${t.marginPct}% of billed` : "Nothing billed yet"}
                icon={TrendingUp}
                tone={t.marginPct !== null && t.marginPct < LOW_MARGIN ? "warning" : "success"}
              />
            ) : (
              <SummaryCard
                label="Received"
                value={formatMoney(t.received)}
                sublabel="Cash in, VAT included"
                icon={TrendingUp}
                tone="success"
              />
            )}
            <SummaryCard
              label="Still to collect"
              value={formatMoney(t.outstanding)}
              sublabel={`${formatMoney(t.overdue)} overdue, right now`}
              icon={AlertTriangle}
              tone={t.overdue > 0 ? "danger" : "success"}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Panel className="lg:col-span-2">
              <PanelHeader
                title={isMonth ? "The month in short" : "The week in short"}
                description={data.range.label}
              />
              <ul className="space-y-2.5 p-4 text-[14px] leading-relaxed text-foreground">
                {lines.map((l) => (
                  <li key={l} className="flex gap-2.5">
                    <span
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                    {l}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel>
              <PanelHeader
                title="Money still to collect"
                description="By how late it is, right now"
              />
              <div className="p-4">
                <AgeingBars data={data.ageing} />
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHeader title="Billed and received" description="The last 6 months" />
            <div className="p-4">
              <TrendBars data={data.trend} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title={isMonth ? "Margin by client" : "By client"}
              description={
                isMonth
                  ? `Anything under ${LOW_MARGIN}% is marked`
                  : "Margin is shown for whole months"
              }
              actions={
                <Select value={activeSort} onValueChange={(v) => setSort(v as SortKey)}>
                  <SelectTrigger className="h-9 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORTS.filter((s) => isMonth || !s.monthOnly).map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            {rows.length === 0 ? (
              <EmptyState
                title="Nothing in this period"
                description="No invoices, payments or shifts were found for these dates."
              />
            ) : (
              <TableWrap>
                <Table className="min-w-[1000px]">
                  <THead>
                    <TR>
                      <TH>Client</TH>
                      <TH align="right">Hours</TH>
                      <TH align="right">{isMonth ? "Billed" : "Invoiced"}</TH>
                      <TH align="right">Staff cost</TH>
                      {isMonth && <TH align="right">Margin</TH>}
                      {isMonth && <TH align="right">Margin %</TH>}
                      <TH align="right">Received</TH>
                      <TH align="right">Outstanding</TH>
                      <TH align="right">Overdue</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {sorted.map((r) => {
                      const unlinked = r.id === UNLINKED_ID;
                      return (
                        <TR key={r.id}>
                          <TD className="font-medium">
                            {unlinked ? (
                              <span>
                                {r.client}{" "}
                                <Link
                                  to="/invoice-drafts"
                                  className="text-[12px] font-normal text-primary underline-offset-2 hover:underline"
                                >
                                  Link names
                                </Link>
                              </span>
                            ) : (
                              r.client
                            )}
                          </TD>
                          <TD align="right" mono>
                            {r.hours} h
                          </TD>
                          <TD align="right" mono>
                            {formatMoney(r.billed)}
                          </TD>
                          <TD align="right" mono>
                            {formatMoney(r.staffCost)}
                          </TD>
                          {isMonth && (
                            <TD align="right" mono>
                              {r.billed > 0 ? formatMoney(marginOf(r)) : "—"}
                            </TD>
                          )}
                          {isMonth && (
                            <TD align="right">
                              <MarginBar
                                pct={unlinked ? null : marginPct(r)}
                                empty={unlinked ? "" : r.staffCost > 0 ? "Not billed yet" : "—"}
                              />
                            </TD>
                          )}
                          <TD align="right" mono>
                            {formatMoney(r.received)}
                          </TD>
                          <TD align="right" mono>
                            {formatMoney(r.outstanding)}
                          </TD>
                          <TD align="right" mono>
                            {r.overdue > 0 ? (
                              <span className="font-medium text-destructive">
                                {formatMoney(r.overdue)}
                              </span>
                            ) : (
                              formatMoney(0)
                            )}
                          </TD>
                        </TR>
                      );
                    })}
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
                      {isMonth && (
                        <TD align="right" mono className="font-semibold">
                          {t.billed > 0 ? formatMoney(t.margin) : "—"}
                        </TD>
                      )}
                      {isMonth && (
                        <TD align="right">
                          <MarginBar pct={t.marginPct} empty="—" />
                        </TD>
                      )}
                      <TD align="right" mono className="font-semibold">
                        {formatMoney(t.received)}
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
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
