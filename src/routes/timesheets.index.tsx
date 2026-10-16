import { TimesheetList } from "@/components/app/timesheets/TimesheetList";
import { printTimesheetReport } from "@/lib/timesheets/print";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  ListChecks,
  MoreHorizontal,
  Printer,
  RefreshCw,
  Search,
  Upload,
} from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader } from "@/components/app/Panel";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
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
  calculateTimesheetPay,
  recheckTimesheetBatch,
  recheckTimesheetSheet,
  acceptTimesheetRow,
  unacceptTimesheetRow,
  editTimesheetRow,
  getTimesheetPayInfo,
  saveTimesheetAccount,
  addTimesheetPayment,
  deleteTimesheetPayment,
  setTimesheetStatedAccepted,
  correctTimesheetIdentity,
  timesheetMonthLock,
  setTimesheetMonthLock,
} from "@/lib/actions/timesheets";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import { fmtHours, type SheetStatus, type TimesheetSheet } from "@/lib/timesheets/data";
import { formatMoney } from "@/lib/ledger/calc";

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
  // The real gate is the "timesheets" permission checked inside every server function;
  // the checks below only decide which buttons to show.
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
  const { isAdmin, can, ready } = usePermissions();
  const canView = can("timesheets", "view");
  const canCreate = can("timesheets", "create");
  const canEdit = can("timesheets", "edit");
  const canDelete = can("timesheets", "delete");
  const canApprove = can("timesheets", "approve");
  const canSeeStaff = can("staff", "view");
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [month, setMonth] = useState<string>("");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; staffName: string } | null>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const deleting = useRef(false);
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
    enabled: ready && canView,
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
    enabled: ready && canView && !monthsQ.isLoading,
    placeholderData: keepPreviousData,
  });
  const list = listQ.data;

  const openQ = useQuery({
    queryKey: ["timesheets", "one", openId],
    queryFn: () => unwrap(getTimesheetSheet({ data: { id: openId ?? "" } })),
    enabled: ready && canView && openId !== null,
  });

  const payQ = useQuery({
    queryKey: ["timesheets", "pay", openId],
    queryFn: () => unwrap(getTimesheetPayInfo({ data: { sheetId: openId ?? "" } })),
    enabled: ready && canView && openId !== null && openQ.data?.status !== "staff_not_found",
  });

  const lockMonth = openQ.data?.month ?? activeMonth;
  const lockQ = useQuery({
    queryKey: ["timesheets", "lock", lockMonth],
    queryFn: () => unwrap(timesheetMonthLock({ data: { month: lockMonth } })),
    enabled: ready && canView && lockMonth !== ALL,
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
        {locked ? (
          isAdmin ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || lockUnknown}
              onClick={() =>
                void guarded(async () => {
                  await unwrap(
                    setTimesheetMonthLock({ data: { month: lockMonth, locked: false } }),
                  );
                  await refresh();
                  toast.success("Month reopened.");
                }, "Could not reopen the month.")
              }
            >
              Reopen month
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Only an admin can reopen it.</span>
          )
        ) : canApprove ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || lockUnknown}
            onClick={() =>
              void guarded(async () => {
                await unwrap(setTimesheetMonthLock({ data: { month: lockMonth, locked: true } }));
                await refresh();
                toast.success("Month locked.");
              }, "Could not lock the month. Every sheet must be ready (or have its differences accepted) before locking.")
            }
          >
            Lock checked month
          </Button>
        ) : null}
      </div>
    ) : null;

  // Salary Sheet figures change when a shift is edited or a payment is added, so refresh those too.
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["timesheets"] });
    void qc.invalidateQueries({ queryKey: ["salary"] });
    void qc.invalidateQueries({ queryKey: ["staff"] });
  };

  // Sheets uploaded before pay existed have no pay yet: fill it in by itself, once, so nobody
  // has to press "Check again" just to see Rate / Pay hours / Amount.
  const payCalcTried = useRef(false);
  const payMissing = list?.summary.payMissing ?? 0;
  useEffect(() => {
    if (!canEdit || payMissing === 0 || payCalcTried.current) return;
    payCalcTried.current = true;
    void (async () => {
      try {
        for (let i = 0; i < 300; i++) {
          const step = await unwrap(calculateTimesheetPay({ data: { limit: 10 } }));
          if (step.processed === 0 || step.remaining === 0) break;
        }
        await refresh();
      } catch {
        // Silent: the summary card still says how many sheets are not calculated yet.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, payMissing]);

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

  const deleteDialog = (
    <AlertDialog
      open={deleteTarget !== null}
      onOpenChange={(v) => {
        if (!busy && !v) setDeleteTarget(null);
      }}
    >
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          deleteButton.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete timesheet for {deleteTarget?.staffName}?</AlertDialogTitle>
          <AlertDialogDescription>
            The uploaded sheet and its comparison will be removed. Staff and salary shift records
            stay unchanged. You can upload the file again afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <Button
            ref={deleteButton}
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (!deleteTarget || deleting.current) return;
              const id = deleteTarget.id;
              deleting.current = true;
              void guarded(async () => {
                await unwrap(deleteTimesheetSheet({ data: { id } }));
                setDeleteTarget(null);
                if (openId === id) setOpenId(null);
                await refresh();
                toast.success("Sheet deleted.");
              }, "Could not delete this sheet.").finally(() => {
                deleting.current = false;
              });
            }}
          >
            {busy ? "Deleting…" : "Delete sheet"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (!ready) return null;
  if (!canView) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Ask an administrator to give you Timesheet Check access in your user profile."
        />
      </Panel>
    );
  }

  if (openId) {
    const open = openQ.data;
    if (openQ.isLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <SkeletonRows rows={6} />
        </div>
      );
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
      <div className="space-y-5">
        {lockControl}
        <SheetCheckPanel
          key={open.id + ":" + open.sourceName + ":" + open.sourceNi + ":" + open.sourceDob}
          sheet={open}
          busy={busy || locked || lockUnknown}
          onBack={() => setOpenId(null)}
          onDownload={() => void downloadReport([open])}
          onPrint={() =>
            void guarded(() => printTimesheetReport([open]), "Could not open the PDF receipt.")
          }
          {...(canEdit && open.matchedBy === "name" && !open.staffConfirmed
            ? {
                onConfirm: () =>
                  void guarded(async () => {
                    await unwrap(confirmTimesheetStaff({ data: { id: open.id } }));
                    await refresh();
                    toast.success("Match confirmed.");
                  }, "Could not confirm the match."),
              }
            : {})}
          {...(canEdit
            ? {
                onRecheck: () =>
                  void guarded(async () => {
                    await unwrap(recheckTimesheetSheet({ data: { id: open.id } }));
                    await refresh();
                    toast.success("Checked again.");
                  }, "Could not check this sheet again."),
              }
            : {})}
          {...(canEdit && canSeeStaff
            ? {
                onCorrectIdentity: (name: string, ni: string, dob: string) =>
                  void guarded(async () => {
                    const result = await unwrap(
                      correctTimesheetIdentity({ data: { id: open.id, name, ni, dob } }),
                    );
                    await refresh();
                    toast.success(
                      result?.status === "staff_not_found"
                        ? "Identity saved. No unique matching staff member was found."
                        : "Identity saved and checked again.",
                    );
                  }, "Could not correct the sheet identity."),
              }
            : {})}
          payBusy={busy}
          payInfo={payQ.data ?? null}
          {...(canApprove && can("salary", "edit")
            ? {
                onEditRow: (rowId: string, hours: number, rate: number, note: string) =>
                  void guarded(async () => {
                    const res = await unwrap(
                      editTimesheetRow({ data: { rowId, hours, rate, note } }),
                    );
                    await refresh();
                    if (res.salaryUpdated)
                      toast.success("Shift saved here and in the Salary Sheet.");
                    else
                      toast.warning(
                        res.salaryNote
                          ? `Shift saved on the timesheet only. ${res.salaryNote}`
                          : "Shift saved on the timesheet only.",
                      );
                  }, "Could not save this shift."),
              }
            : {})}
          {...(canEdit && canSeeStaff && can("staff", "edit")
            ? {
                onSaveAccount: (a: {
                  accountHolderName: string;
                  accountNumber: string;
                  sortCode: string;
                }) =>
                  void guarded(async () => {
                    await unwrap(saveTimesheetAccount({ data: { sheetId: open.id, ...a } }));
                    await refresh();
                    toast.success("Account details saved.");
                  }, "Could not save the account details."),
              }
            : {})}
          {...(can("salary", "edit")
            ? {
                onAddPayment: (p: {
                  date: string;
                  amount: number;
                  method: string;
                  reference: string;
                  notes: string;
                }) =>
                  void guarded(async () => {
                    await unwrap(
                      addTimesheetPayment({
                        data: {
                          sheetId: open.id,
                          ...p,
                          method: p.method as "Cash" | "Bank Transfer" | "Cheque" | "Other",
                        },
                      }),
                    );
                    await refresh();
                    toast.success("Payment added (also in the Salary Sheet).");
                  }, "Could not add the payment."),
              }
            : {})}
          {...(can("salary", "delete")
            ? {
                onDeletePayment: (paymentId: string) =>
                  void guarded(async () => {
                    await unwrap(deleteTimesheetPayment({ data: { sheetId: open.id, paymentId } }));
                    await refresh();
                    toast.success("Payment removed.");
                  }, "Could not remove the payment."),
              }
            : {})}
          {...(canApprove
            ? {
                onAcceptRow: (rowId: string, note: string, actualHours: number) =>
                  void guarded(async () => {
                    await unwrap(acceptTimesheetRow({ data: { rowId, note, actualHours } }));
                    await refresh();
                    toast.success("Difference accepted.");
                  }, "Could not accept this difference."),
                onUnacceptRow: (rowId: string) =>
                  void guarded(async () => {
                    await unwrap(unacceptTimesheetRow({ data: { rowId } }));
                    await refresh();
                    toast.success("Acceptance withdrawn.");
                  }, "Could not withdraw the acceptance."),
                onAcceptStated: (note: string) =>
                  void guarded(async () => {
                    await unwrap(
                      setTimesheetStatedAccepted({ data: { id: open.id, accept: true, note } }),
                    );
                    await refresh();
                    toast.success("Difference accepted.");
                  }, "Could not accept this difference."),
                onUnacceptStated: () =>
                  void guarded(async () => {
                    await unwrap(
                      setTimesheetStatedAccepted({
                        data: { id: open.id, accept: false, note: "" },
                      }),
                    );
                    await refresh();
                    toast.success("Acceptance withdrawn.");
                  }, "Could not withdraw the acceptance."),
              }
            : {})}
          {...(canDelete
            ? { onDelete: () => setDeleteTarget({ id: open.id, staffName: open.staffName }) }
            : {})}
        />
        {deleteDialog}
      </div>
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
            <SelectTrigger className="h-9 w-44" aria-label="Choose the month">
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
          {canCreate ? (
            <Button disabled={busy || locked || lockUnknown} onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" /> Upload timesheets
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions" disabled={busy}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit ? (
                <DropdownMenuItem
                  disabled={activeMonth === ALL || (sum?.total ?? 0) === 0}
                  onSelect={() => void recheckMonth()}
                >
                  <RefreshCw className="mr-2 size-4" /> Check month again
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem disabled={total === 0} onSelect={() => void downloadAll()}>
                <Download className="mr-2 size-4" /> Download report
              </DropdownMenuItem>
              <DropdownMenuItem disabled={total === 0} onSelect={() => void downloadAll("pdf")}>
                <Printer className="mr-2 size-4" /> Print / PDF receipts
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {progress ? <p className="text-[13px] text-muted-foreground">{progress}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
        <SummaryCard
          label="Hours to pay"
          value={fmtHours(sum?.payHours ?? 0)}
          sublabel={
            sum?.payMissing
              ? `${sum.payMissing} sheet(s) not calculated yet (locked month or still working)`
              : "Matched rows + accepted actual hours"
          }
          tone={sum?.payMissing ? "warning" : "default"}
        />
        <SummaryCard
          label="Total payment"
          value={formatMoney(sum?.payAmount ?? 0)}
          sublabel={
            sum?.needsReview ? "Rows still to look at are not included yet" : "Hours to pay × rate"
          }
          tone={sum?.needsReview || sum?.payMissing ? "warning" : "success"}
        />
      </div>

      {activeMonth !== ALL && (sum?.total ?? 0) > 0 ? (
        <MonthChecklist
          uploaded={sum?.total ?? 0}
          notFound={sum?.notFound ?? 0}
          needsReview={sum?.needsReview ?? 0}
          ready={sum?.ready ?? 0}
          locked={locked}
        />
      ) : null}

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
                  aria-label="Search timesheets by staff or file name"
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
                <SelectTrigger className="h-9 w-44" aria-label="Filter timesheets by status">
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
          <SkeletonRows rows={5} />
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
            {...((sum?.total ?? 0) === 0 && canCreate && !locked
              ? {
                  action: (
                    <Button size="sm" onClick={() => setUploadOpen(true)}>
                      <Upload className="size-4" /> Upload first timesheet
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <>
            <TimesheetList
              items={items}
              disabled={busy || locked || lockUnknown}
              onOpen={setOpenId}
              {...(canDelete ? { onDelete: setDeleteTarget } : {})}
            />
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

      {deleteDialog}
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

/** The month in four steps, so it is always clear what is left before it can be locked. */
function MonthChecklist({
  uploaded,
  notFound,
  needsReview,
  ready,
  locked,
}: {
  uploaded: number;
  notFound: number;
  needsReview: number;
  ready: number;
  locked: boolean;
}) {
  const steps = [
    { done: uploaded > 0, label: `${uploaded} sheet${uploaded === 1 ? "" : "s"} uploaded` },
    {
      done: notFound === 0,
      label: notFound === 0 ? "Every person found in Staff" : `${notFound} to find in Staff`,
    },
    {
      done: needsReview === 0 && notFound === 0,
      label:
        needsReview === 0
          ? "No differences left to review"
          : `${needsReview} with differences to review or accept`,
    },
    { done: locked, label: locked ? "Month locked" : `${ready} of ${uploaded} ready to lock` },
  ];
  return (
    <ol
      aria-label="Steps for this month"
      className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border bg-white/[0.04] px-4 py-3 text-sm"
    >
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-2">
          {step.done ? (
            <CheckCircle2 className="size-4 text-success" aria-label="Done" />
          ) : (
            <Circle className="size-4 text-muted-foreground" aria-label="To do" />
          )}
          <span className={step.done ? "text-foreground" : "text-muted-foreground"}>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
