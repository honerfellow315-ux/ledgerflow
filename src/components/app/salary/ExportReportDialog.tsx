import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/app/Field";
import { Download } from "@/lib/icons";
import { formatMoney } from "@/lib/ledger/calc";
import { formatMonthLabel, round2 } from "@/lib/payroll/calc";
import { errorMessage, useStaffList } from "@/lib/payroll/queries";
import { exportPayrollReport, reportFileName, type ReportRow } from "@/lib/payroll/reportExport";
import type { PayrollCompany, SalaryEntry } from "@/lib/payroll/types";

/**
 * "Export payroll report": one payroll company, the open month, in the
 * All Payroll Format layout. Read-only, so closed months work too. It contains
 * NI numbers and bank details, so the parent only mounts it for users who can
 * view BOTH salary and staff (the staff list comes from a staff-view endpoint).
 */
export function ExportReportDialog({
  open,
  onOpenChange,
  month,
  companies,
  entries,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  month: string;
  companies: PayrollCompany[];
  entries: SalaryEntry[];
}) {
  const staffQ = useStaffList(open);
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

  const company = companies.find((c) => c.id === companyId) ?? null;

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries)
      for (const [id, v] of Object.entries(e.payroll)) if (v !== 0) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [entries]);

  const rows: ReportRow[] = useMemo(() => {
    if (!company || !staffQ.data) return [];
    const byId = new Map(staffQ.data.map((s) => [s.id, s]));
    const out: ReportRow[] = [];
    for (const e of entries) {
      const amount = e.payroll[company.id] ?? 0;
      const staff = byId.get(e.staffId);
      if (amount !== 0 && staff) out.push({ staff, amount });
    }
    return out;
  }, [company, staffQ.data, entries]);

  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const noBank = rows.filter((r) => !r.staff.sortCode || !r.staff.accountNumber).length;
  const noNi = rows.filter((r) => !r.staff.ni.trim()).length;

  async function download() {
    if (!company || rows.length === 0) return;
    setBusy(true);
    try {
      await exportPayrollReport(month, company, rows);
      toast.success(`Downloaded ${reportFileName(company.name, month)}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Export failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export payroll report — {formatMonthLabel(month)}</DialogTitle>
          <DialogDescription>
            One payroll company, in the All Payroll Format layout. Includes everyone with an amount
            for that company this month. Hours and rate are left empty for you to fill in Excel.
          </DialogDescription>
        </DialogHeader>

        <Field label="Payroll company">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a company" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id} disabled={!counts.get(c.id)}>
                  {c.name} ({counts.get(c.id) ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {company ? (
          staffQ.isLoading ? (
            <p className="text-[12px] text-muted-foreground">Loading staff details…</p>
          ) : staffQ.error ? (
            <p role="alert" className="text-[12px] font-medium text-destructive">
              {errorMessage(staffQ.error, "Couldn't load staff details.")}
            </p>
          ) : (
            <div className="space-y-1 rounded-md border border-border bg-surface-muted/60 px-3 py-2 text-[12px] text-muted-foreground">
              <p>
                <strong className="text-foreground">{rows.length}</strong> staff ·{" "}
                <strong className="text-foreground">{formatMoney(total)}</strong> total amount
              </p>
              {noBank > 0 ? (
                <p className="text-warning">{noBank} without sort code / account number.</p>
              ) : null}
              {noNi > 0 ? <p className="text-warning">{noNi} without an NI number.</p> : null}
              <p>File: {reportFileName(company.name, month)}</p>
            </div>
          )
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={download} disabled={busy || !company || rows.length === 0}>
            <Download className="size-4" /> {busy ? "Preparing…" : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
