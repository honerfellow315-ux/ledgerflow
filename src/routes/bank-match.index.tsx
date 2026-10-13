import { AiDocumentDialog } from "@/components/app/AiDocumentDialog";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Trash2,
  Upload,
} from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pill } from "@/components/app/timesheets/badges";
import { MatchDialog } from "@/components/app/bankMatch/MatchDialog";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import {
  confirmLine,
  confirmMatched,
  deleteBankStatement,
  ignoreBankLine,
  listBank,
  undoBankLine,
  uploadStatement,
  type BankFilter,
} from "@/lib/actions/bankMatch";
import { formatDate, formatMoney } from "@/lib/ledger/calc";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import { StatementReview } from "@/components/app/bankMatch/StatementReview";
import { parseBankFile, type ParsedStatement } from "@/lib/bankMatch/parse";
import type { BankLine, LineStatus } from "@/lib/bankMatch/data";

export const Route = createFileRoute("/bank-match/")({
  head: () => ({
    meta: [
      { title: "Bank Match — LedgerFlow" },
      {
        name: "description",
        content: "Match the payments on your bank statement to your invoices.",
      },
    ],
  }),
  component: BankMatchPage,
});

function BankMatchPage() {
  return (
    <RequireView module="payments">
      <BankMatchContent />
    </RequireView>
  );
}

const PAGE_SIZE = 50;

const STATUS: Record<LineStatus, { label: string; tone: "good" | "warn" | "bad" | "mute" }> = {
  matched: { label: "Matched", tone: "good" },
  review: { label: "Needs a look", tone: "warn" },
  none: { label: "No match", tone: "bad" },
  confirmed: { label: "Recorded", tone: "good" },
  ignored: { label: "Ignored", tone: "mute" },
};

function BankMatchContent() {
  const { can, ready } = usePermissions();
  const allowed = can("payments", "view") && can("invoices", "view");
  const canWrite = can("payments", "create");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [filter, setFilter] = useState<BankFilter>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [choosing, setChoosing] = useState<BankLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<{ file: string; list: string[] } | null>(null);
  const [pendingStatement, setPendingStatement] = useState<ParsedStatement | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const listQ = useQuery({
    queryKey: ["bankMatch", "list", filter, search, page],
    queryFn: () => unwrap(listBank({ data: { filter, search, page, pageSize: PAGE_SIZE } })),
    enabled: ready && allowed,
    placeholderData: keepPreviousData,
  });
  const data = listQ.data;
  const rows = data?.rows ?? [];
  const counts = data?.counts;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const refresh = () => qc.invalidateQueries({ queryKey: ["bankMatch"] });
  // Recording a payment also changes invoices, payments, statements and follow-ups.
  const refreshAll = async () => {
    await Promise.all([
      refresh(),
      qc.invalidateQueries({ queryKey: ["followUps"] }),
      qc.invalidateQueries({ queryKey: ["invoices"] }),
      qc.invalidateQueries({ queryKey: ["payments"] }),
    ]);
  };

  if (!ready) return null;
  if (!allowed) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Bank Match shows invoice amounts and records payments, so you need Payments and Invoices access."
        />
      </Panel>
    );
  }

  async function run<T>(fn: () => Promise<T>, fallback: string): Promise<T | null> {
    if (busy) return null;
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      toast.error(errorMessage(err, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    await run(async () => {
      const parsed = await parseBankFile(file);
      if (parsed.problems.length > 0) {
        setProblems({ file: file.name, list: parsed.problems.slice(0, 8) });
        return;
      }
      if (parsed.lines.length === 0) {
        setProblems({ file: file.name, list: ["No money-in payments were found in this file."] });
        return;
      }
      if (/\.(pdf|docx)$/i.test(file.name)) {
        setPendingStatement(parsed);
        return;
      }
      await saveStatement(parsed);
    }, "The statement could not be uploaded.");
  }

  async function saveStatement(parsed: ParsedStatement) {
    const res = await unwrap(
      uploadStatement({
        data: {
          fileName: parsed.fileName,
          fileHash: parsed.fileHash,
          skippedOut: parsed.skippedOut,
          lines: parsed.lines,
        },
      }),
    );
    toast.success(
      `${res.added} new payment${res.added === 1 ? "" : "s"} added${res.alreadyThere ? `, ${res.alreadyThere} already uploaded before` : ""}. Money going out (${parsed.skippedOut}) was skipped.`,
    );
    setFilter("all");
    setPage(1);
    await refresh();
    setPendingStatement(null);
  }

  async function confirm(line: BankLine, invoiceId: string, recordAnyway: boolean) {
    await run(async () => {
      const r = await unwrap(confirmLine({ data: { lineId: line.id, invoiceId, recordAnyway } }));
      if (!r.ok) {
        toast.error(r.reason);
        if (!r.needsTick) await refresh();
        return;
      }
      toast.success("Payment recorded.");
      setChoosing(null);
      await refreshAll();
    }, "The payment could not be recorded.");
  }

  async function confirmAll() {
    setBulkOpen(false);
    await run(async () => {
      const ids = (
        await unwrap(listBank({ data: { filter: "matched", search: "", page: 1, pageSize: 100 } }))
      ).rows.map((r) => r.id);
      if (ids.length === 0) return;
      const res = await unwrap(confirmMatched({ data: { lineIds: ids } }));
      if (res.skipped.length > 0) {
        toast.warning(
          `${res.confirmed} recorded. ${res.skipped.length} left for you to check: ${res.skipped[0]!.reason}`,
        );
      } else toast.success(`${res.confirmed} payment${res.confirmed === 1 ? "" : "s"} recorded.`);
      await refreshAll();
    }, "The payments could not be recorded.");
  }

  const matchedN = counts?.matched ?? 0;
  const pick = (s: BankFilter) => {
    setFilter(filter === s ? "all" : s);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <AiDocumentDialog
        kind="bank"
        open={aiOpen}
        onOpenChange={setAiOpen}
        onReviewed={async (doc) => {
          if (doc.kind === "bank") await saveStatement(doc.parsed);
        }}
      />
      {pendingStatement ? (
        <StatementReview
          key={pendingStatement.fileHash}
          statement={pendingStatement}
          busy={busy}
          onCancel={() => setPendingStatement(null)}
          onConfirm={() =>
            void run(
              () => saveStatement(pendingStatement),
              "The reviewed statement could not be uploaded.",
            )
          }
        />
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Bank Match</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your bank statement (CSV, Excel, typed PDF or Word table). Photos and scans will
            be supported in the AI step. Payments you received are matched to your open invoices,
            and recorded as a payment only when you confirm.
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={busy || matchedN === 0}
              onClick={() => setBulkOpen(true)}
            >
              <Check className="size-4" /> Confirm all matched{matchedN ? ` (${matchedN})` : ""}
            </Button>
            <Button variant="outline" asChild>
              <a href="/samples/ess-bank-statement-sample.xlsx" download>
                <Download className="size-4" /> ESS sample format
              </a>
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setAiOpen(true)}>
              Read photo / scanned PDF with AI
            </Button>
            <Button disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Upload bank statement
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.pdf,.docx"
              className="sr-only"
              aria-label="Choose a bank statement file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onFile(f);
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Payments waiting"
          value={formatMoney(data?.waitingTotal ?? 0)}
          sublabel="Not yet recorded or ignored"
        />
        <SummaryCard
          label="Matched"
          value={String(matchedN)}
          sublabel="Ready to confirm"
          icon={CheckCircle2}
          tone="success"
          active={filter === "matched"}
          onClick={() => pick("matched")}
        />
        <SummaryCard
          label="Need a look"
          value={String(counts?.review ?? 0)}
          sublabel="Pick the right invoice"
          icon={AlertTriangle}
          tone={counts?.review ? "warning" : "success"}
          active={filter === "review"}
          onClick={() => pick("review")}
        />
        <SummaryCard
          label="No match"
          value={String(counts?.none ?? 0)}
          sublabel="Choose or ignore"
          tone={counts?.none ? "danger" : "success"}
          active={filter === "none"}
          onClick={() => pick("none")}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Bank lines"
          description={`${total} shown. Recorded ${counts?.confirmed ?? 0}, ignored ${counts?.ignored ?? 0}.`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search the bank text"
                  className="h-9 w-52 pl-8"
                />
              </div>
              {(["confirmed", "ignored"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={filter === s ? "default" : "outline"}
                  onClick={() => pick(s)}
                >
                  {STATUS[s].label}
                </Button>
              ))}
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
        {listQ.isError ? (
          <EmptyState
            title="The bank lines could not be loaded"
            description={errorMessage(listQ.error, "Try again in a moment.")}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={listQ.isLoading ? "Loading..." : "No bank lines here"}
            description={listQ.isLoading ? "" : "Change the filter or upload a statement."}
          />
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
                  const inv = l.invoiceId ? data?.labels[l.invoiceId] : undefined;
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
                        {canWrite ? (
                          <div className="flex justify-end gap-2">
                            {l.status === "matched" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => setChoosing(l)}
                                >
                                  Change
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={busy || !l.invoiceId}
                                  onClick={() => confirm(l, l.invoiceId!, false)}
                                >
                                  Confirm
                                </Button>
                              </>
                            ) : null}
                            {l.status === "review" ? (
                              <Button size="sm" disabled={busy} onClick={() => setChoosing(l)}>
                                Choose invoice
                              </Button>
                            ) : null}
                            {l.status === "none" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    run(async () => {
                                      await unwrap(ignoreBankLine({ data: { lineId: l.id } }));
                                      await refresh();
                                    }, "The line could not be ignored.")
                                  }
                                >
                                  Ignore
                                </Button>
                                <Button size="sm" disabled={busy} onClick={() => setChoosing(l)}>
                                  Choose invoice
                                </Button>
                              </>
                            ) : null}
                            {l.status === "confirmed" || l.status === "ignored" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    await unwrap(undoBankLine({ data: { lineId: l.id } }));
                                    toast.success(
                                      l.status === "confirmed"
                                        ? "Payment removed. The line is waiting again."
                                        : "The line is waiting again.",
                                    );
                                    await refreshAll();
                                  }, "This could not be undone.")
                                }
                              >
                                Undo
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
            <span>
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="size-4" /> Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      {data && data.statements.length > 0 ? (
        <Panel>
          <PanelHeader title="Uploaded statements" description="The latest 30 uploads" />
          <TableWrap>
            <Table className="min-w-[720px]">
              <THead>
                <TR>
                  <TH>File</TH>
                  <TH>Uploaded</TH>
                  <TH align="right">Payments in</TH>
                  <TH align="right">Recorded</TH>
                  <TH align="right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {data.statements.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium">{s.fileName}</TD>
                    <TD>
                      {formatDate(s.uploadedAt.slice(0, 10))}, {s.uploadedBy}
                    </TD>
                    <TD align="right" mono>
                      {s.lineCount}
                    </TD>
                    <TD align="right" mono>
                      {s.confirmed}
                    </TD>
                    <TD align="right">
                      {can("payments", "delete") ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || s.confirmed > 0}
                          title={
                            s.confirmed > 0
                              ? "Undo the recorded payments first"
                              : "Delete this upload"
                          }
                          onClick={() => setDeleting({ id: s.id, name: s.fileName })}
                        >
                          <Trash2 className="size-4" /> Delete
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Panel>
      ) : null}

      <MatchDialog
        line={choosing}
        busy={busy}
        onClose={() => setChoosing(null)}
        onChoose={(id, inv, any) => choosing && confirm(choosing, inv, any)}
      />

      <Dialog open={problems !== null} onOpenChange={(o) => (o ? undefined : setProblems(null))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>This statement was not uploaded</DialogTitle>
            <DialogDescription>
              {problems?.file}. Nothing was added, so no payment can go missing. Fix the file and
              upload it again.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-foreground">
            {problems?.list.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setProblems(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Record {matchedN} matched payment{matchedN === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              Each one becomes a Bank Transfer payment on its invoice. The server checks every line
              again first, and leaves out any that is no longer a sure match.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmAll}>Record payments</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => (o ? undefined : setDeleting(null))}
        title="Delete this upload?"
        description={`${deleting?.name ?? ""}: its waiting and ignored lines are removed. You can upload the file again later.`}
        confirmLabel="Delete"
        onConfirm={() => {
          const d = deleting;
          setDeleting(null);
          if (!d) return;
          void run(async () => {
            await unwrap(deleteBankStatement({ data: { id: d.id } }));
            toast.success("Upload deleted.");
            await refresh();
          }, "The upload could not be deleted.");
        }}
      />
    </div>
  );
}
