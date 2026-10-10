import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Clock, Download, Info, Search } from "@/lib/icons";
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
  ageTone,
  type FollowUpInput,
} from "@/components/app/followUps/FollowUpDialogs";
import { formatDate, formatMoney } from "@/lib/ledger/calc";
import {
  BUCKETS,
  bucketTotals,
  buildClients,
  clientTotals,
  followState,
  type OverdueClient,
} from "@/lib/followUps/data";

export const Route = createFileRoute("/follow-ups/")({
  head: () => ({
    meta: [
      { title: "Overdue Follow-ups — LedgerFlow" },
      { name: "description", content: "Keep track of who is overdue, every chase, and every promise to pay." },
    ],
  }),
  component: FollowUpsPage,
});

function FollowUpsPage() {
  // Admin-only while this is a preview, same pattern as the other new screens.
  return (
    <RequireView module="dashboard">
      <FollowUpsContent />
    </RequireView>
  );
}

type Filter = "due" | "promised" | "never" | null;

const URGENCY = { overdue: 0, today: 1, none: 2, later: 3 } as const;

function FollowUpsContent() {
  const { isAdmin, ready } = usePermissions();
  const [clients, setClients] = useState<OverdueClient[]>(() => buildClients());
  const [filter, setFilter] = useState<Filter>(null);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [logging, setLogging] = useState<OverdueClient | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients
      .filter((c) => {
        if (filter === "due") return followState(c) === "overdue" || followState(c) === "today";
        if (filter === "promised") return c.promisedDate !== null;
        if (filter === "never") return c.contacts.length === 0;
        return true;
      })
      .filter((c) => (needle ? c.client.toLowerCase().includes(needle) : true))
      .sort(
        (a, b) =>
          URGENCY[followState(a)] - URGENCY[followState(b)] || clientTotals(b).overdue - clientTotals(a).overdue,
      );
  }, [clients, filter, q]);

  if (!ready) return null;
  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState title="You don't have access to this" description="Only administrators can open Overdue Follow-ups for now." />
      </Panel>
    );
  }

  const total = clients.reduce((a, c) => a + clientTotals(c).overdue, 0);
  const buckets = bucketTotals(clients);
  const bucketMax = Math.max(1, ...buckets);
  const dueCount = clients.filter((c) => followState(c) === "overdue" || followState(c) === "today").length;
  const promised = clients.filter((c) => c.promisedDate !== null).length;
  const never = clients.filter((c) => c.contacts.length === 0).length;
  const detailClient = clients.find((c) => c.id === detail) ?? null;
  const previewStatement = () => toast.info("Preview only: the statement download is connected in the next phase.");

  const save = (id: string, input: FollowUpInput) => {
    setClients((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              nextFollowUp: input.nextFollowUp,
              promisedDate: input.promisedDate ?? c.promisedDate,
              contacts: [
                ...c.contacts,
                { id: `n${Date.now()}`, at: new Date().toISOString(), method: input.method, note: input.note, by: "Admin" },
              ],
            }
          : c,
      ),
    );
    setLogging(null);
    toast.success("Follow-up logged. This is a preview, so it is not saved.");
  };

  const card = (label: string, value: number, sub: string, key: Exclude<Filter, null>, tone: "warning" | "success" | "danger" | "default") => (
    <SummaryCard
      label={label}
      value={String(value)}
      sublabel={sub}
      tone={tone}
      active={filter === key}
      onClick={() => setFilter(filter === key ? null : key)}
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Overdue Follow-ups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See who is overdue, note every chase, and keep track of every promise to pay.
          </p>
        </div>
        <Button variant="outline" onClick={previewStatement}>
          <Download className="size-4" /> Download all statements
        </Button>
      </div>

      <div
        role="note"
        className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-[13px] text-foreground"
      >
        <Info className="mt-0.5 size-4 text-primary" aria-hidden="true" />
        <p>This is a preview with sample clients. Nothing here is saved, and no emails are sent.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total overdue" value={formatMoney(total)} sublabel={`${clients.length} clients`} icon={AlertTriangle} tone="danger" />
        {card("Follow-up due", dueCount, "Today or already late", "due", dueCount ? "warning" : "success")}
        {card("Promised to pay", promised, "Waiting for the date", "promised", "default")}
        {card("Never chased", never, "No contact logged", "never", never ? "warning" : "success")}
      </div>

      <Panel>
        <PanelHeader title="How late is the money?" description="Overdue amount by age" />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {BUCKETS.map((b, i) => (
            <div key={b.label} className="rounded-lg border border-border px-3 py-2.5">
              <p className="text-xs text-muted-foreground">{b.label}</p>
              <p className="num mt-0.5 text-base font-semibold text-foreground">{formatMoney(buckets[i] ?? 0)}</p>
              <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden="true">
                <div
                  className={i >= 2 ? "h-1.5 rounded-full bg-destructive" : "h-1.5 rounded-full bg-warning"}
                  style={{ width: `${Math.round(((buckets[i] ?? 0) / bucketMax) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Clients"
          description={`${rows.length} of ${clients.length} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="h-9 w-44 pl-8" />
              </div>
              {filter || q ? (
                <Button size="sm" variant="outline" onClick={() => { setFilter(null); setQ(""); }}>
                  Clear
                </Button>
              ) : null}
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="No clients here" description="Change the filter or search." />
        ) : (
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
                {rows.map((c) => {
                  const t = clientTotals(c);
                  const fs = followState(c);
                  return (
                    <TR key={c.id} onClick={() => setDetail(c.id)}>
                      <TD className="font-medium">{c.client}</TD>
                      <TD align="right" mono>
                        {formatMoney(t.overdue)}
                      </TD>
                      <TD>
                        <Pill tone={ageTone(t.oldest)}>{t.oldest} days</Pill>
                      </TD>
                      <TD className="max-w-[260px]">
                        {t.lastContact ? (
                          <>
                            <span className="text-[13px]">
                              {t.lastContact.method}, {formatDate(t.lastContact.at.slice(0, 10))}
                            </span>
                            <span className="line-clamp-1 block text-xs text-muted-foreground">{t.lastContact.note}</span>
                          </>
                        ) : (
                          <Pill tone="bad">Never chased</Pill>
                        )}
                      </TD>
                      <TD>
                        {fs === "none" ? (
                          <span className="text-xs text-muted-foreground">Not set</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            {formatDate(c.nextFollowUp ?? "")}
                            {fs === "overdue" ? <Pill tone="bad">Late</Pill> : null}
                            {fs === "today" ? <Pill tone="warn">Today</Pill> : null}
                          </span>
                        )}
                      </TD>
                      <TD>
                        {c.promisedDate ? (
                          <span className="flex items-center gap-1.5">
                            <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            {formatDate(c.promisedDate)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </TD>
                      <TD align="right">
                        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" aria-label={`Download statement for ${c.client}`} onClick={previewStatement}>
                            <Download className="size-3.5" />
                          </Button>
                          <Button size="sm" onClick={() => setLogging(c)}>
                            Log follow-up
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

      <ClientDetailDialog client={detailClient} onClose={() => setDetail(null)} onLog={(c) => setLogging(c)} />
      <LogFollowUpDialog client={logging} onClose={() => setLogging(null)} onSave={save} />
    </div>
  );
}
