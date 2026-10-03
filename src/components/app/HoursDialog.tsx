import { useEffect, useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "./Field";
import { useLedger } from "@/lib/ledger/store";
import {
  formatDate,
  formatHours,
  formatMonth,
  formatMoney,
  hoursValue,
  remainingHours,
  entryPayrollValue,
  round2,
} from "@/lib/ledger/calc";
import type { HoursEntry } from "@/lib/ledger/types";

const blank = {
  month: "",
  clientId: "",
  totalHours: "",
  payrollHours: "",
  managementPayrollHours: "",
  unpaidHours: "",
  rate: "",
  payrollRate: "",
  notes: "",
  invoiceId: "",
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

type Errors = { [K in keyof typeof blank]?: string | undefined };

export function HoursDialog({
  open,
  onOpenChange,
  entry,
  defaultClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry?: HoursEntry | null | undefined;
  defaultClientId?: string | undefined;
}) {
  const { data, addHours, updateHours } = useLedger();
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Errors>({});
  // Tracks the invoice id we auto-suggested (as opposed to one the person
  // picked themselves), so a later auto-suggest recompute never clobbers a
  // manual choice — only ever fills in from blank or replaces its own guess.
  const autoSuggested = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (entry) {
      autoSuggested.current = "";
      setForm({
        month: entry.month,
        clientId: entry.clientId,
        totalHours: String(entry.totalHours),
        payrollHours: String(entry.payrollHours),
        managementPayrollHours: String(entry.managementPayrollHours),
        unpaidHours: String(entry.unpaidHours),
        rate: String(entry.rate),
        payrollRate: entry.payrollRate != null ? String(entry.payrollRate) : "",
        notes: entry.notes ?? "",
        invoiceId: entry.invoiceId ?? "",
      });
      return;
    }
    const clientId = defaultClientId ?? data.clients[0]?.id ?? "";
    const client = data.clients.find((c) => c.id === clientId);
    autoSuggested.current = "";
    setForm({
      ...blank,
      month: thisMonth(),
      clientId,
      rate: client?.rate ? String(client.rate) : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, defaultClientId]);

  // Auto-suggest a matching invoice — same client, same month, billed as
  // Hours × Rate — whenever client/month change and the invoice field is
  // still blank or still holding our own last guess (never overrides a
  // manual pick). Several matches (e.g. an original + an "additional"
  // invoice for the same month) are left for the person to pick manually.
  useEffect(() => {
    if (!open || !form.clientId || !form.month) return;
    if (form.invoiceId && form.invoiceId !== autoSuggested.current) return;
    const candidates = data.invoices.filter(
      (inv) => inv.clientId === form.clientId && inv.month === form.month && inv.hours != null,
    );
    const guess = candidates.length === 1 ? (candidates[0]?.id ?? "") : "";
    if (guess !== form.invoiceId) {
      autoSuggested.current = guess;
      setForm((f) => ({ ...f, invoiceId: guess }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.clientId, form.month, data.invoices]);

  const set = <K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const preview = useMemo(() => {
    const draft = {
      totalHours: Number(form.totalHours) || 0,
      payrollHours: Number(form.payrollHours) || 0,
      managementPayrollHours: Number(form.managementPayrollHours) || 0,
      unpaidHours: Number(form.unpaidHours) || 0,
      rate: Number(form.rate) || 0,
      payrollRate: Number(form.payrollRate) || 0,
    } as HoursEntry;
    const payroll = entryPayrollValue(draft);
    return {
      remaining: remainingHours(draft),
      value: hoursValue(draft),
      payroll,
      // Payroll part + remaining part = the invoice amount ex VAT for this entry.
      total: round2(payroll + hoursValue(draft)),
    };
  }, [form]);

  const validate = (): Errors => {
    const next: Errors = {};
    if (!form.month) next.month = "Select a month.";
    if (!form.clientId) next.clientId = "Select a client.";

    const numeric: { key: keyof typeof blank; label: string; allowZero: boolean }[] = [
      { key: "totalHours", label: "Total hours", allowZero: false },
      { key: "payrollHours", label: "Payroll hours", allowZero: true },
      { key: "managementPayrollHours", label: "Management payroll hours", allowZero: true },
      { key: "unpaidHours", label: "Unpaid hours", allowZero: true },
      { key: "rate", label: "Rate", allowZero: false },
    ];

    for (const { key, label, allowZero } of numeric) {
      const raw = form[key] as string;
      if (raw.trim() === "") {
        next[key] = `${label} is required.`;
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) next[key] = `${label} must be a number.`;
      else if (value < 0) next[key] = `${label} cannot be negative.`;
      else if (!allowZero && value <= 0) next[key] = `${label} must be greater than zero.`;
    }

    if (form.payrollRate.trim() !== "") {
      const pr = Number(form.payrollRate);
      if (!Number.isFinite(pr) || pr < 0) next.payrollRate = "Payroll rate must be a number, 0 or more.";
    }

    if (
      !next.totalHours &&
      !next.payrollHours &&
      !next.managementPayrollHours &&
      !next.unpaidHours
    ) {
      const allocated =
        Number(form.payrollHours) + Number(form.managementPayrollHours) + Number(form.unpaidHours);
      if (allocated > Number(form.totalHours) + 0.004) {
        next.totalHours = "Allocated hours exceed the total hours.";
      }
    }
    return next;
  };

  const submit = (): void => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error("Check the highlighted fields.");
      return;
    }

    const payload = {
      month: form.month,
      clientId: form.clientId,
      totalHours: Number(form.totalHours),
      payrollHours: Number(form.payrollHours),
      managementPayrollHours: Number(form.managementPayrollHours),
      unpaidHours: Number(form.unpaidHours),
      rate: Number(form.rate),
      // 0 = no payroll rate (server stores NULL).
      payrollRate: Number(form.payrollRate) || 0,
      notes: form.notes.trim(),
      // Always sent (never omitted), plain "" for none — the server
      // transforms blank to an explicit null so clearing a previous link
      // actually reaches the database. Same convention as ExpenseDialog.
      invoiceId: form.invoiceId,
    };

    if (entry) {
      updateHours(entry.id, payload);
      toast.success("Hours entry updated.");
    } else {
      addHours(payload);
      toast.success("Hours entry added.");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {entry ? "Edit Hours Entry" : "Add Hours Entry"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Monthly hours recorded per client. Remaining hours are calculated automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Month" htmlFor="hr-month" error={errors.month}>
            <Input
              id="hr-month"
              type="month"
              value={form.month}
              onChange={(e) => set("month", e.target.value)}
            />
          </Field>
          <Field label="Client" error={errors.clientId}>
            <Select
              value={form.clientId}
              onValueChange={(v) => {
                set("clientId", v);
                const client = data.clients.find((c) => c.id === v);
                if (client?.rate && !form.rate) set("rate", String(client.rate));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {data.clients.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No clients yet
                  </SelectItem>
                ) : (
                  data.clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Total Hours" htmlFor="hr-total" error={errors.totalHours}>
            <Input
              id="hr-total"
              type="number"
              min="0"
              step="0.25"
              value={form.totalHours}
              onChange={(e) => set("totalHours", e.target.value)}
            />
          </Field>
          <Field label="Payroll Hours" htmlFor="hr-payroll" error={errors.payrollHours}>
            <Input
              id="hr-payroll"
              type="number"
              min="0"
              step="0.25"
              value={form.payrollHours}
              onChange={(e) => set("payrollHours", e.target.value)}
            />
          </Field>
          <Field
            label="Management Payroll Hours"
            htmlFor="hr-mgmt"
            error={errors.managementPayrollHours}
          >
            <Input
              id="hr-mgmt"
              type="number"
              min="0"
              step="0.25"
              value={form.managementPayrollHours}
              onChange={(e) => set("managementPayrollHours", e.target.value)}
            />
          </Field>
          <Field label="Unpaid Hours" htmlFor="hr-unpaid" error={errors.unpaidHours}>
            <Input
              id="hr-unpaid"
              type="number"
              min="0"
              step="0.25"
              value={form.unpaidHours}
              onChange={(e) => set("unpaidHours", e.target.value)}
            />
          </Field>
          <Field label="Rate (£ per hour)" htmlFor="hr-rate" error={errors.rate}>
            <Input
              id="hr-rate"
              type="number"
              min="0"
              step="0.01"
              value={form.rate}
              onChange={(e) => set("rate", e.target.value)}
            />
          </Field>
          <Field
            label="Payroll Rate (£ per hour)"
            htmlFor="hr-payroll-rate"
            error={errors.payrollRate}
            hint="Optional. Rate the payroll hours were paid at (e.g. 12.45). The Rate above is for the remaining hours."
          >
            <Input
              id="hr-payroll-rate"
              type="number"
              min="0"
              step="0.01"
              value={form.payrollRate}
              onChange={(e) => set("payrollRate", e.target.value)}
            />
          </Field>
          <Field
            label="Invoice"
            htmlFor="hr-invoice"
            hint={
              form.invoiceId && form.invoiceId === autoSuggested.current
                ? "Auto-matched by client + month — change it if that's wrong."
                : undefined
            }
          >
            <Select
              value={form.invoiceId || "none"}
              onValueChange={(v) => {
                if (v === "none") {
                  set("invoiceId", "");
                  return;
                }
                // Picking an invoice pulls its Hours × Rate figures straight
                // into this entry — no need to retype what's already on the
                // invoice. Only overwrites when the invoice actually has
                // hours/rate on it (i.e. was billed as Hours × Rate).
                const inv = data.invoices.find((i) => i.id === v);
                setForm((f) => ({
                  ...f,
                  invoiceId: v,
                  totalHours: inv?.hours != null ? String(inv.hours) : f.totalHours,
                  rate: inv?.rate != null ? String(inv.rate) : f.rate,
                  payrollHours:
                    inv?.payrollHours != null ? String(inv.payrollHours) : f.payrollHours,
                  payrollRate: inv?.payrollRate != null ? String(inv.payrollRate) : f.payrollRate,
                }));
                setErrors((e) => ({ ...e, invoiceId: undefined }));
              }}
            >
              <SelectTrigger id="hr-invoice">
                <SelectValue placeholder="Not invoiced yet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not invoiced yet</SelectItem>
                {data.invoices
                  .filter((inv) => inv.clientId === form.clientId)
                  .map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.number} —{" "}
                      {inv.month ? formatMonth(inv.month) : formatDate(inv.invoiceDate)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Notes" htmlFor="hr-notes" className="sm:col-span-2">
            <Textarea
              id="hr-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-sm border border-border bg-surface-muted px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Remaining hours
            </p>
            <p className="num text-[15px] font-semibold">{formatHours(preview.remaining)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Value
            </p>
            <p className="num text-[15px] font-semibold">{formatMoney(preview.value)}</p>
          </div>
          {preview.payroll > 0 ? (
            <>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Payroll value (no VAT)
                </p>
                <p className="num text-[15px] font-semibold">{formatMoney(preview.payroll)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Payroll + remaining (ex VAT)
                </p>
                <p className="num text-[15px] font-semibold">{formatMoney(preview.total)}</p>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit}>
            {entry ? "Save Changes" : "Add Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
