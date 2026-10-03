import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  Copy,
  Download,
  FileSpreadsheet,
  IdCard,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
  UserPlus,
} from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Field } from "@/components/app/Field";
import { PeriodStatusBadge } from "@/components/app/salary/badges";
import { StaffDialog } from "@/components/app/salary/StaffDialog";
import { PayrollCompanyDialog } from "@/components/app/payroll/PayrollCompanyDialog";
import { AddStaffDialog } from "@/components/app/payroll/AddStaffDialog";
import { StaffStatusDialog } from "@/components/app/payroll/StaffStatusDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/ledger/calc";
import {
  createPayrollSheet,
  deletePayrollLine,
  deletePayrollSheet,
  pushToSalarySheet,
  setPayrollSheetStatus,
  updatePayrollLine,
} from "@/lib/actions/payroll";
import { currentMonth, formatMonthLabel } from "@/lib/payroll/calc";
import { errorMessage } from "@/lib/payroll/queries";
import {
  usePayrollSheet,
  usePayrollSheets,
  useRefreshPayroll,
  useSheetCompanies,
} from "@/lib/payroll/sheetQueries";
import {
  duplicateNis,
  lineTotals,
  lineWarnings,
  salaryPasteSnippet,
  sumLines,
  type LineWarning,
} from "@/lib/payroll/sheetCalc";
import { exportPayrollWorkbook } from "@/lib/payroll/sheetExport";
import { PAYROLL_COMMENTS } from "@/lib/payroll/sheetTypes";
import type { CompanyStaffLink, PayrollLine, PayrollSheetStaff } from "@/lib/payroll/sheetTypes";
import { ageFromDob, displayDate, shareCodeState } from "@/lib/payroll/staffFields";
import { normNi } from "@/lib/payroll/calc";
import type { PeriodStatus } from "@/lib/payroll/types";

export const Route = createFileRoute("/payroll/")({
  head: () => ({
    meta: [
      { title: "Payroll Sheet — LedgerFlow" },
      {
        name: "description",
        content:
          "Monthly payroll sheets per payroll company: hours, rate, amount, staff details and contract status.",
      },
    ],
  }),
  component: PayrollPage,
});

function PayrollPage() {
  return (
    <RequireView module="payroll">
      <PayrollPageContent />
    </RequireView>
  );
}

const ALL = "__all__";
const hrs = (n: number) =>
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** What the next step of the month's workflow is, and who may take it. */
const NEXT: Record<PeriodStatus, { to: PeriodStatus; label: string; approve: boolean } | null> = {
  draft: { to: "reviewed", label: "Mark reviewed", approve: false },
  reviewed: { to: "verified", label: "Mark verified", approve: true },
  verified: { to: "closed", label: "Close month", approve: true },
  closed: null,
};

/* ------------------------------ small cells ------------------------------ */

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

function NumCell({
  value,
  disabled,
  onCommit,
  className,
  label,
}: {
  value: number;
  disabled: boolean;
  onCommit: (n: number) => void;
  className?: string;
  label: string;
}) {
  const [text, setText] = useState(fmtNum(value));
  useEffect(() => setText(fmtNum(value)), [value]);
  function commit() {
    const t = text.trim();
    const n = t === "" ? 0 : Number(t);
    if (!Number.isFinite(n) || n < 0) {
      setText(fmtNum(value));
      toast.error("Enter a number (0 or more).");
      return;
    }
    if (n !== value) onCommit(n);
    else setText(fmtNum(value));
  }
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(fmtNum(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn("num h-8 w-[4.5rem] px-2 text-right text-[12px]", className)}
    />
  );
}

function CommentCell({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <>
      <Input
        aria-label="Comment"
        list="payroll-comments"
        disabled={disabled}
        value={text}
        placeholder="—"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== value && onCommit(text.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 w-40 px-2 text-[12px]"
      />
    </>
  );
}

function ContractBadge({ status }: { status: string | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const tone =
    status === "Active"
      ? "bg-success-soft text-success border-success/25"
      : status === "Need P45"
        ? "bg-warning-soft text-warning border-warning/25"
        : "bg-muted text-muted-foreground border-border-strong";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        tone,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

/* ------------------------------ column groups ------------------------------ */

interface Col {
  key: string;
  label: string;
  /** needs the "staff" permission (personal / banking data) */
  sensitive?: boolean;
  align?: "left" | "right";
  render: (s: PayrollSheetStaff) => ReactNode;
}
const dash = (v: string | undefined) => v || <span className="text-muted-foreground">—</span>;

const PERSONAL: Col[] = [
  { key: "dob", label: "DOB", sensitive: true, render: (s) => dash(displayDate(s.dob)) },
  { key: "age", label: "Age", sensitive: true, align: "right", render: (s) => ageFromDob(s.dob) },
  { key: "gender", label: "Gender", render: (s) => dash(s.gender) },
  { key: "rtw", label: "RTW Share Code", sensitive: true, render: (s) => dash(s.rtwShareCode) },
  {
    key: "exp",
    label: "Share code Expiry",
    sensitive: true,
    render: (s) => {
      const st = shareCodeState(s);
      return (
        <span
          className={cn(
            st === "expired" && "font-semibold text-destructive",
            st === "soon" && "font-semibold text-warning",
          )}
        >
          {dash(displayDate(s.shareCodeExpiry))}
        </span>
      );
    },
  },
  { key: "ni", label: "NI Number", sensitive: true, render: (s) => dash(s.ni) },
  { key: "addr", label: "Address", sensitive: true, render: (s) => dash(s.address) },
  { key: "town", label: "Town", sensitive: true, render: (s) => dash(s.town) },
  { key: "pc", label: "Post Code", sensitive: true, render: (s) => dash(s.postCode) },
  { key: "uni", label: "Uniform", sensitive: true, render: (s) => dash(s.uniform) },
];
const BANKING: Col[] = [
  {
    key: "ah",
    label: "Account Holder Name",
    sensitive: true,
    render: (s) => dash(s.accountHolderName),
  },
  { key: "an", label: "Account Number", sensitive: true, render: (s) => dash(s.accountNumber) },
  { key: "sc", label: "Sort Code", sensitive: true, render: (s) => dash(s.sortCode) },
];
const CONTRACT: Col[] = [
  {
    key: "sd",
    label: "Start Date",
    sensitive: true,
    render: (s) => dash(displayDate(s.employmentStartDate)),
  },
  {
    key: "ed",
    label: "End Date",
    sensitive: true,
    render: (s) => dash(displayDate(s.employmentEndDate)),
  },
  { key: "st", label: "Status", render: (s) => <ContractBadge status={s.contractStatus} /> },
  { key: "em", label: "Email", sensitive: true, render: (s) => dash(s.email) },
  {
    key: "im",
    label: "Immigration Status",
    sensitive: true,
    render: (s) => dash(s.immigrationStatus),
  },
  { key: "ha", label: "Hours of Work Allowed", render: (s) => dash(s.hoursAllowed) },
];
const SIA: Col[] = [
  { key: "sia", label: "SIA Number", sensitive: true, render: (s) => dash(s.siaNumber) },
  { key: "role", label: "Role", render: (s) => dash(s.role) },
  { key: "svc", label: "Services Type", render: (s) => dash(s.serviceType) },
];

const GROUPS = [
  { id: "personal", label: "Personal", cols: PERSONAL },
  { id: "banking", label: "Banking", cols: BANKING },
  { id: "contract", label: "Contract status", cols: CONTRACT },
  { id: "sia", label: "SIA", cols: SIA },
] as const;
type GroupId = (typeof GROUPS)[number]["id"];

/* --------------------------------- page --------------------------------- */

interface Row {
  line: PayrollLine;
  staff: PayrollSheetStaff;
  link: CompanyStaffLink | undefined;
  totals: ReturnType<typeof lineTotals>;
  warnings: LineWarning[];
}

function PayrollPageContent() {
  const { can } = usePermissions();
  const refresh = useRefreshPayroll();

  const companiesQ = useSheetCompanies();
  const companies = useMemo(() => companiesQ.data ?? [], [companiesQ.data]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => {
    if (companies.length === 0) return;
    if (!companyId || !companies.some((c) => c.id === companyId)) {
      setCompanyId((companies.find((c) => c.active) ?? companies[0])?.id ?? null);
    }
  }, [companies, companyId]);

  const sheetsQ = usePayrollSheets(companyId);
  const sheets = useMemo(() => sheetsQ.data ?? [], [sheetsQ.data]);
  const [sheetId, setSheetId] = useState<string | null>(null);
  useEffect(() => {
    if (sheetsQ.isLoading) return;
    if (sheets.length === 0) return setSheetId(null);
    if (!sheetId || !sheets.some((s) => s.id === sheetId)) setSheetId(sheets[0]?.id ?? null);
  }, [sheets, sheetId, sheetsQ.isLoading]);

  const sheetQ = usePayrollSheet(sheetId);
  const data = sheetQ.data;
  const locked = data?.sheet.status === "closed";
  const canEdit = can("payroll", "edit") && !locked;
  const canApprove = can("payroll", "approve");
  const canSeeDetails = data?.canSeeStaffDetails ?? false;

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [onlyWarn, setOnlyWarn] = useState(false);
  const [shown, setShown] = useState<Record<GroupId, boolean>>({
    personal: false,
    banking: false,
    contract: true,
    sia: false,
  });

  const [showCompanies, setShowCompanies] = useState(false);
  const [showNewMonth, setShowNewMonth] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const [editStaffId, setEditStaffId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "close" | "delete" | "reopen" | "push">(null);
  const [removeLine, setRemoveLine] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.staff.map((s) => [s.id, s]));
    const links = new Map(data.links.map((l) => [l.staffId, l]));
    const dupes = duplicateNis(data.staff);
    const out: Row[] = [];
    for (const line of data.lines) {
      const staff = byId.get(line.staffId);
      if (!staff) continue;
      const warnings = lineWarnings(line, staff, data.sheet.month, data.canSeeStaffDetails);
      if (data.canSeeStaffDetails && staff.ni && dupes.has(normNi(staff.ni)))
        warnings.push({ severity: "error", text: "Same NI number as another staff record" });
      out.push({ line, staff, link: links.get(line.staffId), totals: lineTotals(line), warnings });
    }
    return out.sort((a, b) => a.staff.name.localeCompare(b.staff.name));
  }, [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ni = normNi(q);
    return rows.filter((r) => {
      if (statusFilter !== ALL && (r.staff.contractStatus ?? "Active") !== statusFilter)
        return false;
      if (onlyWarn && r.warnings.length === 0) return false;
      if (!needle) return true;
      return (
        r.staff.name.toLowerCase().includes(needle) ||
        (ni.length >= 3 && normNi(r.staff.ni).includes(ni))
      );
    });
  }, [rows, q, statusFilter, onlyWarn]);

  const allTotals = useMemo(() => sumLines(rows.map((r) => r.line)), [rows]);
  const totals = useMemo(() => sumLines(filtered.map((r) => r.line)), [filtered]);
  const warnCount = rows.filter((r) => r.warnings.length > 0).length;
  const filtersOn = q.trim() !== "" || statusFilter !== ALL || onlyWarn;
  const statusCount = (s: string) =>
    rows.filter((r) => (r.staff.contractStatus ?? "Active") === s).length;

  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    cols: g.cols.filter((c) => canSeeDetails || !c.sensitive),
  })).filter((g) => g.cols.length > 0 && shown[g.id]);

  const company = data?.company ?? companies.find((c) => c.id === companyId);
  const statusRow = rows.find((r) => r.staff.id === statusFor) ?? null;
  const editStaff = data?.staff.find((s) => s.id === editStaffId) ?? null;

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

  async function saveLine(
    id: string,
    patch: Parameters<typeof updatePayrollLine>[0]["data"]["patch"],
  ) {
    try {
      await updatePayrollLine({ data: { id, patch } });
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save."));
      await refresh();
    }
  }

  const next = data ? NEXT[data.sheet.status] : null;
  const canAdvance = next ? (next.approve ? canApprove : can("payroll", "edit")) : false;
  const detailColCount = visibleGroups.reduce((n, g) => n + g.cols.length, 0);

  async function copySnippet() {
    const list = rows.filter((r) => r.totals.amount !== 0);
    if (list.length === 0) {
      toast.error("Nothing to copy yet — no amounts on this sheet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(
        salaryPasteSnippet(list.map((r) => ({ staff: r.staff, line: r.line }))),
      );
      toast.success(
        `Copied ${list.length} rows (NI, name, hours, amount) — paste into the Salary Sheet payroll import.`,
      );
    } catch {
      toast.error("Could not access the clipboard.");
    }
  }

  async function exportXlsx() {
    if (!data || !company) return;
    try {
      await exportPayrollWorkbook(
        company.name,
        [
          {
            month: data.sheet.month,
            rows: filtered.map((r) => ({ line: r.line, staff: r.staff })),
          },
        ],
        canSeeDetails,
      );
    } catch (e) {
      toast.error(errorMessage(e, "Export failed."));
    }
  }

  /* ------------------------------ empty states ------------------------------ */

  if (companiesQ.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-5">
      <datalist id="payroll-comments">
        {PAYROLL_COMMENTS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Payroll Sheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One sheet per payroll company per month — hours, rate, amount and staff details.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={companyId ?? ""}
            onValueChange={(v) => {
              setCompanyId(v);
              setSheetId(null);
            }}
            disabled={companies.length === 0}
          >
            <SelectTrigger className="h-9 w-52">
              <SelectValue placeholder="No payroll company" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (archived)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sheetId ?? ""} onValueChange={setSheetId} disabled={sheets.length === 0}>
            <SelectTrigger className="h-9 w-52">
              <SelectValue placeholder="No months yet" />
            </SelectTrigger>
            <SelectContent>
              {sheets.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {formatMonthLabel(s.month)} · {s.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {can("payroll", "create") && company ? (
            <Button onClick={() => setShowNewMonth(true)}>
              <Plus className="size-4" /> New month
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setShowCompanies(true)}>
            <Building2 className="size-4" /> Companies
          </Button>
        </div>
      </div>

      {companies.length === 0 ? (
        <Panel>
          <EmptyState
            title="No payroll company yet"
            description="Add your first payroll company — each one gets its own monthly payroll sheet."
          />
          {can("payroll", "create") ? (
            <div className="flex justify-center pb-8">
              <Button onClick={() => setShowCompanies(true)}>
                <Plus className="size-4" /> Add payroll company
              </Button>
            </div>
          ) : null}
        </Panel>
      ) : sheets.length === 0 && !sheetsQ.isLoading ? (
        <Panel>
          <EmptyState
            title={`No months for ${company?.name ?? "this company"} yet`}
            description="Start a month — active staff of this company are copied in with 0 hours."
          />
          {can("payroll", "create") ? (
            <div className="flex justify-center pb-8">
              <Button onClick={() => setShowNewMonth(true)}>
                <Plus className="size-4" /> Start first month
              </Button>
            </div>
          ) : null}
        </Panel>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">
          {sheetQ.isError ? errorMessage(sheetQ.error, "Could not load this sheet.") : "Loading…"}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold">
                {data.company.name} — {formatMonthLabel(data.sheet.month)}
              </h2>
              <PeriodStatusBadge status={data.sheet.status} />
              {locked ? <Lock className="size-4 text-muted-foreground" /> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <Button size="sm" onClick={() => setShowAdd(true)}>
                  <UserPlus className="size-4" /> Add staff
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={exportXlsx}
                disabled={filtered.length === 0}
              >
                <Download className="size-4" /> Export Excel{filtersOn ? " (filtered)" : ""}
              </Button>
              <Button variant="outline" size="sm" onClick={copySnippet}>
                <Copy className="size-4" /> Copy for Salary Sheet
              </Button>
              {canApprove && can("salary", "edit") ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || rows.length === 0}
                  onClick={() => setConfirm("push")}
                >
                  <FileSpreadsheet className="size-4" /> Send to Salary Sheet
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
                            setPayrollSheetStatus({
                              data: { sheetId: data.sheet.id, status: next.to },
                            }),
                          `Marked ${next.to}.`,
                        )
                  }
                >
                  <ShieldCheck className="size-4" /> {next.label}
                </Button>
              ) : null}
              {locked && canApprove ? (
                <Button variant="outline" size="sm" onClick={() => setConfirm("reopen")}>
                  <Unlock className="size-4" /> Reopen
                </Button>
              ) : null}
              {!locked && can("payroll", "delete") ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setConfirm("delete")}
                  aria-label="Delete this sheet"
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Total working hours"
              value={hrs(allTotals.totalHours)}
              sublabel={`${hrs(allTotals.unitsHours)} units + ${hrs(allTotals.bankHolidayHours)} bank holiday`}
              icon={FileSpreadsheet}
            />
            <SummaryCard
              label="Total amount"
              value={formatMoney(allTotals.amount)}
              sublabel={`${formatMoney(data.company.defaultRate)}/hr company rate`}
              tone="success"
            />
            <SummaryCard
              label="Staff on sheet"
              value={String(allTotals.lines)}
              sublabel={`${statusCount("Active")} active · ${statusCount("Need P45")} need P45 · ${statusCount("P45")} P45`}
              icon={IdCard}
            />
            <SummaryCard
              label="Needs attention"
              value={String(warnCount)}
              sublabel={warnCount ? "lines with a warning" : "all clear"}
              tone={warnCount ? "warning" : "default"}
              icon={AlertTriangle}
            />
          </div>

          <Panel>
            <PanelHeader
              title={`Payroll — ${filtered.length} of ${rows.length} staff`}
              description={
                canSeeDetails
                  ? "Hours, rate and comment save as you type. Total hours and amount are calculated."
                  : "Personal and bank columns need the Staff permission."
              }
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      className="h-9 w-48 pl-8"
                      placeholder="Search name or NI"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Need P45">Need P45</SelectItem>
                      <SelectItem value="P45">P45</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Checkbox checked={onlyWarn} onCheckedChange={(v) => setOnlyWarn(v === true)} />
                    Warnings only
                  </label>
                </div>
              }
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Columns
              </span>
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setShown((s) => ({ ...s, [g.id]: !s[g.id] }))}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    shown[g.id]
                      ? "border-primary/30 bg-info-soft text-primary"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title="No staff on this sheet"
                {...(canEdit
                  ? {
                      description: "Use “Add staff” to pick existing staff or create a new person.",
                    }
                  : {})}
              />
            ) : (
              <TableWrap>
                <Table className="min-w-[1100px]">
                  <THead>
                    <tr className="text-[10px] font-bold uppercase tracking-wide">
                      <th className="sticky left-0 z-20 bg-surface-muted" />
                      <th
                        colSpan={7}
                        className="border-l border-border bg-info-soft px-3 py-1 text-center text-primary"
                      >
                        Employment
                      </th>
                      {visibleGroups.map((g) => (
                        <th
                          key={g.id}
                          colSpan={g.cols.length}
                          className="border-l border-border px-3 py-1 text-center text-muted-foreground"
                        >
                          {g.label}
                        </th>
                      ))}
                      <th className="border-l border-border" />
                    </tr>
                    <TR className="h-9">
                      <TH className="sticky left-0 z-20 min-w-[220px] bg-surface-muted">
                        Employee name
                      </TH>
                      <TH align="right">Units (hours)</TH>
                      <TH align="right">Bank holiday hrs</TH>
                      <TH align="right">Holiday entitlement</TH>
                      <TH align="right">Total hours</TH>
                      <TH>Comment</TH>
                      <TH align="right">Rate</TH>
                      <TH align="right">Amount</TH>
                      {visibleGroups.flatMap((g) =>
                        g.cols.map((c) => (
                          <TH key={`${g.id}-${c.key}`} align={c.align ?? "left"}>
                            {c.label}
                          </TH>
                        )),
                      )}
                      <TH align="right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => {
                      const dim = r.staff.contractStatus === "P45" || r.link?.active === false;
                      return (
                        <TR key={r.line.id} className={cn(dim && "opacity-70")}>
                          <TD className="sticky left-0 z-10 bg-background">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{r.staff.name}</span>
                              {r.warnings.length > 0 ? (
                                <span
                                  title={r.warnings.map((w) => w.text).join("\n")}
                                  className={cn(
                                    "inline-flex",
                                    r.warnings.some((w) => w.severity === "error")
                                      ? "text-destructive"
                                      : "text-warning",
                                  )}
                                >
                                  <AlertTriangle className="size-3.5" />
                                </span>
                              ) : null}
                              {r.link?.active === false ? (
                                <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                                  inactive here
                                </span>
                              ) : null}
                            </div>
                          </TD>
                          <TD align="right">
                            <NumCell
                              label={`Units for ${r.staff.name}`}
                              value={r.line.unitsHours}
                              disabled={!canEdit}
                              onCommit={(n) => saveLine(r.line.id, { unitsHours: n })}
                            />
                          </TD>
                          <TD align="right">
                            <NumCell
                              label={`Bank holiday hours for ${r.staff.name}`}
                              value={r.line.bankHolidayHours}
                              disabled={!canEdit}
                              onCommit={(n) => saveLine(r.line.id, { bankHolidayHours: n })}
                            />
                          </TD>
                          <TD align="right">
                            <NumCell
                              label={`Holiday entitlement for ${r.staff.name}`}
                              value={r.line.holidayEntitlement}
                              disabled={!canEdit}
                              onCommit={(n) => saveLine(r.line.id, { holidayEntitlement: n })}
                            />
                          </TD>
                          <TD align="right" mono className="font-semibold">
                            {hrs(r.totals.totalHours)}
                          </TD>
                          <TD>
                            <CommentCell
                              value={r.line.comment}
                              disabled={!canEdit}
                              onCommit={(v) => saveLine(r.line.id, { comment: v })}
                            />
                          </TD>
                          <TD align="right">
                            <NumCell
                              label={`Rate for ${r.staff.name}`}
                              value={r.line.rate}
                              disabled={!canEdit}
                              onCommit={(n) => saveLine(r.line.id, { rate: n })}
                            />
                          </TD>
                          <TD align="right" mono className="font-semibold">
                            {formatMoney(r.totals.amount)}
                          </TD>
                          {visibleGroups.flatMap((g) =>
                            g.cols.map((c) => (
                              <TD key={`${g.id}-${c.key}`} align={c.align ?? "left"}>
                                {c.render(r.staff)}
                              </TD>
                            )),
                          )}
                          <TD align="right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Status, rate and active in this company"
                                onClick={() => setStatusFor(r.staff.id)}
                              >
                                <ShieldCheck className="size-3.5" />
                              </Button>
                              {canSeeDetails && can("staff", "edit") ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Edit staff details"
                                  onClick={() => setEditStaffId(r.staff.id)}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              ) : null}
                              {!locked && can("payroll", "delete") ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  title="Remove from this month"
                                  onClick={() => setRemoveLine(r)}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                    <TR className="h-10 bg-surface-muted font-semibold hover:bg-surface-muted">
                      <TD className="sticky left-0 z-10 bg-surface-muted">
                        Total{filtersOn ? " (filtered)" : ""}
                      </TD>
                      <TD align="right" mono>
                        {hrs(totals.unitsHours)}
                      </TD>
                      <TD align="right" mono>
                        {hrs(totals.bankHolidayHours)}
                      </TD>
                      <TD />
                      <TD align="right" mono>
                        {hrs(totals.totalHours)}
                      </TD>
                      <TD />
                      <TD />
                      <TD align="right" mono>
                        {formatMoney(totals.amount)}
                      </TD>
                      {detailColCount > 0 ? <TD colSpan={detailColCount} /> : null}
                      <TD />
                    </TR>
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Panel>
        </>
      )}

      {/* dialogs */}
      <PayrollCompanyDialog
        open={showCompanies}
        onOpenChange={setShowCompanies}
        companies={companies}
        canCreate={can("payroll", "create")}
        canEdit={can("payroll", "edit")}
        onCreated={(c) => {
          setCompanyId(c.id);
          setSheetId(null);
        }}
      />

      {company ? (
        <NewMonthDialog
          open={showNewMonth}
          onOpenChange={setShowNewMonth}
          companyId={company.id}
          companyName={company.name}
          existing={sheets.map((s) => s.month)}
          onCreated={(id) => setSheetId(id)}
        />
      ) : null}

      {data ? (
        <>
          <AddStaffDialog
            open={showAdd}
            onOpenChange={setShowAdd}
            sheetId={data.sheet.id}
            companyName={data.company.name}
            defaultRate={data.company.defaultRate}
            canCreateStaff={can("staff", "create")}
          />
          <StaffStatusDialog
            open={statusFor !== null}
            onOpenChange={(v) => !v && setStatusFor(null)}
            staff={statusRow?.staff ?? null}
            link={statusRow?.link}
            line={statusRow?.line}
            company={data.company}
            sheetId={data.sheet.id}
            locked={!!locked}
            canEditStaff={can("staff", "edit") && canSeeDetails}
          />
          <StaffDialog
            open={editStaffId !== null}
            onOpenChange={(v) => !v && setEditStaffId(null)}
            staff={editStaff}
            canEdit={can("staff", "edit")}
            onSaved={() => refresh()}
          />
          <ConfirmDialog
            open={confirm === "close"}
            onOpenChange={(v) => !v && setConfirm(null)}
            title="Close this month?"
            description="Closing locks the sheet — no hours, rates or staff can change until it is reopened (needs approve permission)."
            confirmLabel="Close month"
            onConfirm={() => {
              setConfirm(null);
              void run(
                () => setPayrollSheetStatus({ data: { sheetId: data.sheet.id, status: "closed" } }),
                "Month closed.",
              );
            }}
          />
          <ConfirmDialog
            open={confirm === "reopen"}
            onOpenChange={(v) => !v && setConfirm(null)}
            title="Reopen this month?"
            description="The sheet goes back to “verified” and can be edited again."
            confirmLabel="Reopen"
            onConfirm={() => {
              setConfirm(null);
              void run(
                () =>
                  setPayrollSheetStatus({ data: { sheetId: data.sheet.id, status: "verified" } }),
                "Month reopened.",
              );
            }}
          />
          <ConfirmDialog
            open={confirm === "delete"}
            onOpenChange={(v) => !v && setConfirm(null)}
            title="Delete this sheet?"
            description={`This removes ${data.company.name} — ${formatMonthLabel(data.sheet.month)} and all its lines. Staff records are not touched.`}
            confirmLabel="Delete sheet"
            onConfirm={() => {
              setConfirm(null);
              void run(
                () => deletePayrollSheet({ data: { sheetId: data.sheet.id } }),
                "Sheet deleted.",
              ).then(() => setSheetId(null));
            }}
          />
          <ConfirmDialog
            open={confirm === "push"}
            onOpenChange={(v) => !v && setConfirm(null)}
            title="Send to the Salary Sheet?"
            description={`${data.company.name}'s amounts (${formatMoney(allTotals.amount)}) are written into the ${formatMonthLabel(data.sheet.month)} Salary Sheet, in this company's payroll column. Running it again replaces that column with the latest figures.`}
            confirmLabel="Send"
            onConfirm={() => {
              setConfirm(null);
              setBusy(true);
              pushToSalarySheet({ data: { sheetId: data.sheet.id } })
                .then(async (r) => {
                  await refresh();
                  toast.success(
                    `Sent ${r.updated} staff to the ${formatMonthLabel(r.month)} Salary Sheet${r.createdPeriod ? " (month created)" : ""}.`,
                  );
                })
                .catch((e) => toast.error(errorMessage(e, "Could not send.")))
                .finally(() => setBusy(false));
            }}
          />
          <ConfirmDialog
            open={removeLine !== null}
            onOpenChange={(v) => !v && setRemoveLine(null)}
            title="Remove from this month?"
            description={`${removeLine?.staff.name ?? "This person"} is taken off this month's sheet (hours and amount for this month are deleted). They stay in the company and the staff list.`}
            confirmLabel="Remove"
            onConfirm={() => {
              const id = removeLine?.line.id;
              setRemoveLine(null);
              if (id) void run(() => deletePayrollLine({ data: { id } }), "Removed.");
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/* ----------------------------- new month dialog ----------------------------- */

function nextMonthAfter(existing: string[]): string {
  const latest = [...existing].sort().at(-1);
  if (!latest) return currentMonth();
  const [y, m] = latest.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 1970, m ?? 1, 1)); // month index m = following month
  return d.toISOString().slice(0, 7);
}

function NewMonthDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  existing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  companyName: string;
  existing: string[];
  onCreated: (sheetId: string) => void;
}) {
  const refresh = useRefreshPayroll();
  const [month, setMonth] = useState(currentMonth());
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setMonth(nextMonthAfter(existing));
      setCopy(true);
      setError("");
    }
  }, [open, existing]);

  async function create() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return setError("Choose a month.");
    if (existing.includes(month))
      return setError(`${formatMonthLabel(month)} already exists for ${companyName}.`);
    setBusy(true);
    try {
      const s = await createPayrollSheet({ data: { companyId, month, copyStaff: copy } });
      await refresh();
      if (s && !(s instanceof Response)) onCreated(s.id);
      toast.success(`${formatMonthLabel(month)} started.`);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, "Could not create the month."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New month — {companyName}</DialogTitle>
          <DialogDescription>Start the payroll sheet for a new month.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Month">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-[12px] text-muted-foreground">
            <Checkbox checked={copy} onCheckedChange={(v) => setCopy(v === true)} />
            <span>
              Copy this company's active staff with 0 hours (people on a P45 or switched off are
              left out).
            </span>
          </label>
          {error ? (
            <p role="alert" className="text-[12px] font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy}>
            Start month
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
