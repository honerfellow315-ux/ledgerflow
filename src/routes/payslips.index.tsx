import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Search,
  Users,
} from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pill } from "@/components/app/timesheets/badges";
import { PayslipPreviewDialog } from "@/components/app/payslips/PayslipPreviewDialog";
import { getPayslipsForPrint, listPayslips, listPayslipSheets } from "@/lib/actions/payslips";
import { formatMoney } from "@/lib/ledger/calc";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import { maskNi } from "@/lib/timesheets/data";
import { payslipIssue, payslipTotals, type PayslipRow } from "@/lib/payslips/data";
import { printPayslips } from "@/lib/payslips/print";

export const Route = createFileRoute("/payslips/")({
  head: () => ({
    meta: [
      { title: "Payslips — LedgerFlow" },
      { name: "description", content: "Check and download a payslip for every member of staff." },
    ],
  }),
  component: PayslipsPage,
});

function PayslipsPage() {
  return (
    <RequireView module="payroll">
      <PayslipsContent />
    </RequireView>
  );
}

const PAGE_SIZE = 50;
/** "Download all" prints this many payslips at most in one go. */
const PRINT_MAX = 1000;
const PRINT_STEP = 50;

function PayslipsContent() {
  const { can, ready } = usePermissions();
  const allowed = can("payroll", "view") && can("staff", "view");

  const [companyId, setCompanyId] = useState("");
  const [month, setMonth] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const sheetsQ = useQuery({
    queryKey: ["payslips", "sheets"],
    queryFn: () => unwrap(listPayslipSheets()),
    enabled: ready && allowed,
  });
  const options = useMemo(() => sheetsQ.data ?? [], [sheetsQ.data]);

  const companies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of options) if (!seen.has(o.companyId)) seen.set(o.companyId, o.companyName);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [options]);
  const activeCompany = companies.some((c) => c.id === companyId)
    ? companyId
    : (options[0]?.companyId ?? "");
  const months = options.filter((o) => o.companyId === activeCompany);
  const activeSheet = months.find((o) => o.month === month) ?? months[0] ?? null;

  const listQ = useQuery({
    queryKey: ["payslips", "list", activeSheet?.sheetId, search, page],
    queryFn: () =>
      unwrap(
        listPayslips({
          data: { sheetId: activeSheet?.sheetId ?? "", search, page, pageSize: PAGE_SIZE },
        }),
      ),
    enabled: ready && allowed && activeSheet !== null,
    placeholderData: keepPreviousData,
  });
  const data = listQ.data;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sum = data?.summary;

  if (!ready) return null;
  if (!allowed) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Payslips show NI numbers, so you need to see both the Payroll Sheet and Staff."
        />
      </Panel>
    );
  }

  const resetPick = () => {
    setPicked(new Set());
    setPage(1);
  };
  const allPicked = rows.length > 0 && rows.every((p) => picked.has(p.id));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err, fallback));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const titleOf = () =>
    `Payslips ${activeSheet?.companyName ?? ""} ${formatMonthLabel(activeSheet?.month ?? "")}`.trim();

  const printOne = (row: PayslipRow) =>
    run(async () => {
      await printPayslips([row], `Payslip ${row.name} ${formatMonthLabel(row.month)}`);
    }, "The payslip could not be made.");

  const printSelected = () =>
    run(async () => {
      if (!activeSheet) return;
      const ids = [...picked];
      const all: PayslipRow[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        setProgress(`Getting payslips ${Math.min(i + 100, ids.length)} of ${ids.length}…`);
        all.push(
          ...(await unwrap(
            getPayslipsForPrint({
              data: { sheetId: activeSheet.sheetId, ids: ids.slice(i, i + 100) },
            }),
          )),
        );
      }
      await printPayslips(all, titleOf());
    }, "The payslips could not be made.");

  const printAll = () =>
    run(async () => {
      if (!activeSheet) return;
      const count = Math.min(sum?.count ?? 0, PRINT_MAX);
      const all: PayslipRow[] = [];
      for (let offset = 0; offset < count; offset += PRINT_STEP) {
        setProgress(`Getting payslips ${Math.min(offset + PRINT_STEP, count)} of ${count}…`);
        all.push(
          ...(await unwrap(
            getPayslipsForPrint({
              data: { sheetId: activeSheet.sheetId, ids: [], offset, limit: PRINT_STEP },
            }),
          )),
        );
      }
      await printPayslips(all, titleOf());
      if ((sum?.count ?? 0) > PRINT_MAX) {
        toast.info(
          `Only the first ${PRINT_MAX} payslips were printed. Pick the rest with the tick boxes.`,
        );
      }
    }, "The payslips could not be made.");

  const notFinal =
    activeSheet !== null && activeSheet.status !== "verified" && activeSheet.status !== "closed";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Payslips</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One payslip for every member of staff, taken straight from the Payroll sheet.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={busy || (sum?.count ?? 0) === 0}
            onClick={() => void printAll()}
          >
            <Download className="size-4" /> Download all
          </Button>
          <Button disabled={busy || picked.size === 0} onClick={() => void printSelected()}>
            <Download className="size-4" /> Download selected
            {picked.size ? ` (${picked.size})` : ""}
          </Button>
        </div>
      </div>

      {progress ? <p className="text-[13px] text-muted-foreground">{progress}</p> : null}

      {notFinal ? (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] text-foreground"
        >
          <Info className="mt-0.5 size-4 text-warning" aria-hidden="true" />
          <p>
            This Payroll sheet is still <strong>{activeSheet?.status}</strong> (not verified yet),
            so the figures can still change. Check it before you give payslips out.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Payslips"
          value={String(sum?.count ?? 0)}
          sublabel={activeSheet ? formatMonthLabel(activeSheet.month) : ""}
          icon={Users}
        />
        <SummaryCard label="Total pay" value={formatMoney(sum?.totalPay ?? 0)} icon={Banknote} />
        <SummaryCard label="Total hours" value={`${Number((sum?.totalHours ?? 0).toFixed(2))} h`} />
        <SummaryCard
          label="Need a look"
          value={String(sum?.needLook ?? 0)}
          sublabel={sum?.needLook ? "Fix before giving out" : "All ready"}
          icon={AlertTriangle}
          tone={sum?.needLook ? "warning" : "success"}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Staff payslips"
          description={`${total} of ${sum?.count ?? 0} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={activeCompany}
                onValueChange={(v) => {
                  setCompanyId(v);
                  resetPick();
                }}
              >
                <SelectTrigger className="h-9 w-52">
                  <SelectValue placeholder="Company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={activeSheet?.month ?? ""}
                onValueChange={(v) => {
                  setMonth(v);
                  resetPick();
                }}
              >
                <SelectTrigger className="h-9 w-40">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.sheetId} value={m.month}>
                      {formatMonthLabel(m.month)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search staff"
                  className="h-9 w-40 pl-8"
                />
              </div>
            </div>
          }
        />
        {sheetsQ.isLoading || (activeSheet !== null && listQ.isLoading) ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : sheetsQ.isError || listQ.isError ? (
          <EmptyState
            title="The payslips could not be loaded"
            description={errorMessage(sheetsQ.error ?? listQ.error, "Please try again.")}
          />
        ) : activeSheet === null ? (
          <EmptyState
            title="No payroll sheets yet"
            description="Create a month in the Payroll Sheet first, then come back here."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={(sum?.count ?? 0) === 0 ? "This sheet has no staff" : "No staff found"}
            description={
              (sum?.count ?? 0) === 0
                ? "Add staff to the Payroll sheet first."
                : "Try another name."
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table className="min-w-[860px]">
                <THead>
                  <TR>
                    <TH>
                      <Checkbox
                        aria-label="Select all on this page"
                        checked={allPicked}
                        onCheckedChange={(v) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            for (const p of rows) {
                              if (v === true) next.add(p.id);
                              else next.delete(p.id);
                            }
                            return next;
                          })
                        }
                      />
                    </TH>
                    <TH>Staff</TH>
                    <TH>NI</TH>
                    <TH align="right">Hours</TH>
                    <TH align="right">Total pay</TH>
                    <TH>Status</TH>
                    <TH align="right">Payslip</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((p, i) => {
                    const t = payslipTotals(p);
                    const issue = payslipIssue(p);
                    return (
                      <TR key={p.id} onClick={() => setOpenIndex(i)}>
                        <TD>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              aria-label={`Select ${p.name}`}
                              checked={picked.has(p.id)}
                              onCheckedChange={() => toggle(p.id)}
                            />
                          </div>
                        </TD>
                        <TD className="font-medium">{p.name}</TD>
                        <TD mono>{maskNi(p.ni)}</TD>
                        <TD align="right" mono>
                          {p.fixedAmount !== null
                            ? "Fixed"
                            : `${Number(t.totalHours.toFixed(2))} h`}
                        </TD>
                        <TD align="right" mono>
                          {formatMoney(t.amount)}
                        </TD>
                        <TD>
                          {issue ? (
                            <Pill tone="warn">{issue}</Pill>
                          ) : (
                            <Pill tone="good">Ready</Pill>
                          )}
                        </TD>
                        <TD align="right">
                          <div
                            className="flex justify-end gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button size="sm" variant="outline" onClick={() => setOpenIndex(i)}>
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              aria-label={`Download payslip for ${p.name}`}
                              onClick={() => void printOne(p)}
                            >
                              <Download className="size-3.5" />
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
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

      <PayslipPreviewDialog
        rows={rows}
        index={openIndex}
        onIndex={setOpenIndex}
        onClose={() => setOpenIndex(null)}
        busy={busy}
        onDownload={(r) => void printOne(r)}
      />
    </div>
  );
}
