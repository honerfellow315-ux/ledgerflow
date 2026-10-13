import { printTimesheetReport } from "@/lib/timesheets/print";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ListChecks,
  RefreshCw,
  Search,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pill, SheetStatusBadge } from "@/components/app/timesheets/badges";
import { SheetCheckPanel } from "@/components/app/timesheets/SheetCheckPanel";
import { UploadTimesheetDialog } from "@/components/app/timesheets/TimesheetDialogs";
import { downloadTimesheetReport } from "@/lib/timesheets/reportExport";
import {
  confirmTimesheetStaff,
  deleteTimesheetSheet,
  getTimesheetReportPage,
  getTimesheetSheet,
  listTimesheetMonths,
  listTimesheetSheets,
  recheckTimesheetBatch,
  recheckTimesheetSheet,
  correctTimesheetIdentity,
  timesheetMonthLock,
  setTimesheetMonthLock,
} from "@/lib/actions/timesheets";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import {
  FORMAT_LABEL,
  fmtDateTime,
  fmtDiff,
  fmtHours,
  maskNi,
  type SheetStatus,
  type TimesheetSheet,
} from "@/lib/timesheets/data";

export const Route = createFileRoute("/timesheets/")({
  head: () => ({
    meta: [
      { title: "Timesheet Check — LedgerFlow" },
      {
        name: "description",
        content: "Check the hours staff send you against your own shift records.",
      },
    ],
  }),
  component: TimesheetsPage,
});

function TimesheetsPage() {
  // Admin-only for now, same pattern as the Activity Log: the real gate is isAdmin below
  // and requireAdmin() inside every server function.
  return (
    <RequireView module="dashboard">
      <TimesheetsPageContent />
    </RequireView>
  );
}

const ALL = "all";
const PAGE_SIZE = 25;
/** The Excel report is built from this many sheets at most, fetched 50 at a time. */
const REPORT_MAX_SHEETS = 1000;
const REPORT_STEP = 50;

function TimesheetsPageContent() {
  const { isAdmin, ready } = usePermissions();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [month, setMonth] = useState<string>("");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [progress, setProgress] = useState("");

  // Search is sent to the server a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const monthsQ = useQuery({
    queryKey: ["timesheets", "months"],
    queryFn: () => unwrap(listTimesheetMonths()),
    enabled: ready && isAdmin,
  });
  const months = monthsQ.data ?? [];
  const activeMonth = month || months[0]?.month || ALL;

  const filter = {
    month: activeMonth,
    search,
    status: status as SheetStatus | typeof ALL,
  };
  const listQ = useQuery({
    queryKey: ["timesheets", "list", filter, page],
    queryFn: () => unwrap(listTimesheetSheets({ data: { ...filter, page, pageSize: PAGE_SIZE } })),
    enabled: ready && isAdmin && !monthsQ.isLoading,
    placeholderData: keepPreviousData,
  });
  const list = listQ.data;

  const openQ = useQuery({
    queryKey: ["timesheets", "one", openId],
    queryFn: () => unwrap(getTimesheetSheet({ data: { id: openId ?? "" } })),
    enabled: ready && isAdmin && openId !== null,
  });

  const lockMonth = openQ.data?.month ?? activeMonth;
  const lockQ = useQuery({
    queryKey: ["timesheets", "lock", lockMonth],
    queryFn: () => unwrap(timesheetMonthLock({ data: { month: lockMonth } })),
    enabled: ready && isAdmin && lockMonth !== ALL,
    refetchInterval: 30_000,
  });
  const locked = lockQ.data?.locked ?? false;
  const lockUnknown = lockMonth !== ALL && (lockQ.isPending || lockQ.isError);
  const lockControl =
    lockMonth !== ALL ? (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-muted/40 px-4 py-3">
        <span className="text-sm">
          {lockQ.isError
            ? "Month lock could not be loaded. Check the required SQL migration."
            : lockQ.isPending
              ? "Loading month status…"
              : locked
                ? `${lockMonth} is locked${lockQ.data?.changedBy ? ` by ${lockQ.data.changedBy}` : ""}`
                : `${lockMonth} is open for checking`}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || lockUnknown}
          onClick={() =>
            void guarded(async () => {
              await unwrap(setTimesheetMonthLock({ data: { month: lockMonth, locked: !locked } }));
              await refresh();
              toast.success(locked ? "Month reopened." : "Month locked.");
            }, "Could not change the month lock. Every sheet must be ready before locking.")
          }
        >
          {locked ? "Reopen month" : "Lock checked month"}
        </Button>
      </div>
    ) : null;

  const refresh = () => qc.invalidateQueries({ queryKey: ["timesheets"] });

  async function guarded(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport(sheets: readonly TimesheetSheet[]) {
    try {
      await downloadTimesheetReport(sheets);
    } catch (err) {
      toast.error(errorMessage(err, "The report could not be made."));
    }
  }

  async function downloadAll(format: "excel" | "pdf" = "excel") {
    await guarded(async () => {
      const all: TimesheetSheet[] = [];
      const total = Math.min(list?.total ?? 0, REPORT_MAX_SHEETS);
      for (let offset = 0; offset < total; offset += REPORT_STEP) {
        setProgress(`Getting sheets ${Math.min(offset + REPORT_STEP, total)} of ${total}…`);
        const part = await unwrap(
          getTimesheetReportPage({ data: { ...filter, offset, limit: REPORT_STEP } }),
        );
        all.push(...part);
      }
      setProgress("");
      if (all.length === 0) {
        toast.info("There is nothing to put in the report.");
        return;
      }
      if (format === "pdf") await printTimesheetReport(all);
      else await downloadTimesheetReport(all);
      if ((list?.total ?? 0) > REPORT_MAX_SHEETS) {
        toast.info(
          `The report has the first ${REPORT_MAX_SHEETS} sheets. Use search or a status filter for the rest.`,
        );
      }
    }, "The report could not be made.");
    setProgress("");
  }

  async function recheckMonth() {
    if (activeMonth === ALL) return;
    await guarded(async () => {
      let cursor: string | null = null;
      let done = 0;
      let changed = 0;
      do {
        setProgress(`Checking again… ${done} sheets done`);
        const step: { processed: number; changed: number; nextCursor: string | null } =
          await unwrap(recheckTimesheetBatch({ data: { month: activeMonth, cursor, limit: 10 } }));
        done += step.processed;
        changed += step.changed;
        cursor = step.nextCursor;
      } while (cursor);
      setProgress("");
      await refresh();
      toast.success(`${done} sheets checked again, ${changed} changed.`);
    }, "The sheets could not be checked again.");
    setProgress("");
  }

  if (!ready) return null;
  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Only administrators can open Timesheet Check for now."
        />
      </Panel>
    );
  }

  if (openId) {
    const open = openQ.data;
    if (openQ.isLoading) {
      return <p className="text-sm text-muted-foreground">Loading…</p>;
    }
    if (!open) {
      return (
        <Panel>
          <EmptyState title="This sheet is gone" description="It may have been deleted." />
          <div className="flex justify-center pb-6">
            <Button onClick={() => setOpenId(null)}>Back to all sheets</Button>
          </div>
        </Panel>
      );
    }
    return (
      <>
        {lockControl}
        <SheetCheckPanel
          key={open.id + ":" + open.sourceName + ":" + open.sourceNi}
          sheet={open}
          busy={busy || locked || lockUnknown}
          onBack={() => setOpenId(null)}
          onDownload={() => void downloadReport([open])}
          onPrint={() =>
            void guarded(() => printTimesheetReport([open]), "Could not open the PDF receipt.")
          }
          {...(open.matchedBy === "name" && !open.staffConfirmed
            ? {
                onConfirm: () =>
                  void guarded(async () => {
                    await unwrap(confirmTimesheetStaff({ data: { id: open.id } }));
                    await refresh();
                    toast.success("Match confirmed.");
                  }, "Could not confirm the match."),
              }
            : {})}
          onRecheck={() =>
            void guarded(async () => {
              await unwrap(recheckTimesheetSheet({ data: { id: open.id } }));
              await refresh();
              toast.success("Checked again.");
            }, "Could not check this sheet again.")
          }
          onCorrectIdentity={(name, ni) =>
            void guarded(async () => {
              const result = await unwrap(
                correctTimesheetIdentity({ data: { id: open.id, name, ni } }),
              );
              await refresh();
              toast.success(
                result?.status === "staff_not_found"
                  ? "Identity saved. No unique matching staff member was found."
                  : "Identity saved and checked again.",
              );
            }, "Could not correct the sheet identity.")
          }
          onDelete={() => setConfirmDelete(true)}
        />
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this sheet?</AlertDialogTitle>
              <AlertDialogDescription>
                The uploaded sheet and its comparison are removed. Your Staff and shift records are
                not touched. You can upload the file again afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void guarded(async () => {
                    await unwrap(deleteTimesheetSheet({ data: { id: open.id } }));
                    setOpenId(null);
                    await refresh();
                    toast.success("Sheet deleted.");
                  }, "Could not delete this sheet.")
                }
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  const sum = list?.summary;
  const items = list?.items ?? [];
  const total = list?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      {lockControl}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Timesheet Check</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload the hours your staff sent and see where they differ from your own records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={activeMonth}
            onValueChange={(v) => {
              setMonth(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All months</SelectItem>
              {months.map((m) => (
                <SelectItem key={m.month} value={m.month}>
                  {m.label} ({m.sheets})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={busy || activeMonth === ALL || (sum?.total ?? 0) === 0}
            onClick={() => void recheckMonth()}
          >
            <RefreshCw className="size-4" /> Check month again
          </Button>
          <Button
            variant="outline"
            disabled={busy || total === 0}
            onClick={() => void downloadAll()}
          >
            <Download className="size-4" /> Download report
          </Button>
          <Button
            variant="outline"
            disabled={busy || total === 0}
            onClick={() => void downloadAll("pdf")}
          >
            Print / PDF receipts
          </Button>
          <Button disabled={busy || locked || lockUnknown} onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" /> Upload timesheets
          </Button>
        </div>
      </div>

      {progress ? <p className="text-[13px] text-muted-foreground">{progress}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label={activeMonth === ALL ? "Sheets" : "Sheets this month"}
          value={String(sum?.total ?? 0)}
          icon={ListChecks}
        />
        <SummaryCard label="All matching" value={String(sum?.ready ?? 0)} tone="success" />
        <SummaryCard
          label="Need a look"
          value={String(sum?.needsReview ?? 0)}
          tone={sum?.needsReview ? "warning" : "success"}
        />
        <SummaryCard
          label="Staff not found"
          value={String(sum?.notFound ?? 0)}
          sublabel="Check the name / NI read from the sheet"
          tone={sum?.notFound ? "danger" : "success"}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Uploaded sheets"
          description={`${total} sheet${total === 1 ? "" : "s"}${search || status !== ALL ? " match" : ""}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name or file"
                  className="h-9 w-48 pl-8"
                />
              </div>
              <Select
                value={status}
                onValueChange={(v) => {
                  setStatus(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="ready">All matching</SelectItem>
                  <SelectItem value="needs_review">Needs a look</SelectItem>
                  <SelectItem value="staff_not_found">Staff not found</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />
        {listQ.isLoading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : listQ.isError ? (
          <EmptyState
            title="The sheets could not be loaded"
            description={errorMessage(listQ.error, "Please try again.")}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={(sum?.total ?? 0) === 0 ? "No sheets yet" : "No sheets match"}
            description={
              (sum?.total ?? 0) === 0
                ? "Upload the Excel or CSV timesheets your staff sent."
                : "Try a different search or status."
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table className="min-w-[900px]">
                <THead>
                  <TR>
                    <TH>Staff</TH>
                    <TH>NI</TH>
                    <TH>File</TH>
                    <TH>Uploaded</TH>
                    <TH align="right">Sheet</TH>
                    <TH align="right">Our records</TH>
                    <TH align="right">Difference</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((s) => (
                    <TR key={s.id} onClick={() => setOpenId(s.id)}>
                      <TD className="font-medium">
                        <span className="flex flex-wrap items-center gap-2">
                          {s.staffName}
                          {activeMonth === ALL ? (
                            <span className="text-xs font-normal text-muted-foreground">
                              {s.monthLabel}
                            </span>
                          ) : null}
                          {s.matchedBy === "name" && !s.staffConfirmed ? (
                            <Pill tone="warn">Name only</Pill>
                          ) : null}
                          {s.statedMismatch ? <Pill tone="warn">Total differs</Pill> : null}
                        </span>
                      </TD>
                      <TD mono>{maskNi(s.ni)}</TD>
                      <TD>
                        <span className="flex items-center gap-2">
                          <Pill tone="mute">{FORMAT_LABEL[s.format]}</Pill>
                          <span className="max-w-[200px] truncate text-muted-foreground">
                            {s.sheetLabel ? `${s.fileName} (${s.sheetLabel})` : s.fileName}
                          </span>
                        </span>
                      </TD>
                      <TD>{fmtDateTime(s.uploadedAt)}</TD>
                      <TD align="right" mono>
                        {fmtHours(s.sheetHours)}
                      </TD>
                      <TD align="right" mono>
                        {s.status === "staff_not_found" ? "—" : fmtHours(s.recordHours)}
                      </TD>
                      <TD align="right" mono>
                        {s.status === "staff_not_found" ? "—" : fmtDiff(s.diff)}
                      </TD>
                      <TD>
                        <SheetStatusBadge status={s.status} />
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

      <UploadTimesheetDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onOpenExisting={(id, m) => {
          setUploadOpen(false);
          setMonth(m);
          setQ("");
          setSearch("");
          setStatus(ALL);
          setPage(1);
          setOpenId(id);
        }}
        onSaved={(m) => {
          setMonth(m);
          setPage(1);
        }}
      />
    </div>
  );
}
