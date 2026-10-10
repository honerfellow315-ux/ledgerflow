import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, Info, Search, Upload } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/app/timesheets/badges";
import { MatchDialog } from "@/components/app/bankMatch/MatchDialog";
import { formatDate, formatMoney } from "@/lib/ledger/calc";
import { buildLines, invoiceById, type BankLine, type LineStatus } from "@/lib/bankMatch/data";

export const Route = createFileRoute("/bank-match/")({
  head: () => ({
    meta: [
      { title: "Bank Match — LedgerFlow" },
      { name: "description", content: "Match the payments on your bank statement to your invoices." },
    ],
  }),
  component: BankMatchPage,
});

function BankMatchPage() {
  // Admin-only while this is a preview, same pattern as the other new screens.
  return (
    <RequireView module="dashboard">
      <BankMatchContent />
    </RequireView>
  );
}

const ORIGINAL = buildLines();

const STATUS: Record<LineStatus, { label: string; tone: "good" | "warn" | "bad" | "mute" }> = {
  matched: { label: "Matched", tone: "good" },
  review: { label: "Needs a look", tone: "warn" },
  none: { label: "No match", tone: "bad" },
  confirmed: { label: "Confirmed", tone: "good" },
  ignored: { label: "Ignored", tone: "mute" },
};

const PENDING_FIRST: Record<LineStatus, number> = { review: 0, none: 1, matched: 2, confirmed: 3, ignored: 4 };

function BankMatchContent() {
  const { isAdmin, ready } = usePermissions();
  const [lines, setLines] = useState<BankLine[]>(() => buildLines());
  const [status, setStatus] = useState<LineStatus | null>(null);
  const [q, setQ] = useState("");
  const [choosing, setChoosing] = useState<BankLine | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines
      .filter((l) => (status ? l.status === status : true))
      .filter((l) => (needle ? l.description.toLowerCase().includes(needle) : true))
      .sort((a, b) => PENDING_FIRST[a.status] - PENDING_FIRST[b.status] || b.date.localeCompare(a.date));
  }, [lines, status, q]);

  if (!ready) return null;
  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState title="You don't have access to this" description="Only administrators can open Bank Match for now." />
      </Panel>
    );
  }

  const set = (id: string, patch: Partial<BankLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const undo = (id: string) => {
    const o = ORIGINAL.find((l) => l.id === id);
    if (!o) return;
    set(id, o.status === "confirmed" || o.status === "ignored" ? { status: "none", invoiceId: null, reason: "No match yet." } : { ...o });
  };
  const count = (s: LineStatus) => lines.filter((l) => l.status === s).length;
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const autoCount = count("matched");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Bank Match</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your bank statement and match the payments you received to your invoices.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={autoCount === 0}
            onClick={() => {
              setLines((prev) => prev.map((l) => (l.status === "matched" ? { ...l, status: "confirmed" } : l)));
              toast.success("Preview only: nothing was recorded as a payment.");
            }}
          >
            <Check className="size-4" /> Confirm all matched{autoCount ? ` (${autoCount})` : ""}
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Upload bank statement
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="sr-only"
            aria-label="Choose a bank statement file"
            onChange={(e) => {
              if (e.target.files?.length) toast.info("Preview only: reading the statement is connected in the next phase.");
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div
        role="note"
        className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-[13px] text-foreground"
      >
        <Info className="mt-0.5 size-4 text-primary" aria-hidden="true" />
        <p>This is a preview with sample bank lines and invoices. Nothing here is saved or recorded.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Payments in" value={formatMoney(total)} sublabel={`${lines.length} lines`} />
        <SummaryCard
          label="Matched"
          value={String(autoCount)}
          sublabel="Ready to confirm"
          icon={CheckCircle2}
          tone="success"
          active={status === "matched"}
          onClick={() => setStatus(status === "matched" ? null : "matched")}
        />
        <SummaryCard
          label="Need a look"
          value={String(count("review"))}
          sublabel="Pick the right invoice"
          icon={AlertTriangle}
          tone={count("review") ? "warning" : "success"}
          active={status === "review"}
          onClick={() => setStatus(status === "review" ? null : "review")}
        />
        <SummaryCard
          label="No match"
          value={String(count("none"))}
          sublabel="Choose or ignore"
          tone={count("none") ? "danger" : "success"}
          active={status === "none"}
          onClick={() => setStatus(status === "none" ? null : "none")}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Bank lines"
          description={`${rows.length} of ${lines.length} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the bank text" className="h-9 w-52 pl-8" />
              </div>
              {status || q ? (
                <Button size="sm" variant="outline" onClick={() => { setStatus(null); setQ(""); }}>
                  Clear
                </Button>
              ) : null}
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="No bank lines here" description="Change the filter or upload a statement." />
        ) : (
          <TableWrap>
            <Table className="min-w-[980px]">
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Bank text</TH>
                  <TH align="right">Amount</TH>
                  <TH>Matched to</TH>
                  <TH>Status</TH>
                  <TH align="right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((l) => {
                  const inv = invoiceById(l.invoiceId);
                  const s = STATUS[l.status];
                  return (
                    <TR key={l.id}>
                      <TD>{formatDate(l.date)}</TD>
                      <TD className="max-w-[260px]">
                        <span className="line-clamp-2 font-medium">{l.description}</span>
                      </TD>
                      <TD align="right" mono>
                        {formatMoney(l.amount)}
                      </TD>
                      <TD className="max-w-[300px]">
                        {inv ? (
                          <>
                            <span className="font-medium">
                              {inv.number}, {inv.client}
                            </span>
                            <span className="block text-xs text-muted-foreground">{l.reason}</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">{l.reason}</span>
                        )}
                      </TD>
                      <TD>
                        <Pill tone={s.tone}>{s.label}</Pill>
                      </TD>
                      <TD align="right">
                        <div className="flex justify-end gap-2">
                          {l.status === "matched" ? (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setChoosing(l)}>
                                Change
                              </Button>
                              <Button size="sm" onClick={() => set(l.id, { status: "confirmed" })}>
                                Confirm
                              </Button>
                            </>
                          ) : null}
                          {l.status === "review" ? (
                            <Button size="sm" onClick={() => setChoosing(l)}>
                              Choose invoice
                            </Button>
                          ) : null}
                          {l.status === "none" ? (
                            <>
                              <Button size="sm" variant="outline" onClick={() => set(l.id, { status: "ignored", reason: "Ignored by you." })}>
                                Ignore
                              </Button>
                              <Button size="sm" onClick={() => setChoosing(l)}>
                                Choose invoice
                              </Button>
                            </>
                          ) : null}
                          {l.status === "confirmed" || l.status === "ignored" ? (
                            <Button size="sm" variant="outline" onClick={() => undo(l.id)}>
                              Undo
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

      <MatchDialog
        line={choosing}
        onClose={() => setChoosing(null)}
        onChoose={(id, invoiceId) => {
          set(id, { status: "confirmed", invoiceId, reason: "Matched by you." });
          setChoosing(null);
        }}
      />
    </div>
  );
}
