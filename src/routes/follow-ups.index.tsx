import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Download, Search } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/app/timesheets/badges";
import {
  ClientDetailDialog,
  LogFollowUpDialog,
  type FollowUpInput,
} from "@/components/app/followUps/FollowUpDialogs";
import { listFollowUps, logFollowUp, type FollowFilter } from "@/lib/actions/followUps";
import { formatDate, formatMoney } from "@/lib/ledger/calc";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import { BUCKETS, ageTone, type OverdueClient } from "@/lib/followUps/data";

export const Route = createFileRoute("/follow-ups/")({
  head: () => ({
    meta: [
      { title: "Overdue Follow-ups — LedgerFlow" },
      {
        name: "description",
        content: "Keep track of who is overdue, every chase, and every promise to pay.",
      },
    ],
  }),
  component: FollowUpsPage,
});

function FollowUpsPage() {
  return (
    <RequireView module="followUps">
      <FollowUpsContent />
    </RequireView>
  );
}

const PAGE_SIZE = 50;

function FollowUpsContent() {
  const { can, ready } = usePermissions();
  const allowed = can("followUps", "view") && can("invoices", "view");
  const canLog = can("followUps", "create");
  const qc = useQueryClient();

  const [filter, setFilter] = useState<FollowFilter>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<OverdueClient | null>(null);
  const [logging, setLogging] = useState<OverdueClient | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const listQ = useQuery({
    queryKey: ["followUps", "list", filter, search, page],
    queryFn: () => unwrap(listFollowUps({ data: { filter, search, page, pageSize: PAGE_SIZE } })),
    enabled: ready && allowed,
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
          description="Overdue Follow-ups show invoice amounts, so you need Follow-ups and Invoices access."
        />
      </Panel>
    );
  }

  async function save(c: OverdueClient, input: FollowUpInput) {
    if (busy) return;
    setBusy(true);
    try {
      await unwrap(logFollowUp({ data: { clientId: c.id, ...input } }));
      toast.success("Follow-up saved.");
      setLogging(null);
      await qc.invalidateQueries({ queryKey: ["followUps"] });
    } catch (err) {
      toast.error(errorMessage(err, "The follow-up could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const bucketMax = Math.max(1, ...(sum?.buckets ?? [0]));
  const pick = (key: Exclude<FollowFilter, "all">) => {
    setFilter(filter === key ? "all" : key);
    setPage(1);
  };
  const card = (
    label: string,
    value: number,
    sub: string,
    key: Exclude<FollowFilter, "all">,
    tone: "warning" | "success" | "danger" | "default",
  ) => (
    <SummaryCard
      label={label}
      value={String(value)}
      sublabel={sub}
      tone={tone}
      active={filter === key}
      onClick={() => pick(key)}
    />
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Overdue Follow-ups</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See who is overdue, note every chase, and keep track of every promise to pay. Nothing is
          emailed from here.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Total overdue"
          value={formatMoney(sum?.overdue ?? 0)}
          sublabel={`${sum?.clients ?? 0} clients`}
          icon={AlertTriangle}
          tone="danger"
        />
        {card(
          "Follow-up due",
          sum?.due ?? 0,
          "Today or already late",
          "due",
          sum?.due ? "warning" : "success",
        )}
        {card("Promised to pay", sum?.promised ?? 0, "Waiting for the date", "promised", "default")}
        {card(
          "Never chased",
          sum?.never ?? 0,
          "No contact logged",
          "never",
          sum?.never ? "warning" : "success",
        )}
      </div>

      <Panel>
        <PanelHeader title="How late is the money?" description="Overdue amount by age" />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {BUCKETS.map((b, i) => (
            <div key={b.label} className="rounded-lg border border-border px-3 py-2.5">
              <p className="text-xs text-muted-foreground">{b.label}</p>
              <p className="num mt-0.5 text-base font-semibold text-foreground">
                {formatMoney(sum?.buckets[i] ?? 0)}
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden="true">
                <div
                  className={
                    i >= 2 ? "h-1.5 rounded-full bg-destructive" : "h-1.5 rounded-full bg-warning"
                  }
                  style={{ width: `${Math.round(((sum?.buckets[i] ?? 0) / bucketMax) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Clients"
          description={`${total} of ${sum?.clients ?? 0} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search clients"
                  className="h-9 w-44 pl-8"
                />
              </div>
              {filter !== "all" || q ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFilter("all");
                    setQ("");
                    setPage(1);
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          }
        />
        {listQ.isLoading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : listQ.isError ? (
          <EmptyState
            title="The list could not be loaded"
            description={errorMessage(listQ.error, "Please try again.")}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={(sum?.clients ?? 0) === 0 ? "Nothing is overdue" : "No clients here"}
            description={
              (sum?.clients ?? 0) === 0
                ? "Every invoice is paid or not yet due."
                : "Change the filter or search."
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table className="min-w-[1020px]">
                <THead>
                  <TR>
                    <TH>Client</TH>
                    <TH align="right">Overdue</TH>
                    <TH>Oldest</TH>
                    <TH>Last contact</TH>
                    <TH>Follow up</TH>
                    <TH>Promised</TH>
                    <TH align="right">Action</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((c) => (
                    <TR key={c.id} onClick={() => setDetail(c)}>
                      <TD className="font-medium">{c.client}</TD>
                      <TD align="right" mono>
                        {formatMoney(c.overdue)}
                      </TD>
                      <TD>
                        <Pill tone={ageTone(c.oldest)}>{c.oldest} days</Pill>
                      </TD>
                      <TD className="max-w-[260px]">
                        {c.lastContact ? (
                          <>
                            <span className="text-[13px]">
                              {c.lastContact.method}, {formatDate(c.lastContact.at.slice(0, 10))}
                            </span>
                            <span className="line-clamp-1 block text-xs text-muted-foreground">
                              {c.lastContact.note}
                            </span>
                          </>
                        ) : (
                          <Pill tone="bad">Never chased</Pill>
                        )}
                      </TD>
                      <TD>
                        {c.state === "none" ? (
                          <span className="text-xs text-muted-foreground">Not set</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            {formatDate(c.nextFollowUp ?? "")}
                            {c.state === "overdue" ? <Pill tone="bad">Late</Pill> : null}
                            {c.state === "today" ? <Pill tone="warn">Today</Pill> : null}
                          </span>
                        )}
                      </TD>
                      <TD>
                        {c.promisedDate ? (
                          <span className="flex items-center gap-1.5">
                            <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            {formatDate(c.promisedDate)}
                            {c.promiseMissed ? <Pill tone="bad">Missed</Pill> : null}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </TD>
                      <TD align="right">
                        <div
                          className="flex justify-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button size="sm" variant="outline" asChild>
                            <Link
                              to="/statements"
                              search={{ client: c.id }}
                              aria-label={`Open statement for ${c.client}`}
                            >
                              <Download className="size-3.5" />
                            </Link>
                          </Button>
                          {canLog ? (
                            <Button size="sm" onClick={() => setLogging(c)}>
                              Log follow-up
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  ))}
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

      <ClientDetailDialog
        client={detail}
        canLog={canLog}
        onClose={() => setDetail(null)}
        onLog={(c) => setLogging(c)}
      />
      <LogFollowUpDialog
        client={logging}
        busy={busy}
        onClose={() => setLogging(null)}
        onSave={(id, input) => {
          const c = logging;
          if (c && c.id === id) void save(c, input);
        }}
      />
    </div>
  );
}
