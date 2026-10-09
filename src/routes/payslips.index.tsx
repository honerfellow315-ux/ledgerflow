import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Banknote, Download, Info, Search, Users } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/app/timesheets/badges";
import { PayslipPreviewDialog } from "@/components/app/payslips/PayslipPreviewDialog";
import { formatMoney } from "@/lib/ledger/calc";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { maskNi } from "@/lib/timesheets/data";
import { COMPANIES, buildRun, monthOptions, payslipIssue, payslipTotals } from "@/lib/payslips/data";

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
  // Admin-only while this is a preview, same pattern as Timesheet Check and Tasks.
  return (
    <RequireView module="dashboard">
      <PayslipsContent />
    </RequireView>
  );
}

const MONTHS = monthOptions();

function PayslipsContent() {
  const { isAdmin, ready } = usePermissions();
  const [company, setCompany] = useState(COMPANIES[0]!);
  const [month, setMonth] = useState(MONTHS[1] ?? MONTHS[0]!);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const run = useMemo(() => buildRun(company, month), [company, month]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? run.filter((p) => p.name.toLowerCase().includes(needle)) : run;
  }, [run, q]);

  if (!ready) return null;
  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState title="You don't have access to this" description="Only administrators can open Payslips for now." />
      </Panel>
    );
  }

  const total = run.reduce((a, p) => a + payslipTotals(p).amount, 0);
  const hours = run.reduce((a, p) => a + payslipTotals(p).totalHours, 0);
  const attention = run.filter((p) => payslipIssue(p) !== null).length;
  const allPicked = rows.length > 0 && rows.every((p) => picked.has(p.id));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const preview = () => toast.info("Preview only: the PDF download is connected in the next phase.");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Payslips</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One payslip for every member of staff, taken straight from the Payroll sheet.
          </p>
        </div>
        <Button disabled={picked.size === 0} onClick={preview}>
          <Download className="size-4" /> Download selected{picked.size ? ` (${picked.size})` : ""}
        </Button>
      </div>

      <div
        role="note"
        className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-[13px] text-foreground"
      >
        <Info className="mt-0.5 size-4 text-primary" aria-hidden="true" />
        <p>This is a preview with sample people and hours. Nothing here is saved or sent.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Payslips" value={String(run.length)} sublabel={formatMonthLabel(month)} icon={Users} />
        <SummaryCard label="Total pay" value={formatMoney(total)} icon={Banknote} />
        <SummaryCard label="Total hours" value={`${Number(hours.toFixed(2))} h`} />
        <SummaryCard
          label="Need a look"
          value={String(attention)}
          sublabel={attention ? "Fix before giving out" : "All ready"}
          icon={AlertTriangle}
          tone={attention ? "warning" : "success"}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Staff payslips"
          description={`${rows.length} of ${run.length} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={company} onValueChange={(v) => { setCompany(v); setPicked(new Set()); }}>
                <SelectTrigger className="h-9 w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPANIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={month} onValueChange={(v) => { setMonth(v); setPicked(new Set()); }}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {formatMonthLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff" className="h-9 w-40 pl-8" />
              </div>
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="No staff found" description="Try another name, company or month." />
        ) : (
          <TableWrap>
            <Table className="min-w-[860px]">
              <THead>
                <TR>
                  <TH>
                    <Checkbox
                      aria-label="Select all"
                      checked={allPicked}
                      onCheckedChange={(v) => setPicked(v === true ? new Set(rows.map((p) => p.id)) : new Set())}
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
                {rows.map((p) => {
                  const t = payslipTotals(p);
                  const issue = payslipIssue(p);
                  return (
                    <TR key={p.id} onClick={() => setOpenIndex(rows.indexOf(p))}>
                      <TD>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Checkbox aria-label={`Select ${p.name}`} checked={picked.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                        </div>
                      </TD>
                      <TD className="font-medium">{p.name}</TD>
                      <TD mono>{maskNi(p.ni)}</TD>
                      <TD align="right" mono>
                        {p.fixedAmount !== null ? "Fixed" : `${Number(t.totalHours.toFixed(2))} h`}
                      </TD>
                      <TD align="right" mono>
                        {formatMoney(t.amount)}
                      </TD>
                      <TD>{issue ? <Pill tone="warn">{issue}</Pill> : <Pill tone="good">Ready</Pill>}</TD>
                      <TD align="right">
                        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" onClick={() => setOpenIndex(rows.indexOf(p))}>
                            View
                          </Button>
                          <Button size="sm" variant="outline" aria-label={`Download payslip for ${p.name}`} onClick={preview}>
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
        )}
      </Panel>

      <PayslipPreviewDialog rows={rows} index={openIndex} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} />
    </div>
  );
}
