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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "./Field";
import { useLedger } from "@/lib/ledger/store";
import { creditNoteTotal, creditNoteVat, formatMoney } from "@/lib/ledger/calc";
import type { CreditNote, CreditNoteStatus } from "@/lib/ledger/types";

const NO_INVOICE = "none";

const blank = {
  number: "",
  clientId: "",
  invoiceId: NO_INVOICE,
  date: "",
  reason: "",
  amountExVat: "",
  vatIncluded: true,
  vatRate: "20",
  status: "draft" as CreditNoteStatus,
  comments: "",
};

const today = () => new Date().toISOString().slice(0, 10);

/** Validation messages. Fields are explicitly optional so clearing one by
 * assigning `undefined` is type-safe under exactOptionalPropertyTypes. */
type Errors = { [K in keyof typeof blank]?: string | undefined };

export function CreditNoteDialog({
  open,
  onOpenChange,
  note,
  defaultClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  note?: CreditNote | null | undefined;
  defaultClientId?: string | undefined;
}) {
  const { data, addCreditNote, updateCreditNote } = useLedger();
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (note) {
      setForm({
        number: note.number,
        clientId: note.clientId,
        invoiceId: note.invoiceId ?? NO_INVOICE,
        date: note.date,
        reason: note.reason,
        amountExVat: String(note.amountExVat),
        vatIncluded: note.vatIncluded,
        vatRate: String(note.vatRate),
        status: note.status,
        comments: note.comments ?? "",
      });
      return;
    }
    const year = today().slice(0, 4);
    const seq = String(data.creditNotes.length + 1).padStart(4, "0");
    setForm({
      ...blank,
      number: `${data.settings.creditNotePrefix}${year}-${seq}`,
      clientId: defaultClientId ?? data.clients[0]?.id ?? "",
      date: today(),
      vatRate: String(data.settings.defaultVatRate),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note, defaultClientId]);

  const set = <K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const clientInvoices = useMemo(
    () => data.invoices.filter((i) => i.clientId === form.clientId),
    [data.invoices, form.clientId],
  );

  const linkedPo = useMemo(
    () => (data.invoices.find((i) => i.id === form.invoiceId)?.poReference ?? "").trim(),
    [data.invoices, form.invoiceId],
  );

  const preview = useMemo(() => {
    const draft = {
      amountExVat: Number(form.amountExVat) || 0,
      vatIncluded: form.vatIncluded,
      vatRate: Number(form.vatRate) || 0,
    } as CreditNote;
    return {
      ex: draft.amountExVat,
      vat: creditNoteVat(draft),
      total: creditNoteTotal(draft),
    };
  }, [form.amountExVat, form.vatIncluded, form.vatRate]);

  const validate = (): Errors => {
    const next: Errors = {};
    if (!form.number.trim()) next.number = "Credit note number is required.";
    else if (
      data.creditNotes.some(
        (n) => n.number.toLowerCase() === form.number.trim().toLowerCase() && n.id !== note?.id,
      )
    ) {
      next.number = "That credit note number already exists.";
    }
    if (!form.clientId) next.clientId = "Select a client.";
    if (!form.date) next.date = "Enter a credit note date.";
    if (!form.reason.trim()) next.reason = "Reason is required.";

    const amount = Number(form.amountExVat);
    if (form.amountExVat.trim() === "") next.amountExVat = "Amount is required.";
    else if (!Number.isFinite(amount)) next.amountExVat = "Amount must be a number.";
    else if (amount < 0) next.amountExVat = "Amount cannot be negative.";
    else if (amount <= 0) next.amountExVat = "Amount must be greater than zero.";

    if (form.vatIncluded) {
      const rate = Number(form.vatRate);
      if (form.vatRate.trim() === "") next.vatRate = "VAT rate is required.";
      else if (!Number.isFinite(rate)) next.vatRate = "VAT rate must be a number.";
      else if (rate < 0 || rate > 100) next.vatRate = "VAT rate must be between 0 and 100.";
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
      number: form.number.trim(),
      clientId: form.clientId,
      invoiceId: form.invoiceId === NO_INVOICE ? "" : form.invoiceId,
      date: form.date,
      reason: form.reason.trim(),
      amountExVat: Number(form.amountExVat),
      vatIncluded: form.vatIncluded,
      vatRate: form.vatIncluded ? Number(form.vatRate) || 0 : 0,
      status: form.status,
      comments: form.comments.trim(),
    };

    if (note) {
      updateCreditNote(note.id, payload);
      toast.success("Credit note updated.");
    } else {
      addCreditNote(payload);
      toast.success("Credit note created.");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {note ? "Edit Credit Note" : "Create Credit Note"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Credit raised against a client, optionally linked to one of their invoices.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Credit Note Number" htmlFor="cn-number" error={errors.number}>
            <Input
              id="cn-number"
              value={form.number}
              onChange={(e) => set("number", e.target.value)}
            />
          </Field>
          <Field label="Client" error={errors.clientId}>
            <Select
              value={form.clientId}
              onValueChange={(v) => {
                setForm((f) => ({ ...f, clientId: v, invoiceId: NO_INVOICE }));
                setErrors((e) => ({ ...e, clientId: undefined }));
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
            label="Linked Invoice"
            hint={
              form.invoiceId === NO_INVOICE
                ? "Optional — leave unlinked for a general credit."
                : `PO No. (from invoice): ${linkedPo || "— none on that invoice"}`
            }
          >
            <Select value={form.invoiceId} onValueChange={(v) => set("invoiceId", v)}>
              <SelectTrigger>
                <SelectValue placeholder="No linked invoice" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_INVOICE}>No linked invoice</SelectItem>
                {clientInvoices.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date" htmlFor="cn-date" error={errors.date}>
            <Input
              id="cn-date"
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label="Reason" htmlFor="cn-reason" className="sm:col-span-2" error={errors.reason}>
            <Input
              id="cn-reason"
              value={form.reason}
              onChange={(e) => set("reason", e.target.value)}
              placeholder="Overcharge correction"
            />
          </Field>
          <Field label="Amount ex VAT (£)" htmlFor="cn-amount" error={errors.amountExVat}>
            <Input
              id="cn-amount"
              type="number"
              min="0"
              step="0.01"
              value={form.amountExVat}
              onChange={(e) => set("amountExVat", e.target.value)}
            />
          </Field>
          <Field label="VAT Rate (%)" htmlFor="cn-vat-rate" error={errors.vatRate}>
            <Input
              id="cn-vat-rate"
              type="number"
              min="0"
              max="100"
              step="0.5"
              disabled={!form.vatIncluded}
              value={form.vatRate}
              onChange={(e) => set("vatRate", e.target.value)}
            />
          </Field>
          <Field label="VAT Included" hint="Turn off for zero-rated or VAT-exempt credits.">
            <div className="flex h-9 items-center gap-2">
              <Switch
                id="cn-vat"
                checked={form.vatIncluded}
                onCheckedChange={(v) => set("vatIncluded", v)}
              />
              <span className="text-[13px] text-muted-foreground">
                {form.vatIncluded ? "VAT applied" : "No VAT"}
              </span>
            </div>
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set("status", v as CreditNoteStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="issued">Issued</SelectItem>
                <SelectItem value="applied">Applied</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Comments" htmlFor="cn-comments" className="sm:col-span-2">
            <Textarea
              id="cn-comments"
              rows={2}
              value={form.comments}
              onChange={(e) => set("comments", e.target.value)}
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
              Credit total
            </p>
            <p className="num text-[15px] font-semibold">{formatMoney(preview.total)}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit}>
            {note ? "Save Changes" : "Create Credit Note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
