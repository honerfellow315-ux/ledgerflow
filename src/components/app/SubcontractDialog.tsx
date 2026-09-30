import { useEffect, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Field } from "./Field";
import { useLedger } from "@/lib/ledger/store";
import {
  formatHours,
  formatMoney,
  invoiceTracksHours,
  remainingInvoiceHours,
  subcontractValue,
  subcontractVat,
  subcontractValueIncVat,
} from "@/lib/ledger/calc";
import type { SubcontractEntry } from "@/lib/ledger/types";

const blank = {
  month: "",
  clientId: "",
  invoiceId: "",
  subcontractorName: "",
  hoursProceed: "",
  rate: "",
  description: "",
  reference: "",
  invoiceDate: "",
  dueDate: "",
  invoiceNumber: "",
  notes: "",
  vatIncluded: false,
  vatRate: "20",
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

type Errors = { [K in keyof typeof blank]?: string | undefined };

export function SubcontractDialog({
  open,
  onOpenChange,
  entry,
  defaultClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry?: SubcontractEntry | null | undefined;
  defaultClientId?: string | undefined;
}) {
  const { data, addSubcontract, updateSubcontract } = useLedger();
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitting(false);
    if (entry) {
      setForm({
        month: entry.month,
        clientId: entry.clientId,
        invoiceId: entry.invoiceId ?? "",
        subcontractorName: entry.subcontractorName,
        hoursProceed: String(entry.hoursProceed),
        rate: String(entry.rate),
        description: entry.description ?? "",
        reference: entry.reference ?? "",
        invoiceDate: entry.invoiceDate ?? "",
        dueDate: entry.dueDate ?? "",
        invoiceNumber: entry.invoiceNumber ?? "",
        notes: entry.notes ?? "",
        vatIncluded: entry.vatIncluded,
        vatRate: String(entry.vatRate),
      });
      return;
    }
    const clientId = defaultClientId ?? data.clients[0]?.id ?? "";
    const client = data.clients.find((c) => c.id === clientId);
    setForm({
      ...blank,
      month: thisMonth(),
      clientId,
      rate: client?.rate ? String(client.rate) : "",
      vatRate: String(data.settings.defaultVatRate),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, defaultClientId]);

  const set = <K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const preview = useMemo(() => {
    const draft = {
      hoursProceed: Number(form.hoursProceed) || 0,
      rate: Number(form.rate) || 0,
      vatIncluded: form.vatIncluded,
      vatRate: Number(form.vatRate) || 0,
    } as SubcontractEntry;
    return {
      ex: subcontractValue(draft),
      vat: subcontractVat(draft),
      total: subcontractValueIncVat(draft),
    };
  }, [form.hoursProceed, form.rate, form.vatIncluded, form.vatRate]);

  // Total/Remaining Hours for the selected invoice — remaining excludes
  // this entry's own current hours when editing, so re-saving the same
  // value (or a smaller one) is never blocked by the entry's own prior
  // contribution. `null` means the invoice doesn't track hours at all
  // (Fixed Amount / Line Items billing), in which case there's no cap.
  const selectedInvoice = data.invoices.find((inv) => inv.id === form.invoiceId);
  const invoiceHours = useMemo(() => {
    if (!selectedInvoice) return null;
    if (!invoiceTracksHours(selectedInvoice)) return null;
    const remaining = remainingInvoiceHours(selectedInvoice, data.subcontracts, entry?.id);
    return {
      total: selectedInvoice.hours ?? 0,
      remaining: remaining ?? 0,
    };
  }, [selectedInvoice, data.subcontracts, entry?.id]);

  const validate = (): Errors => {
    const next: Errors = {};
    if (!form.month) next.month = "Select a month.";
    if (!form.clientId) next.clientId = "Select a client.";
    if (!form.subcontractorName.trim()) next.subcontractorName = "Subcontractor name is required.";

    const hours = Number(form.hoursProceed);
    if (form.hoursProceed.trim() === "") next.hoursProceed = "Hours proceed is required.";
    else if (!Number.isFinite(hours)) next.hoursProceed = "Hours proceed must be a number.";
    else if (hours < 0) next.hoursProceed = "Hours proceed cannot be negative.";
    else if (hours <= 0) next.hoursProceed = "Hours proceed must be greater than zero.";
    else if (invoiceHours && hours > invoiceHours.remaining + 0.004) {
      next.hoursProceed = `Only ${formatHours(invoiceHours.remaining)} remaining hour(s) on this invoice.`;
    }

    const rate = Number(form.rate);
    if (form.rate.trim() === "") next.rate = "Rate is required.";
    else if (!Number.isFinite(rate)) next.rate = "Rate must be a number.";
    else if (rate < 0) next.rate = "Rate cannot be negative.";
    else if (rate <= 0) next.rate = "Rate must be greater than zero.";

    if (form.invoiceDate && form.dueDate && form.dueDate < form.invoiceDate) {
      next.dueDate = "Due date cannot be before the invoice date.";
    }

    if (form.vatIncluded) {
      const rate = Number(form.vatRate);
      if (form.vatRate.trim() === "") next.vatRate = "VAT rate is required.";
      else if (!Number.isFinite(rate)) next.vatRate = "VAT rate must be a number.";
      else if (rate < 0 || rate > 100) next.vatRate = "VAT rate must be between 0 and 100.";
    }
    return next;
  };

  const submit = (): void => {
    if (submitting) return;
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error("Check the highlighted fields.");
      return;
    }

    const payload = {
      month: form.month,
      clientId: form.clientId,
      subcontractorName: form.subcontractorName.trim(),
      hoursProceed: Number(form.hoursProceed),
      rate: Number(form.rate),
      description: form.description.trim(),
      reference: form.reference.trim(),
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate,
      invoiceNumber: form.invoiceNumber.trim(),
      notes: form.notes.trim(),
      vatIncluded: form.vatIncluded,
      vatRate: form.vatIncluded ? Number(form.vatRate) || 0 : 0,
      ...(form.invoiceId ? { invoiceId: form.invoiceId } : {}),
    };

    setSubmitting(true);
    // The server re-checks the invoice's remaining hours against the actual
    // saved entries (see actions/subcontracts.ts) — this can still reject
    // even after client-side validation passed, e.g. if someone else
    // processed hours against the same invoice a moment ago.
    const promise = entry ? updateSubcontract(entry.id, payload) : addSubcontract(payload);
    promise
      .then(() => {
        toast.success(entry ? "Subcontracting entry updated." : "Subcontracting entry added.");
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Could not save this entry.");
        setSubmitting(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {entry ? "Edit Subcontracting Entry" : "Add Subcontracting Entry"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Hours subcontracted out to a subcontractor, for a given client and month.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Month" htmlFor="sc-month" error={errors.month}>
            <Input
              id="sc-month"
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
          <Field
            label="Related Invoice"
            htmlFor="sc-invoice"
            hint={
              invoiceHours
                ? `Total Hours: ${formatHours(invoiceHours.total)} · Remaining Hours: ${formatHours(invoiceHours.remaining)}`
                : selectedInvoice
                  ? "This invoice doesn't track hours (not billed as Hours × Rate)."
                  : undefined
            }
          >
            <Select
              value={form.invoiceId || "none"}
              onValueChange={(v) => set("invoiceId", v === "none" ? "" : v)}
            >
              <SelectTrigger id="sc-invoice">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {data.invoices
                  .filter((inv) => inv.clientId === form.clientId)
                  .map((inv) => {
                    const remaining = invoiceTracksHours(inv)
                      ? remainingInvoiceHours(inv, data.subcontracts, entry?.id)
                      : null;
                    // An invoice with zero hours left can't take another
                    // entry (unless we're editing the entry that's already
                    // linked to it — that one still needs to show up).
                    const exhausted =
                      remaining !== null && remaining <= 0.004 && inv.id !== entry?.invoiceId;
                    return (
                      <SelectItem key={inv.id} value={inv.id} disabled={exhausted}>
                        {inv.number} — {inv.description || "—"}
                        {remaining !== null
                          ? ` (${formatHours(remaining)}h remaining${exhausted ? ", full" : ""})`
                          : ""}
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Subcontractor Name"
            htmlFor="sc-subname"
            error={errors.subcontractorName}
            className="sm:col-span-2"
          >
            <Input
              id="sc-subname"
              value={form.subcontractorName}
              onChange={(e) => set("subcontractorName", e.target.value)}
              placeholder="e.g. ABC Contractors"
            />
          </Field>
          <Field
            label="Process Hours"
            htmlFor="sc-hours"
            error={errors.hoursProceed}
            hint={
              invoiceHours
                ? `Cannot exceed ${formatHours(invoiceHours.remaining)}h remaining.`
                : undefined
            }
          >
            <Input
              id="sc-hours"
              type="number"
              min="0"
              max={invoiceHours ? invoiceHours.remaining : undefined}
              step="0.25"
              value={form.hoursProceed}
              onChange={(e) => set("hoursProceed", e.target.value)}
            />
          </Field>
          <Field label="Rate (£ per hour)" htmlFor="sc-rate" error={errors.rate}>
            <Input
              id="sc-rate"
              type="number"
              min="0"
              step="0.01"
              value={form.rate}
              onChange={(e) => set("rate", e.target.value)}
            />
          </Field>
          <Field label="VAT Rate (%)" htmlFor="sc-vat-rate" error={errors.vatRate}>
            <Input
              id="sc-vat-rate"
              type="number"
              min="0"
              max="100"
              step="0.5"
              disabled={!form.vatIncluded}
              value={form.vatRate}
              onChange={(e) => set("vatRate", e.target.value)}
            />
          </Field>
          <Field
            label="VAT Included"
            hint="Off by default — most subcontractor payments are zero-rated or exempt."
          >
            <div className="flex h-9 items-center gap-2">
              <Switch
                id="sc-vat"
                checked={form.vatIncluded}
                onCheckedChange={(v) => set("vatIncluded", v)}
              />
              <span className="text-[13px] text-muted-foreground">
                {form.vatIncluded ? "VAT applied" : "No VAT"}
              </span>
            </div>
          </Field>
          <Field label="Invoice Date" htmlFor="sc-inv-date" error={errors.invoiceDate}>
            <Input
              id="sc-inv-date"
              type="date"
              value={form.invoiceDate}
              onChange={(e) => set("invoiceDate", e.target.value)}
            />
          </Field>
          <Field label="Due Date" htmlFor="sc-due" error={errors.dueDate}>
            <Input
              id="sc-due"
              type="date"
              value={form.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor="sc-desc" className="sm:col-span-2">
            <Input
              id="sc-desc"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="e.g. Site A security cover"
            />
          </Field>
          <Field label="Reference" htmlFor="sc-ref">
            <Input
              id="sc-ref"
              value={form.reference}
              onChange={(e) => set("reference", e.target.value)}
              placeholder="PO number, work order, etc."
            />
          </Field>
          <Field label="Invoice Number" htmlFor="sc-number">
            <Input
              id="sc-number"
              value={form.invoiceNumber}
              onChange={(e) => set("invoiceNumber", e.target.value)}
            />
          </Field>
          <Field label="Notes" htmlFor="sc-notes" className="sm:col-span-2">
            <Textarea
              id="sc-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-sm border border-border bg-surface-muted px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Amount ex VAT
            </p>
            <p className="num text-[15px] font-semibold">{formatMoney(preview.ex)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              VAT
            </p>
            <p className="num text-[15px] font-semibold">{formatMoney(preview.vat)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total
            </p>
            <p className="num text-[15px] font-semibold">{formatMoney(preview.total)}</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : entry ? "Save Changes" : "Add Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
