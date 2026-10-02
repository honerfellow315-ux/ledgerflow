import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "@/lib/icons";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/app/Field";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { PayStatusBadge } from "@/components/app/salary/badges";
import { EarningsBreakdown } from "@/components/app/salary/EarningsBreakdown";
import { useLedger } from "@/lib/ledger/store";
import { formatDate, formatMoney } from "@/lib/ledger/calc";
import {
  addSalaryPayment,
  deleteEntry,
  deleteSalaryPayment,
  updateEntry,
} from "@/lib/actions/salary";
import {
  amountForHours,
  computeEntry,
  round2,
  splitHours,
  type SheetRow,
} from "@/lib/payroll/calc";
import { amountToInput, errorMessage, parseAmount, useRefreshSalary } from "@/lib/payroll/queries";
import type { CheckStatus, PayrollCompany, SalaryEntry } from "@/lib/payroll/types";

const today = () => new Date().toISOString().slice(0, 10);

interface FormState {
  rssAmount: string;
  rssHours: string;
  essAmount: string;
  essHours: string;
  carryForward: string;
  taxDeduction: string;
  deduction: string;
  deductionNote: string;
  checkStatus: CheckStatus;
  flag: string;
  payroll: Record<string, string>;
  /** Hours sent to payroll. Empty = not decided yet; "0" = all cash. */
  payrollHours: string;
}

const fromEntry = (e: SalaryEntry): FormState => ({
  rssAmount: amountToInput(e.rssAmount),
  rssHours: amountToInput(e.rssHours),
  essAmount: amountToInput(e.essAmount),
  essHours: amountToInput(e.essHours),
  carryForward: amountToInput(e.carryForward),
  taxDeduction: amountToInput(e.taxDeduction),
  deduction: amountToInput(e.deduction),
  deductionNote: e.deductionNote ?? "",
  checkStatus: e.checkStatus,
  flag: e.flag,
  payroll: Object.fromEntries(Object.entries(e.payroll).map(([k, v]) => [k, amountToInput(v)])),
  payrollHours: e.payrollHours === undefined ? "" : String(e.payrollHours),
});

export function EntryDialog({
  open,
  onOpenChange,
  row,
  companies,
  locked,
  canDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Always the LIVE row from the sheet, so payments added here show up at once. */
  row: SheetRow | null;
  companies: PayrollCompany[];
  locked: boolean;
  canDelete: boolean;
}) {
  const refresh = useRefreshSalary();
  const { data } = useLedger();
  const methods = data.settings?.paymentMethods?.length
    ? data.settings.paymentMethods
    : ["Bank Transfer", "Cash", "Other"];

  const entryId = row?.entry.id;
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pay, setPay] = useState({
    date: today(),
    amount: "",
    method: "Bank Transfer",
    reference: "",
  });
  const [payBusy, setPayBusy] = useState(false);

  // Re-initialise only when a different line is opened — NOT whenever the
  // sheet refetches, or adding a payment would wipe what's being typed.
  useEffect(() => {
    if (!open || !row) return;
    setForm(fromEntry(row.entry));
    setPay({ date: today(), amount: "", method: methods[0] ?? "Bank Transfer", reference: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId]);

  const draft: SalaryEntry | null = useMemo(() => {
    if (!row || !form) return null;
    const d: SalaryEntry = {
      ...row.entry,
      rssAmount: parseAmount(form.rssAmount),
      rssHours: parseAmount(form.rssHours),
      essAmount: parseAmount(form.essAmount),
      essHours: parseAmount(form.essHours),
      carryForward: parseAmount(form.carryForward),
      taxDeduction: parseAmount(form.taxDeduction),
      deduction: parseAmount(form.deduction),
      payroll: Object.fromEntries(
        Object.entries(form.payroll).map(([k, v]) => [k, parseAmount(v)]),
      ),
    };
    // blank box = "not decided yet" (the field is left off, not set to 0)
    if (form.payrollHours.trim() === "") delete d.payrollHours;
    else d.payrollHours = parseAmount(form.payrollHours);
    return d;
  }, [row, form]);

  if (!row || !form || !draft) return null;

  const live = computeEntry(draft, row.payments);
  const split = splitHours(draft);
  // Where "fill amount" puts the money: the person's own payroll company, else the
  // one company that already has an amount on this line.
  const withAmount = companies.filter((c) => (draft.payroll[c.id] ?? 0) !== 0);
  const targetCompany =
    companies.find((c) => c.id === row.staff.defaultPayrollCompanyId) ??
    (withAmount.length === 1 ? withAmount[0] : undefined);
  const setF = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const num = (k: keyof FormState) => (e: { target: { value: string } }) =>
    setF(k, e.target.value as never);

  async function save() {
    if (!draft || !form) return;
    if (split.payrollHours !== (draft.payrollHours ?? split.payrollHours)) {
      toast.error(`Payroll hours can't be more than the ${split.totalHours} hours worked.`);
      return;
    }
    setSaving(true);
    try {
      await updateEntry({
        data: {
          id: draft.id,
          patch: {
            rssAmount: draft.rssAmount,
            rssHours: draft.rssHours,
            essAmount: draft.essAmount,
            essHours: draft.essHours,
            carryForward: draft.carryForward,
            taxDeduction: draft.taxDeduction,
            deduction: draft.deduction,
            deductionNote: form.deductionNote,
            checkStatus: form.checkStatus,
            flag: form.flag,
            payroll: draft.payroll,
            payrollHours: draft.payrollHours ?? null,
          },
        },
      });
      await refresh();
      toast.success("Salary line saved.");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not save this line."));
    } finally {
      setSaving(false);
    }
  }

  async function addPayment() {
    const amount = parseAmount(pay.amount);
    if (!amount) {
      toast.error("Enter a payment amount.");
      return;
    }
    if (!pay.date) {
      toast.error("Pick a payment date.");
      return;
    }
    setPayBusy(true);
    try {
      await addSalaryPayment({
        data: {
          entryId: draft!.id,
          date: pay.date,
          amount,
          method: pay.method,
          reference: pay.reference,
        },
      });
      setPay((p) => ({ ...p, amount: "", reference: "" }));
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not add the payment."));
    } finally {
      setPayBusy(false);
    }
  }

  async function removePayment(id: string) {
    try {
      await deleteSalaryPayment({ data: { id } });
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete the payment."));
    }
  }

  async function removeLine() {
    try {
      await deleteEntry({ data: { id: draft!.id } });
      await refresh();
      toast.success("Line removed from this month.");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove the line."));
    }
  }

  const s = row.staff;
  const dis = locked;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{s.name}</DialogTitle>
          <DialogDescription>
            {[s.rssId && `RSS ${s.rssId}`, s.essId && `ESS ${s.essId}`, s.ni, s.tag]
              .filter(Boolean)
              .join(" · ") || "Salary line"}
            {locked ? " — this month is closed, so the line is read-only." : ""}
          </DialogDescription>
        </DialogHeader>

        {/* live result */}
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-muted/50 p-3 text-[12px] sm:grid-cols-5">
          <Stat label="Total hours" value={String(live.totalHours)} />
          <Stat label="Total amount" value={formatMoney(live.totalAmount)} />
          <Stat label="Total payroll" value={formatMoney(live.payrollTotal)} />
          <Stat label="Cash paid" value={formatMoney(live.cashPaid)} />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              Outstanding
            </p>
            <p className="num mt-0.5 flex items-center gap-2 text-[14px] font-semibold">
              {formatMoney(live.outstanding)}
            </p>
            <div className="mt-1">
              <PayStatusBadge status={live.payStatus} />
            </div>
          </div>
        </div>

        <div className="grid gap-x-3 gap-y-3 sm:grid-cols-5">
          <Field label="RSS amount">
            <Input
              inputMode="decimal"
              value={form.rssAmount}
              onChange={num("rssAmount")}
              disabled={dis}
            />
          </Field>
          <Field label="RSS hours">
            <Input
              inputMode="decimal"
              value={form.rssHours}
              onChange={num("rssHours")}
              disabled={dis}
            />
          </Field>
          <Field label="ESS amount">
            <Input
              inputMode="decimal"
              value={form.essAmount}
              onChange={num("essAmount")}
              disabled={dis}
            />
          </Field>
          <Field label="ESS hours">
            <Input
              inputMode="decimal"
              value={form.essHours}
              onChange={num("essHours")}
              disabled={dis}
            />
          </Field>
          <Field label="Carry-forward" hint="+ owed, − overpaid">
            <Input
              inputMode="decimal"
              value={form.carryForward}
              onChange={num("carryForward")}
              disabled={dis}
            />
          </Field>
        </div>

        <EarningsBreakdown entryId={draft.id} />

        <div
          className={`rounded-md border p-3 ${split.decided && split.payrollHours > 0 ? "border-info/40 bg-info-soft" : "border-border bg-surface-muted/40"}`}
        >
          <p className="mb-2 text-[12px] font-semibold text-foreground">
            Payroll or cash?{" "}
            <span className="font-normal text-muted-foreground">
              {row.staff.payMode
                ? `Usually paid by ${row.staff.payMode === "payroll" ? "payroll" : "cash"}`
                : "Pay mode not set for this person"}
            </span>
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <Field label="Hours to payroll" hint={`of ${split.totalHours} worked`}>
                <Input
                  inputMode="decimal"
                  value={form.payrollHours}
                  onChange={num("payrollHours")}
                  disabled={dis}
                  placeholder="not decided"
                />
              </Field>
            </div>
            <div className="num pb-2 text-[12px]">
              <span className="text-muted-foreground">Cash hours: </span>
              <strong>{split.decided ? split.cashHours : "—"}</strong>
            </div>
            {!dis ? (
              <div className="flex flex-wrap gap-2 pb-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setF("payrollHours", String(split.totalHours))}
                >
                  All to payroll
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setF("payrollHours", "0")}
                >
                  All cash
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!targetCompany || !split.decided || split.payrollHours <= 0}
                  title={
                    targetCompany
                      ? `Put ${formatMoney(amountForHours(draft, split.payrollHours))} under ${targetCompany.name}`
                      : "Choose this person's payroll company in the Staff profile first"
                  }
                  onClick={() =>
                    targetCompany &&
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            payroll: {
                              ...f.payroll,
                              [targetCompany.id]: amountToInput(
                                round2(amountForHours(draft, split.payrollHours)),
                              ),
                            },
                          }
                        : f,
                    )
                  }
                >
                  Fill payroll amount{targetCompany ? ` (${targetCompany.name})` : ""}
                </Button>
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The amount is worked out as payroll hours × this month's average rate. Nothing changes
            until you press Save.
          </p>
        </div>

        <div>
          <p className="mb-2 text-[12px] font-semibold text-foreground">Payroll</p>
          {companies.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              No payroll companies yet — add them from “Payroll columns” on the sheet.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-4">
              {companies.map((c) => (
                <Field key={c.id} label={c.name}>
                  <Input
                    inputMode="decimal"
                    value={form.payroll[c.id] ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, payroll: { ...f.payroll, [c.id]: e.target.value } } : f,
                      )
                    }
                    disabled={dis}
                  />
                </Field>
              ))}
              <Field label="Tax deduction" hint="Subtracted from total payroll">
                <Input
                  inputMode="decimal"
                  value={form.taxDeduction}
                  onChange={num("taxDeduction")}
                  disabled={dis}
                />
              </Field>
            </div>
          )}
          {companies.length === 0 ? (
            <div className="mt-2 max-w-[200px]">
              <Field label="Tax deduction">
                <Input
                  inputMode="decimal"
                  value={form.taxDeduction}
                  onChange={num("taxDeduction")}
                  disabled={dis}
                />
              </Field>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Deduction">
            <Input
              inputMode="decimal"
              value={form.deduction}
              onChange={num("deduction")}
              disabled={dis}
            />
          </Field>
          <Field label="Deduction note" className="sm:col-span-2">
            <Input value={form.deductionNote} onChange={num("deductionNote")} disabled={dis} />
          </Field>
          <Field label="Check status">
            <Select
              value={form.checkStatus === "" ? "none" : form.checkStatus}
              onValueChange={(v) => setF("checkStatus", (v === "none" ? "" : v) as CheckStatus)}
              disabled={dis}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not checked</SelectItem>
                <SelectItem value="Reviewed">Reviewed</SelectItem>
                <SelectItem value="Verified">Verified</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Flag" hint="e.g. pay back" className="sm:col-span-2">
            <Input value={form.flag} onChange={num("flag")} disabled={dis} />
          </Field>
        </div>

        {/* cash payments */}
        <div className="rounded-md border border-border">
          <div className="border-b border-border bg-surface-muted/60 px-3 py-2 text-[12px] font-semibold">
            Cash payments (P1, P2, …)
          </div>
          {row.payments.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-muted-foreground">No cash payments yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {row.payments.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                  <span className="w-7 font-semibold text-muted-foreground">P{i + 1}</span>
                  <span className="w-24">{formatDate(p.date)}</span>
                  <span className="num w-24 text-right font-medium">{formatMoney(p.amount)}</span>
                  <span className="text-muted-foreground">{p.method}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {p.reference}
                  </span>
                  {!dis ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete payment"
                      onClick={() => removePayment(p.id)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {!dis ? (
            <div className="grid items-end gap-2 border-t border-border p-3 sm:grid-cols-[130px_120px_150px_1fr_auto]">
              <Field label="Date">
                <Input
                  type="date"
                  value={pay.date}
                  onChange={(e) => setPay((p) => ({ ...p, date: e.target.value }))}
                />
              </Field>
              <Field label="Amount">
                <Input
                  inputMode="decimal"
                  value={pay.amount}
                  onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))}
                />
              </Field>
              <Field label="Method">
                <Select
                  value={pay.method}
                  onValueChange={(v) => setPay((p) => ({ ...p, method: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {methods.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Reference">
                <Input
                  value={pay.reference}
                  onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))}
                />
              </Field>
              <Button variant="outline" onClick={addPayment} disabled={payBusy}>
                Add payment
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          <div>
            {canDelete && !dis ? (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => setConfirmRemove(true)}
              >
                Remove from this month
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {dis ? "Close" : "Cancel"}
            </Button>
            {!dis ? (
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save line"}
              </Button>
            ) : null}
          </div>
        </DialogFooter>

        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title="Remove this line from the month?"
          description={`${s.name}'s line, including its cash payments, will be removed from this salary month. The staff record itself is kept.`}
          confirmLabel="Remove"
          onConfirm={removeLine}
        />
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </p>
      <p className="num mt-0.5 text-[14px] font-semibold">{value}</p>
    </div>
  );
}
