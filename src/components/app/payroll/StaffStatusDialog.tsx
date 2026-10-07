import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/app/Field";
import { updateCompanyStaff, updatePayrollLine } from "@/lib/actions/payroll";
import { errorMessage } from "@/lib/payroll/queries";
import { useRefreshPayroll } from "@/lib/payroll/sheetQueries";
import { lineTotals } from "@/lib/payroll/sheetCalc";
import { CONTRACT_STATUSES, type ContractStatus } from "@/lib/payroll/types";
import type {
  CompanyStaffLink,
  PayrollLine,
  PayrollSheetCompany,
  PayrollSheetStaff,
} from "@/lib/payroll/sheetTypes";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Status & company settings for one person on this sheet:
 *  - contract status (Active -> Need P45 -> P45, with an end date) and Reinstate
 *  - active / inactive inside THIS company (so next month they are not copied across)
 *  - own hourly rate for this company
 * The sheet's Comment is set automatically ("Request for P45", "Reinstate") when it applies.
 */
export function StaffStatusDialog({
  open,
  onOpenChange,
  staff,
  link,
  line,
  company,
  sheetId,
  locked,
  canEditStaff,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  staff: PayrollSheetStaff | null;
  link: CompanyStaffLink | undefined;
  line: PayrollLine | undefined;
  company: PayrollSheetCompany;
  sheetId: string;
  locked: boolean;
  /** needs the "staff" edit permission — contract status lives on the staff record */
  canEditStaff: boolean;
}) {
  const refresh = useRefreshPayroll();
  const [status, setStatus] = useState<ContractStatus | "">("");
  const [endDate, setEndDate] = useState("");
  const [activeHere, setActiveHere] = useState(true);
  const [rate, setRate] = useState("");
  const [applyRate, setApplyRate] = useState(true);
  const [dropLine, setDropLine] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !staff) return;
    setStatus((staff.contractStatus as ContractStatus | undefined) ?? "Active");
    setEndDate(staff.employmentEndDate ?? "");
    setActiveHere(link?.active ?? true);
    setRate(link?.rate != null ? String(link.rate) : "");
    setApplyRate(true);
    setDropLine(true);
    setError("");
  }, [open, staff, link]);

  if (!staff) return null;
  const prevStatus = (staff.contractStatus as ContractStatus | undefined) ?? "Active";
  const hasHours = line ? lineTotals(line).totalHours > 0 : false;

  async function save() {
    if (!staff) return;
    const rateNum = rate.trim() === "" ? null : Number(rate);
    if (rateNum !== null && (!Number.isFinite(rateNum) || rateNum < 0))
      return setError("Enter a valid rate or leave it blank to use the company rate.");
    if (status === "P45" && !endDate) return setError("A P45 needs an end date.");

    setBusy(true);
    try {
      let comment: string | undefined;
      // Contract status and end date are saved for THIS company only, so reinstating or ending
      // someone here never changes their status in another company.
      const statusChanged =
        canEditStaff &&
        Boolean(status) &&
        (status !== prevStatus || endDate !== (staff.employmentEndDate ?? ""));
      if (statusChanged) {
        if (status === "Need P45" && prevStatus !== "Need P45") comment = "Request for P45";
        if (status === "Active" && prevStatus !== "Active") comment = "Reinstate";
      }

      const leaving = !activeHere && (link?.active ?? true);
      const rateChanged = (link?.rate ?? null) !== rateNum;
      const activeChanged = (link?.active ?? true) !== activeHere;
      if (link && (rateChanged || activeChanged || statusChanged)) {
        await updateCompanyStaff({
          data: {
            companyId: company.id,
            staffId: staff.id,
            patch: {
              ...(activeChanged ? { active: activeHere } : {}),
              ...(rateChanged ? { rate: rateNum } : {}),
              ...(statusChanged
                ? {
                    contractStatus: status as ContractStatus,
                    endDate: status === "Active" ? null : endDate || null,
                  }
                : {}),
            },
            ...(rateChanged && applyRate && !locked ? { applyToSheetId: sheetId } : {}),
            ...(leaving && dropLine && !locked ? { removeFromSheetId: sheetId } : {}),
          },
        });
      }
      if (comment && line && !locked) {
        await updatePayrollLine({ data: { id: line.id, patch: { comment } } });
      }
      await refresh();
      toast.success("Saved.");
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, "Could not save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{staff.name}</DialogTitle>
          <DialogDescription>
            Status and settings for {company.name}. Personal and bank details are edited from the
            pencil on the row.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {canEditStaff ? (
            <>
              <Field label="Contract status" hint={`Applies to ${company.name} only.`}>
                <Select
                  value={status || "Active"}
                  onValueChange={(v) => {
                    setStatus(v as ContractStatus);
                    if (v === "P45" && !endDate) setEndDate(today());
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {status !== "Active" ? (
                <Field
                  label="End date"
                  hint={status === "Need P45" ? "Optional until the P45 is issued." : undefined}
                >
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
              ) : null}
              {prevStatus !== "Active" && status === "Active" ? (
                <p className="rounded-md bg-info-soft px-3 py-2 text-[12px] text-primary">
                  Reinstating — the end date is cleared and the comment is set to “Reinstate”.
                </p>
              ) : null}
            </>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
              Contract status is changed by users with Staff edit access.
            </p>
          )}

          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <div>
              <p className="text-[13px] font-medium">Active in {company.name}</p>
              <p className="text-[11px] text-muted-foreground">
                Off = not copied into next month. Their history stays.
              </p>
            </div>
            <Switch checked={activeHere} onCheckedChange={setActiveHere} />
          </div>
          {!activeHere && (link?.active ?? true) && !locked ? (
            <label className="flex items-start gap-2 text-[12px] text-muted-foreground">
              <Checkbox checked={dropLine} onCheckedChange={(v) => setDropLine(v === true)} />
              <span>
                Also remove from this month’s sheet
                {hasHours ? " (not possible — they have hours on it)" : ""}
              </span>
            </label>
          ) : null}

          <Field label={`Hourly rate (£) — blank = ${company.name} rate (${company.defaultRate})`}>
            <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          {(link?.rate ?? null) !== (rate.trim() === "" ? null : Number(rate)) && !locked ? (
            <label className="flex items-start gap-2 text-[12px] text-muted-foreground">
              <Checkbox checked={applyRate} onCheckedChange={(v) => setApplyRate(v === true)} />
              <span>Apply the new rate to this month’s line too</span>
            </label>
          ) : null}

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
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
