import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  Download,
  FileSpreadsheet,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unlock,
  Upload,
  UserPlus,
} from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Field } from "@/components/app/Field";
import { EntryDialog } from "@/components/app/salary/EntryDialog";
import { ImportDialog } from "@/components/app/salary/ImportDialog";
import { ExportReportDialog } from "@/components/app/salary/ExportReportDialog";
import { AddLineDialog } from "@/components/app/salary/AddLineDialog";
import { CompaniesDialog } from "@/components/app/salary/CompaniesDialog";
import { UnmatchedDialog } from "@/components/app/salary/UnmatchedDialog";
import { CheckBadge, PayStatusBadge, PeriodStatusBadge } from "@/components/app/salary/badges";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/ledger/calc";
import {
  createPeriod,
  deletePeriod,
  refreshCarryForward,
  setPeriodStatus,
} from "@/lib/actions/salary";
import {
  buildRows,
  currentMonth,
  formatMonthLabel,
  normNi,
  sumRows,
  type SheetRow,
} from "@/lib/payroll/calc";
import { exportSalarySheet } from "@/lib/payroll/export";
import { errorMessage, usePeriods, usePeriodSheet, useRefreshSalary } from "@/lib/payroll/queries";
import type { CheckStatus, PayStatus, PeriodStatus } from "@/lib/payroll/types";

export const Route = createFileRoute("/salary/")({
  head: () => ({
    meta: [
      { title: "Salary Sheet — LedgerFlow" },
      {
        name: "description",
        content:
          "Monthly staff salary sheet: shift imports, payroll, cash payments and outstanding balances.",
      },
    ],
  }),
  component: SalaryPage,
});

function SalaryPage() {
  return (
    <RequireView module="salary">
      <SalaryPageContent />
    </RequireView>
  );
}

const ALL = "__all__";
const money = (n: number) => formatMoney(n);
const hrs = (n: number) =>
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** What the next step of the month's workflow is, and who may take it. */
const NEXT: Record<PeriodStatus, { to: PeriodStatus; label: string; approve: boolean } | null> = {
  draft: { to: "reviewed", label: "Mark reviewed", approve: false },
  reviewed: { to: "verified", label: "Mark verified", approve: true },
  verified: { to: "closed", label: "Close month", approve: true },
  closed: null,
};

function SalaryPageContent() {
  const { can } = usePermissions();
  const refresh = useRefreshSalary();
  const periodsQ = usePeriods();
  const periods = useMemo(() => periodsQ.data ?? [], [periodsQ.data]);

  const [periodId, setPeriodId] = useState<string | null>(null);
  useEffect(() => {
    if (periods.length === 0) return;
    if (!periodId || !periods.some((p) => p.id === periodId)) setPeriodId(periods[0]?.id ?? null);
  }, [periods, periodId]);

  const sheetQ = usePeriodSheet(periodId);
  const sheet = sheetQ.data;

  const [q, setQ] = useState("");
  const [payFilter, setPayFilter] = useState<string>(ALL);
  const [checkFilter, setCheckFilter] = useState<string>(ALL);
  const [tagFilter, setTagFilter] = useState<string>(ALL);
  const [areaFilter, setAreaFilter] = useState<string>(ALL);

  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showCompanies, setShowCompanies] = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [confirm, setConfirm] = useState<null | "close" | "delete" | "reopen">(null);
  const [busy, setBusy] = useState(false);

  const locked = sheet?.period.status === "closed";
  const canEdit = can("salary", "edit") && !locked;
  const canApprove = can("salary", "approve");
  // The payroll report carries NI + bank details, so it needs BOTH view permissions.
  const canExportReport = can("salary", "view") && can("staff", "view");

  const rows: SheetRow[] = useMemo(
    () => (sheet ? buildRows(sheet.entries, sheet.staff, sheet.payments, sheet.companies) : []),
    [sheet],
  );

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const t of r.staff.tag.split(",")) if (t.trim()) set.add(t.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);
  const areas = useMemo(
    () =>
      [...new Set(rows.map((r) => r.staff.area.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ni = normNi(q);
    return rows
      .filter((r) => {
        if (payFilter !== ALL && r.computed.payStatus !== (payFilter as PayStatus)) return false;
        if (
          checkFilter === "none"
            ? r.entry.checkStatus !== ""
            : checkFilter !== ALL && r.entry.checkStatus !== (checkFilter as CheckStatus)
        )
          return false;
        if (tagFilter !== ALL && !r.staff.tag.split(",").some((t) => t.trim() === tagFilter))
          return false;
        if (areaFilter !== ALL && r.staff.area.trim() !== areaFilter) return false;
        if (!needle) return true;
        return (
          r.staff.name.toLowerCase().includes(needle) ||
          r.staff.rssId === needle ||
          r.staff.essId === needle ||
          (ni.length >= 3 && normNi(r.staff.ni).includes(ni))
        );
      })
      .sort((a, b) => a.staff.name.localeCompare(b.staff.name));
  }, [rows, q, payFilter, checkFilter, tagFilter, areaFilter]);

  const totals = useMemo(() => sumRows(filtered), [filtered]);
  const allTotals = useMemo(() => sumRows(rows), [rows]);
  const companies = sheet?.companies ?? [];
  const nPay = Math.max(4, ...rows.map((r) => r.payments.length));
  const liveRow = rows.find((r) => r.entry.id === openEntryId) ?? null;
  const filtersOn =
    payFilter !== ALL ||
    checkFilter !== ALL ||
    tagFilter !== ALL ||
    areaFilter !== ALL ||
    q.trim() !== "";

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err, "That didn't work."));
    } finally {
      setBusy(false);
    }
  }

  const next = sheet ? NEXT[sheet.period.status] : null;
  const canAdvance = next ? (next.approve ? canApprove : can("salary", "edit")) : false;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Salary Sheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One month at a time. Closing a month carries every balance into the next one.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={periodId ?? ""}
            onValueChange={setPeriodId}
            disabled={periods.length === 0}
          >
            <SelectTrigger className="h-9 w-52">
              <SelectValue placeholder="No months yet" />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {formatMonthLabel(p.month)} · {p.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {can("salary", "create") ? (
            <Button onClick={() => setShowNew(true)}>
              <Plus className="size-4" /> New month
            </Button>
          ) : null}
        </div>
      </div>

      {periodsQ.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      ) : periods.length === 0 ? (
        <Panel>
          <EmptyState
            title="No salary months yet"
            description="Create the first month, then import your shift export or your existing Excel salary sheet into it."
          />
        </Panel>
      ) : !sheet ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {sheetQ.error ? errorMessage(sheetQ.error, "Couldn't load this month.") : "Loading…"}
        </p>
      ) : (
        <>
          {/* status + actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-[15px] font-semibold">
                {formatMonthLabel(sheet.period.month)}
              </span>
              <PeriodStatusBadge status={sheet.period.status} />
              {locked ? (
                <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                  <Lock className="size-3.5" /> Locked
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                    <Upload className="size-4" /> Import
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowAddLine(true)}>
                    <UserPlus className="size-4" /> Add line
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowCompanies(true)}>
                    <Banknote className="size-4" /> Payroll companies
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          refreshCarryForward({ data: { periodId: sheet.period.id } }).then((r) => {
                            if (!r.previousMonth)
                              throw new Error("There is no earlier month to carry forward from.");
                          }),
                        "Carry-forward refreshed from the previous month.",
                      )
                    }
                  >
                    <RefreshCw className="size-4" /> Refresh carry-forward
                  </Button>
                </>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  exportSalarySheet(sheet.period.month, filtered, companies).catch((e) =>
                    toast.error(errorMessage(e, "Export failed.")),
                  )
                }
                disabled={filtered.length === 0}
              >
                <Download className="size-4" /> Export Excel{filtersOn ? " (filtered)" : ""}
              </Button>
              {canExportReport ? (
                <Button variant="outline" size="sm" onClick={() => setShowReport(true)}>
                  <FileSpreadsheet className="size-4" /> Export payroll report
                </Button>
              ) : null}
              {next && canAdvance ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    next.to === "closed"
                      ? setConfirm("close")
                      : run(
                          () =>
                            setPeriodStatus({
                              data: { periodId: sheet.period.id, status: next.to },
                            }),
                          `Marked ${next.to}.`,
                        )
                  }
                >
                  {next.label}
                </Button>
              ) : null}
              {locked && canApprove ? (
                <Button variant="outline" size="sm" onClick={() => setConfirm("reopen")}>
                  <Unlock className="size-4" /> Reopen
                </Button>
              ) : null}
              {!locked && can("salary", "delete") ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setConfirm("delete")}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>

          {sheet.unmatchedShifts > 0 ? (
            <button
              type="button"
              onClick={() => setShowUnmatched(true)}
              className="flex w-full items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-left text-[12px] text-warning"
            >
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                <strong>{sheet.unmatchedShifts}</strong> imported shifts aren't matched to any staff
                member, so their hours are missing from the totals. Click to see who.
              </span>
            </button>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard
              label="Staff lines"
              value={String(allTotals.lines)}
              sublabel={`${hrs(allTotals.totalHours)} hours`}
              icon={Banknote}
            />
            <SummaryCard
              label="Total amount"
              value={money(allTotals.totalAmount)}
              sublabel="incl. carry-forward"
            />
            <SummaryCard
              label="Paid via payroll"
              value={money(allTotals.payrollTotal)}
              sublabel={`after ${money(allTotals.taxDeduction)} tax`}
              tone="success"
            />
            <SummaryCard label="Cash paid" value={money(allTotals.cashPaid)} tone="success" />
            <SummaryCard
              label="Net outstanding"
              value={money(allTotals.outstanding)}
              sublabel="owed to staff (− = overpaid)"
              tone={
                allTotals.outstanding > 0
                  ? "warning"
                  : allTotals.outstanding < 0
                    ? "danger"
                    : "success"
              }
            />
          </div>

          <Panel>
            <PanelHeader
              title="Staff salary lines"
              description={`${filtered.length} of ${rows.length} lines${filtersOn ? " (filtered — totals row follows the filter)" : ""}`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Name, ID or NI"
                      className="h-9 w-44 pl-8"
                    />
                  </div>
                  <FilterSelect
                    value={payFilter}
                    onChange={setPayFilter}
                    all="All pay status"
                    options={["Current", "OverPaid", "Paid in Full"]}
                  />
                  <FilterSelect
                    value={checkFilter}
                    onChange={setCheckFilter}
                    all="All checks"
                    options={["Reviewed", "Verified"]}
                    extra={[["none", "Not checked"]]}
                  />
                  <FilterSelect
                    value={tagFilter}
                    onChange={setTagFilter}
                    all="All tags"
                    options={tags}
                  />
                  <FilterSelect
                    value={areaFilter}
                    onChange={setAreaFilter}
                    all="All areas"
                    options={areas}
                  />
                </div>
              }
            />
            {rows.length === 0 ? (
              <EmptyState
                title="This month has no lines yet"
                description="Import a shift export, or your Excel salary sheet, to fill it."
              />
            ) : filtered.length === 0 ? (
              <EmptyState title="Nothing matches those filters" />
            ) : (
              <TableWrap>
                <Table className="min-w-[1500px]">
                  <THead>
                    <TR className="h-9">
                      <TH className="sticky left-0 z-10 bg-surface-muted">Name</TH>
                      <TH>RSS ID</TH>
                      <TH>ESS ID</TH>
                      <TH>Tag</TH>
                      <TH>Area</TH>
                      <TH align="right">RSS £</TH>
                      <TH align="right">RSS h</TH>
                      <TH align="right">ESS £</TH>
                      <TH align="right">ESS h</TH>
                      <TH align="right">B/F</TH>
                      <TH align="right">Hours</TH>
                      <TH align="right">Total £</TH>
                      <TH align="center">Check</TH>
                      {companies.map((c) => (
                        <TH key={c.id} align="right">
                          {c.name}
                        </TH>
                      ))}
                      <TH align="right">Tax</TH>
                      <TH align="right">Payroll</TH>
                      {Array.from({ length: nPay }, (_, i) => (
                        <TH key={i} align="right">
                          P{i + 1}
                        </TH>
                      ))}
                      <TH align="right">Cash</TH>
                      <TH align="right">Deduct.</TH>
                      <TH align="right">Outstanding</TH>
                      <TH align="center">Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => {
                      const e = r.entry;
                      return (
                        <TR key={e.id} onClick={() => setOpenEntryId(e.id)} className="h-9">
                          <TD className="sticky left-0 z-10 bg-surface font-medium">
                            {r.staff.name}
                            {e.flag ? (
                              <span className="ml-2 text-[10px] text-warning">{e.flag}</span>
                            ) : null}
                          </TD>
                          <TD mono>{r.staff.rssId || "—"}</TD>
                          <TD mono>{r.staff.essId || "—"}</TD>
                          <TD>{r.staff.tag || "—"}</TD>
                          <TD>{r.staff.area || "—"}</TD>
                          <TD align="right" mono>
                            {e.rssAmount ? money(e.rssAmount) : "—"}
                          </TD>
                          <TD align="right" mono>
                            {e.rssHours ? hrs(e.rssHours) : "—"}
                          </TD>
                          <TD align="right" mono>
                            {e.essAmount ? money(e.essAmount) : "—"}
                          </TD>
                          <TD align="right" mono>
                            {e.essHours ? hrs(e.essHours) : "—"}
                          </TD>
                          <TD align="right" mono>
                            {e.carryForward ? money(e.carryForward) : "—"}
                          </TD>
                          <TD align="right" mono>
                            {hrs(r.computed.totalHours)}
                          </TD>
                          <TD align="right" mono className="font-medium">
                            {money(r.computed.totalAmount)}
                          </TD>
                          <TD align="center">
                            <CheckBadge status={e.checkStatus} />
                          </TD>
                          {companies.map((c) => (
                            <TD key={c.id} align="right" mono>
                              {e.payroll[c.id] ? money(e.payroll[c.id] ?? 0) : "—"}
                            </TD>
                          ))}
                          <TD align="right" mono>
                            {e.taxDeduction ? money(e.taxDeduction) : "—"}
                          </TD>
                          <TD align="right" mono>
                            {money(r.computed.payrollTotal)}
                          </TD>
                          {Array.from({ length: nPay }, (_, i) => (
                            <TD key={i} align="right" mono>
                              {r.payments[i] ? money(r.payments[i]?.amount ?? 0) : "—"}
                            </TD>
                          ))}
                          <TD align="right" mono>
                            {money(r.computed.cashPaid)}
                          </TD>
                          <TD align="right" mono>
                            {e.deduction ? money(e.deduction) : "—"}
                          </TD>
                          <TD align="right" mono className="font-semibold">
                            {money(r.computed.outstanding)}
                          </TD>
                          <TD align="center">
                            <PayStatusBadge status={r.computed.payStatus} />
                          </TD>
                        </TR>
                      );
                    })}
                    <TR className="h-10 bg-surface-muted font-semibold">
                      <TD className="sticky left-0 z-10 bg-surface-muted">
                        Total ({totals.lines})
                      </TD>
                      <TD />
                      <TD />
                      <TD />
                      <TD />
                      <TD align="right" mono>
                        {money(totals.rssAmount)}
                      </TD>
                      <TD align="right" mono>
                        {hrs(totals.rssHours)}
                      </TD>
                      <TD align="right" mono>
                        {money(totals.essAmount)}
                      </TD>
                      <TD align="right" mono>
                        {hrs(totals.essHours)}
                      </TD>
                      <TD align="right" mono>
                        {money(totals.carryForward)}
                      </TD>
                      <TD align="right" mono>
                        {hrs(totals.totalHours)}
                      </TD>
                      <TD align="right" mono>
                        {money(totals.totalAmount)}
                      </TD>
                      <TD />
                      {companies.map((c) => (
                        <TD key={c.id} align="right" mono>
                          {money(totals.byCompany[c.id] ?? 0)}
                        </TD>
                      ))}
                      <TD align="right" mono>
                        {money(totals.taxDeduction)}
                      </TD>
                      <TD align="right" mono>
                        {money(totals.payrollTotal)}
                      </TD>
                      {Array.from({ length: nPay }, (_, i) => (
                        <TD key={i} align="right" mono>
                          {money(filtered.reduce((s, r) => s + (r.payments[i]?.amount ?? 0), 0))}
                        </TD>
                      ))}
                      <TD align="right" mono>
                        {money(totals.cashPaid)}
                      </TD>
                      <TD align="right" mono>
                        {money(totals.deduction)}
                      </TD>
                      <TD align="right" mono>
                        {money(totals.outstanding)}
                      </TD>
                      <TD />
                    </TR>
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Panel>

          <EntryDialog
            open={!!liveRow}
            onOpenChange={(v) => !v && setOpenEntryId(null)}
            row={liveRow}
            companies={companies}
            locked={!!locked || !can("salary", "edit")}
            canDelete={can("salary", "delete") && !locked}
          />
          <ImportDialog
            open={showImport}
            onOpenChange={setShowImport}
            periodId={sheet.period.id}
            month={sheet.period.month}
            companies={companies}
          />
          <AddLineDialog
            open={showAddLine}
            onOpenChange={setShowAddLine}
            periodId={sheet.period.id}
            month={sheet.period.month}
            staff={sheet.staff}
            haveStaffIds={new Set(sheet.entries.map((e) => e.staffId))}
          />
          {canExportReport ? (
            <ExportReportDialog
              open={showReport}
              onOpenChange={setShowReport}
              month={sheet.period.month}
              companies={companies}
              entries={sheet.entries}
            />
          ) : null}
          <CompaniesDialog open={showCompanies} onOpenChange={setShowCompanies} />
          <UnmatchedDialog
            open={showUnmatched}
            onOpenChange={setShowUnmatched}
            periodId={sheet.period.id}
            locked={!!locked || !can("salary", "edit")}
          />

          <ConfirmDialog
            open={confirm === "close"}
            onOpenChange={(v) => !v && setConfirm(null)}
            title={`Close ${formatMonthLabel(sheet.period.month)}?`}
            description="The month is locked, and every person's outstanding balance becomes next month's carry-forward (if next month already exists). You can reopen it later."
            confirmLabel="Close month"
            onConfirm={() =>
              run(
                () => setPeriodStatus({ data: { periodId: sheet.period.id, status: "closed" } }),
                "Month closed.",
              )
            }
          />
          <ConfirmDialog
            open={confirm === "reopen"}
            onOpenChange={(v) => !v && setConfirm(null)}
            title={`Reopen ${formatMonthLabel(sheet.period.month)}?`}
            description="The month goes back to Verified and can be edited again. Re-close it afterwards so later months pick up the corrected balances."
            confirmLabel="Reopen"
            onConfirm={() =>
              run(
                () => setPeriodStatus({ data: { periodId: sheet.period.id, status: "verified" } }),
                "Month reopened.",
              )
            }
          />
          <ConfirmDialog
            open={confirm === "delete"}
            onOpenChange={(v) => !v && setConfirm(null)}
            title={`Delete ${formatMonthLabel(sheet.period.month)}?`}
            description="This removes the month with all its lines, cash payments and imported shifts. It can't be undone."
            confirmLabel="Delete month"
            onConfirm={() =>
              run(() => deletePeriod({ data: { periodId: sheet.period.id } }), "Month deleted.")
            }
          />
        </>
      )}

      <NewPeriodDialog
        open={showNew}
        onOpenChange={setShowNew}
        existing={periods.map((p) => p.month)}
        onCreated={(id) => setPeriodId(id)}
      />
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  all,
  options,
  extra = [],
}: {
  value: string;
  onChange: (v: string) => void;
  all: string;
  options: string[];
  extra?: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {extra.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NewPeriodDialog({
  open,
  onOpenChange,
  existing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: string[];
  onCreated: (id: string) => void;
}) {
  const refresh = useRefreshSalary();
  const [month, setMonth] = useState(currentMonth());
  const [busy, setBusy] = useState(false);
  const dupe = existing.includes(month);

  async function create() {
    setBusy(true);
    try {
      const p = await createPeriod({ data: { month } });
      await refresh();
      onCreated(p.id);
      toast.success(
        `${formatMonthLabel(month)} created — balances carried from the previous month.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not create the month."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New salary month</DialogTitle>
          <DialogDescription>
            Opening balances are filled in from the latest earlier month automatically.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="Month"
          error={dupe ? `${formatMonthLabel(month)} already exists.` : undefined}
        >
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || dupe || !/^\d{4}-\d{2}$/.test(month)}>
            {busy ? "Creating…" : "Create month"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
