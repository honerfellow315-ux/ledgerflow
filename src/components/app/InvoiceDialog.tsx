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
import {
  formatMoney,
  formatDate,
  formatHours,
  vatAmount,
  amountIncVat,
  paidForInvoice,
  processedHoursForInvoice,
  remainingInvoiceHours,
  round2,
  endClientOptions,
  suggestNextInvoiceNumber,
} from "@/lib/ledger/calc";
import type { Invoice, LedgerData, VatMode } from "@/lib/ledger/types";

/** Next number in line for this client's company (e.g. 644 -> 645), from the invoices that already exist. */
function nextInvoiceNumberFor(data: LedgerData, clientId: string): string {
  const c = data.clients.find((x) => x.id === clientId);
  const company = c?.companyId ? data.companies.find((co) => co.id === c.companyId) : undefined;
  const prefix = company?.invoicePrefix?.trim()
    ? company.invoicePrefix
    : data.settings.invoicePrefix;
  return suggestNextInvoiceNumber({
    invoices: data.invoices,
    clients: data.clients,
    clientId,
    prefix,
    fallbackNext: data.settings.nextInvoiceNumber,
  });
}

type BillingType = "amount" | "hours" | "items";

interface LineItemForm {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

const blankLineItem = (): LineItemForm => ({
  key: Math.random().toString(36).slice(2),
  description: "",
  quantity: "1",
  unitPrice: "",
});

const blank = {
  number: "",
  clientId: "",
  invoiceDate: "",
  dueDate: "",
  poReference: "",
  endClient: "",
  description: "",
  billingType: "amount" as BillingType,
  amountExVat: "",
  hours: "",
  rate: "",
  vatIncluded: true,
  vatRate: "20",
  vatMode: "full" as VatMode,
  vatPaidBefore: "",
  paymentTerms: "30 days",
  notes: "",
  lineItems: [] as LineItemForm[],
  approved: false,
  originalInvoiceId: "" as string | undefined,
  // Not sent to the server as an invoice field — used client-side to link
  // the chosen Hours entry back to this invoice once it's created.
  hoursEntryId: "",
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function InvoiceDialog({
  open,
  onOpenChange,
  invoice,
  defaultClientId,
  duplicateFrom,
  additionalFor,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice?: Invoice | null | undefined;
  defaultClientId?: string | undefined;
  duplicateFrom?: Invoice | null | undefined;
  /** Create a new, independent "Additional Invoice" that references this original. */
  additionalFor?: Invoice | null | undefined;
}) {
  const { data, addInvoice, updateInvoice } = useLedger();
  const [form, setForm] = useState(blank);
  const [submitting, setSubmitting] = useState(false);
  // Create → Review → Proceed workflow: the form is filled in "form" mode,
  // then a read-only summary is shown in "review" mode before the invoice is
  // actually created — this is also what prevents accidental duplicate
  // creation from repeated clicks (nothing is submitted until Confirm).
  const [step, setStep] = useState<"form" | "review">("form");

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setStep("form");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setForm({
        number: invoice.number,
        clientId: invoice.clientId,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        poReference: invoice.poReference ?? "",
        endClient: invoice.endClient ?? "",
        description: invoice.description,
        billingType:
          invoice.lineItems && invoice.lineItems.length > 0
            ? "items"
            : invoice.hours != null && invoice.rate != null
              ? "hours"
              : "amount",
        amountExVat: String(invoice.amountExVat),
        hours: invoice.hours != null ? String(invoice.hours) : "",
        rate: invoice.rate != null ? String(invoice.rate) : "",
        vatIncluded: invoice.vatIncluded,
        vatRate: String(invoice.vatRate),
        vatMode: invoice.vatMode ?? "full",
        // Frozen value if already saved (> 0); a missing OR 0 value (legacy rows / DB
        // default 0) falls back to what has been paid so far, so the field is prefilled.
        vatPaidBefore: String(invoice.vatPaidBefore || paidForInvoice(invoice.id, data.payments)),
        paymentTerms: invoice.paymentTerms,
        notes: invoice.notes ?? "",
        lineItems:
          invoice.lineItems && invoice.lineItems.length > 0
            ? invoice.lineItems.map((li) => ({
                key: li.id,
                description: li.description,
                quantity: String(li.quantity),
                unitPrice: String(li.unitPrice),
              }))
            : [],
        approved: invoice.approved,
        originalInvoiceId: invoice.originalInvoiceId,
        hoursEntryId: "",
      });
      return;
    }
    const client = (id: string) => data.clients.find((c) => c.id === id);
    const nextNumberFor = (clientId: string) => nextInvoiceNumberFor(data, clientId);
    const start = today();
    if (duplicateFrom) {
      const suggestedNumber = nextNumberFor(duplicateFrom.clientId);
      setForm({
        ...blank,
        number: suggestedNumber,
        clientId: duplicateFrom.clientId,
        invoiceDate: start,
        dueDate: plusDays(start, 30),
        poReference: duplicateFrom.poReference ?? "",
        endClient: duplicateFrom.endClient ?? "",
        description: duplicateFrom.description,
        billingType:
          duplicateFrom.lineItems && duplicateFrom.lineItems.length > 0
            ? "items"
            : duplicateFrom.hours != null && duplicateFrom.rate != null
              ? "hours"
              : "amount",
        amountExVat: String(duplicateFrom.amountExVat),
        hours: duplicateFrom.hours != null ? String(duplicateFrom.hours) : "",
        rate: duplicateFrom.rate != null ? String(duplicateFrom.rate) : "",
        vatIncluded: duplicateFrom.vatIncluded,
        vatRate: String(duplicateFrom.vatRate),
        vatMode: duplicateFrom.vatMode ?? "full",
        vatPaidBefore: "",
        paymentTerms: duplicateFrom.paymentTerms,
        notes: duplicateFrom.notes ?? "",
        // Copy is a starting point for a new, independent invoice — never
        // copies payments (there's nothing to copy: this is a fresh row),
        // and is not linked back to the invoice it was copied from.
        lineItems:
          duplicateFrom.lineItems && duplicateFrom.lineItems.length > 0
            ? duplicateFrom.lineItems.map((li) => ({
                key: Math.random().toString(36).slice(2),
                description: li.description,
                quantity: String(li.quantity),
                unitPrice: String(li.unitPrice),
              }))
            : [],
      });
      return;
    }
    if (additionalFor) {
      // An Additional Invoice is a wholly new, independently-tracked
      // invoice — own number, own line items, own VAT setting, own payment
      // tracking — that only references the original for traceability.
      const suggestedNumber = nextNumberFor(additionalFor.clientId);
      setForm({
        ...blank,
        number: suggestedNumber,
        clientId: additionalFor.clientId,
        invoiceDate: start,
        dueDate: plusDays(start, 30),
        poReference: additionalFor.poReference ?? "",
        endClient: additionalFor.endClient ?? "",
        vatRate: String(data.settings.defaultVatRate),
        paymentTerms: additionalFor.paymentTerms,
        originalInvoiceId: additionalFor.id,
      });
      return;
    }
    const startClientId = defaultClientId ?? data.clients[0]?.id ?? "";
    const startClient = data.clients.find((c) => c.id === startClientId);
    const suggestedNumber = nextNumberFor(startClientId);
    setForm({
      ...blank,
      number: suggestedNumber,
      clientId: startClientId,
      invoiceDate: start,
      dueDate: plusDays(start, 30),
      vatRate: String(data.settings.defaultVatRate),
      rate: startClient?.rate != null ? String(startClient.rate) : "",
    });
  }, [
    open,
    invoice,
    duplicateFrom,
    additionalFor,
    defaultClientId,
    data.clients,
    data.companies,
    data.invoices,
    data.payments,
    data.settings.defaultVatRate,
    data.settings.invoicePrefix,
    data.settings.nextInvoiceNumber,
  ]);

  // Names already used as End Client for the selected client (suggestions only;
  // anything can still be typed).
  const endClientSuggestions = useMemo(
    () => endClientOptions(data.invoices, form.clientId).names,
    [data.invoices, form.clientId],
  );

  const set = <K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const computedAmount = useMemo(() => {
    if (form.billingType === "hours") {
      const hrs = Number(form.hours) || 0;
      const rate = Number(form.rate) || 0;
      return round2(hrs * rate);
    }
    if (form.billingType === "items") {
      const sum = form.lineItems.reduce(
        (acc, li) => acc + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0),
        0,
      );
      return round2(sum);
    }
    return null;
  }, [form.billingType, form.hours, form.rate, form.lineItems]);

  const preview = useMemo(() => {
    const draft = {
      amountExVat:
        form.billingType === "hours" || form.billingType === "items"
          ? (computedAmount ?? 0)
          : Number(form.amountExVat) || 0,
      vatIncluded: form.vatIncluded,
      vatRate: Number(form.vatRate) || 0,
      vatMode: form.vatMode,
      vatPaidBefore: form.vatMode === "remaining" ? Number(form.vatPaidBefore) || 0 : undefined,
    } as Invoice;
    return { ex: draft.amountExVat, vat: vatAmount(draft), total: amountIncVat(draft) };
  }, [
    form.billingType,
    form.amountExVat,
    computedAmount,
    form.vatIncluded,
    form.vatRate,
    form.vatMode,
    form.vatPaidBefore,
  ]);

  const setLineItem = (key: string, patch: Partial<LineItemForm>) =>
    setForm((f) => ({
      ...f,
      lineItems: f.lineItems.map((li) => (li.key === key ? { ...li, ...patch } : li)),
    }));

  const addLineItem = () =>
    setForm((f) => ({ ...f, lineItems: [...f.lineItems, blankLineItem()] }));

  const removeLineItem = (key: string) =>
    setForm((f) => ({ ...f, lineItems: f.lineItems.filter((li) => li.key !== key) }));

  const fail = (message: string): void => {
    toast.error(message);
  };

  const buildPayload = () => {
    if (!form.number.trim()) return fail("Invoice number is required.");
    if (!form.clientId) return fail("Select a client for this invoice.");
    if (!form.invoiceDate || !form.dueDate) return fail("Invoice and due dates are required.");

    let amount: number;
    let hours: number | undefined;
    let rate: number | undefined;
    let lineItemsPayload:
      | { description: string; quantity: number; unitPrice: number; orderIndex: number }[]
      | undefined;

    if (form.billingType === "hours") {
      hours = Number(form.hours);
      rate = Number(form.rate);
      if (!Number.isFinite(hours) || hours <= 0) return fail("Enter hours greater than zero.");
      if (!Number.isFinite(rate) || rate <= 0) return fail("Enter a rate greater than zero.");
      amount = round2(hours * rate);
    } else if (form.billingType === "items") {
      if (form.lineItems.length === 0) return fail("Add at least one line item.");
      lineItemsPayload = form.lineItems.map((li, i) => {
        const quantity = Number(li.quantity) || 0;
        const unitPrice = Number(li.unitPrice) || 0;
        return { description: li.description.trim(), quantity, unitPrice, orderIndex: i };
      });
      if (lineItemsPayload.some((li) => !li.description))
        return fail("Every line item needs a description.");
      if (lineItemsPayload.every((li) => li.quantity * li.unitPrice === 0))
        return fail("Enter a quantity and unit price for at least one line item.");
      amount = round2(lineItemsPayload.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0));
    } else {
      amount = Number(form.amountExVat);
      if (!Number.isFinite(amount) || amount <= 0)
        return fail("Enter an amount greater than zero.");
    }

    // Scoped duplicate check: the same invoice number is fine across
    // different billing companies/clients (per the business workflow) — we
    // only guard against two invoices with the same number under the same
    // billing company (or, for clients with no company set, the same
    // client), which is where a collision would actually be confusing.
    const companyIdFor = (clientId: string) =>
      data.clients.find((c) => c.id === clientId)?.companyId ?? null;
    const scopeKey = companyIdFor(form.clientId) ?? `client:${form.clientId}`;
    const duplicate = data.invoices.some((i) => {
      if (i.id === invoice?.id) return false;
      if (i.number.toLowerCase() !== form.number.trim().toLowerCase()) return false;
      const iScope = companyIdFor(i.clientId) ?? `client:${i.clientId}`;
      return iScope === scopeKey;
    });
    if (duplicate) return fail("That invoice number already exists for this company/client.");

    const payload = {
      number: form.number.trim(),
      clientId: form.clientId,
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate,
      poReference: form.poReference.trim(),
      endClient: form.endClient.trim(),
      description: form.description.trim(),
      amountExVat: amount,
      hours,
      rate,
      vatIncluded: form.vatIncluded,
      vatRate: form.vatIncluded ? Number(form.vatRate) || 0 : 0,
      vatMode: form.vatMode,
      vatPaidBefore:
        form.vatIncluded && form.vatMode === "remaining"
          ? round2(Math.max(0, Number(form.vatPaidBefore) || 0))
          : undefined,
      paymentTerms: form.paymentTerms,
      notes: form.notes,
      lineItems: lineItemsPayload,
      approved: form.approved,
      originalInvoiceId: form.originalInvoiceId,
    };
    return payload;
  };

  // Step 1: validate the form and move to the read-only review screen.
  // Nothing is written to the database yet.
  const goToReview = (): void => {
    if (submitting) return;
    const payload = buildPayload();
    if (!payload) return;
    setStep("review");
  };

  // Step 2: the user confirms from the review screen — only now do we
  // actually create/update the invoice. `submitting` is set immediately so
  // repeated clicks on Confirm can't create duplicate invoices.
  const confirmCreate = (): void => {
    if (submitting) return;
    const payload = buildPayload();
    if (!payload) {
      // Something about the form became invalid since Review was opened
      // (e.g. the client list changed) — send the user back to fix it.
      setStep("form");
      return;
    }
    setSubmitting(true);
    if (invoice) {
      updateInvoice(invoice.id, payload);
      toast.success("Invoice updated.");
    } else {
      addInvoice(payload, form.hoursEntryId || undefined);
      toast.success(additionalFor ? "Additional invoice created." : "Invoice added.");
    }
    onOpenChange(false);
  };

  const selectedClient = data.clients.find((c) => c.id === form.clientId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {step === "review"
              ? "Review Invoice"
              : invoice
                ? "Edit Invoice"
                : additionalFor
                  ? `Additional Invoice (Ref. ${additionalFor.number})`
                  : "Create Invoice"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {step === "review"
              ? "Check the details below, then confirm to create the invoice. Go back to make changes."
              : additionalFor
                ? "A separate, independent invoice with its own number, lines, VAT and payments — it references the original but never changes it."
                : "Enter the invoice details. VAT and totals are calculated from the amount."}
          </DialogDescription>
        </DialogHeader>

        {step === "review" ? (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-sm border border-border p-4 text-[13px] sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Invoice Number
                </p>
                <p className="font-medium">{form.number.trim() || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Client
                </p>
                <p className="font-medium">
                  {selectedClient?.company || selectedClient?.name || "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Invoice Date
                </p>
                <p>{formatDate(form.invoiceDate)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Due Date
                </p>
                <p>{formatDate(form.dueDate)}</p>
              </div>
              {form.poReference ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    PO / Reference
                  </p>
                  <p>{form.poReference}</p>
                </div>
              ) : null}
              {form.endClient.trim() ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    End Client
                  </p>
                  <p>{form.endClient.trim()}</p>
                </div>
              ) : null}
              {additionalFor ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Additional invoice for
                  </p>
                  <p>{additionalFor.number}</p>
                </div>
              ) : null}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Approval Status
                </p>
                <p>{form.approved ? "Approved" : "Unapproved"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  VAT
                </p>
                <p>
                  {form.vatIncluded
                    ? `${form.vatRate}% (${form.vatMode === "remaining" ? "on remaining balance" : "on full amount"})`
                    : "Not applied"}
                </p>
              </div>
              {form.description ? (
                <div className="sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Description
                  </p>
                  <p>{form.description}</p>
                </div>
              ) : null}
              {form.billingType === "items" && form.lineItems.length > 0 ? (
                <div className="sm:col-span-2 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Line Items
                  </p>
                  {form.lineItems.map((li) => (
                    <div key={li.key} className="flex justify-between gap-2">
                      <span>{li.description || "—"}</span>
                      <span className="num">
                        {li.quantity} × {formatMoney(Number(li.unitPrice) || 0)} ={" "}
                        {formatMoney((Number(li.quantity) || 0) * (Number(li.unitPrice) || 0))}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
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
                  Amount inc VAT
                </p>
                <p className="num text-[15px] font-semibold">{formatMoney(preview.total)}</p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("form")}
                disabled={submitting}
              >
                Back
              </Button>
              <Button size="sm" onClick={confirmCreate} disabled={submitting}>
                {submitting ? "Saving…" : invoice ? "Confirm Changes" : "Confirm & Create Invoice"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Invoice Number"
                htmlFor="inv-number"
                hint="Prefix and number are both freely editable."
              >
                <Input
                  id="inv-number"
                  value={form.number}
                  onChange={(e) => set("number", e.target.value)}
                />
              </Field>
              <Field label="Client">
                <Select
                  value={form.clientId}
                  onValueChange={(v) => {
                    setForm((f) => {
                      const clientRate = data.clients.find((c) => c.id === v)?.rate;
                      const shouldPrefillRate =
                        f.billingType === "hours" && !f.rate && clientRate != null;
                      // A brand-new invoice still carrying the auto-suggested number
                      // follows the newly picked client's company; a number the
                      // person typed (or any edit/additional invoice) is left alone.
                      const numberWasAuto =
                        !invoice &&
                        !additionalFor &&
                        f.number === nextInvoiceNumberFor(data, f.clientId);
                      return {
                        ...f,
                        clientId: v,
                        number: numberWasAuto ? nextInvoiceNumberFor(data, v) : f.number,
                        rate: shouldPrefillRate ? String(clientRate) : f.rate,
                        // The picked Hours entry belonged to the old client — clear it.
                        hoursEntryId: "",
                      };
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.company}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Invoice Date" htmlFor="inv-date">
                <Input
                  id="inv-date"
                  type="date"
                  value={form.invoiceDate}
                  onChange={(e) => set("invoiceDate", e.target.value)}
                />
              </Field>
              <Field label="Due Date" htmlFor="inv-due">
                <Input
                  id="inv-due"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => set("dueDate", e.target.value)}
                />
              </Field>
              <Field
                label="PO / Reference"
                htmlFor="inv-po"
                hint="Client's purchase order or reference number, if any."
              >
                <Input
                  id="inv-po"
                  value={form.poReference}
                  onChange={(e) => set("poReference", e.target.value)}
                />
              </Field>
              <Field
                label="End Client (optional)"
                htmlFor="inv-end-client"
                hint="Who this invoice is really for, when one client account carries several. Leave empty if not needed."
              >
                <Input
                  id="inv-end-client"
                  list="inv-end-client-options"
                  value={form.endClient}
                  onChange={(e) => set("endClient", e.target.value)}
                  placeholder="e.g. Site / end customer name"
                  autoComplete="off"
                />
                <datalist id="inv-end-client-options">
                  {endClientSuggestions.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </Field>
              <Field label="Description" htmlFor="inv-desc" className="sm:col-span-2">
                <Input
                  id="inv-desc"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Services supplied"
                />
              </Field>
              <Field label="Billing Type" className="sm:col-span-2">
                <Select
                  value={form.billingType}
                  onValueChange={(v) => set("billingType", v as BillingType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amount">Fixed Amount</SelectItem>
                    <SelectItem value="hours">Hours × Rate</SelectItem>
                    <SelectItem value="items">Line Items</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {form.billingType === "items" ? (
                <div className="space-y-2 sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Line Items
                  </p>
                  <div className="space-y-2">
                    {form.lineItems.map((li) => (
                      <div key={li.key} className="flex items-start gap-2">
                        <Input
                          className="flex-[3]"
                          placeholder="Description"
                          value={li.description}
                          onChange={(e) => setLineItem(li.key, { description: e.target.value })}
                        />
                        <Input
                          className="flex-1"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Qty"
                          value={li.quantity}
                          onChange={(e) => setLineItem(li.key, { quantity: e.target.value })}
                        />
                        <Input
                          className="flex-1"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Unit price"
                          value={li.unitPrice}
                          onChange={(e) => setLineItem(li.key, { unitPrice: e.target.value })}
                        />
                        <div className="flex h-9 w-24 items-center justify-end text-[13px] num">
                          {formatMoney((Number(li.quantity) || 0) * (Number(li.unitPrice) || 0))}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => removeLineItem(li.key)}
                          aria-label="Remove line item"
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={addLineItem}>
                    + Add Line Item
                  </Button>
                  <Field
                    label="Amount ex VAT (£)"
                    hint="Calculated automatically as the sum of line items."
                  >
                    <Input readOnly disabled value={formatMoney(computedAmount ?? 0)} />
                  </Field>
                </div>
              ) : form.billingType === "hours" ? (
                <>
                  {!invoice ? (
                    <Field
                      label="Link to Hours Entry"
                      htmlFor="inv-hours-entry"
                      className="sm:col-span-2"
                      hint="Picking an entry fills Hours & Rate from it and marks that entry as invoiced."
                    >
                      <Select
                        value={form.hoursEntryId || "none"}
                        onValueChange={(v) => {
                          if (v === "none") {
                            setForm((f) => ({ ...f, hoursEntryId: "" }));
                            return;
                          }
                          const entry = data.hours.find((h) => h.id === v);
                          setForm((f) => ({
                            ...f,
                            hoursEntryId: v,
                            hours: entry ? String(entry.totalHours) : f.hours,
                            rate: entry ? String(entry.rate) : f.rate,
                          }));
                        }}
                      >
                        <SelectTrigger id="inv-hours-entry">
                          <SelectValue placeholder="Not linked — enter hours manually" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not linked — enter hours manually</SelectItem>
                          {data.hours
                            .filter((h) => h.clientId === form.clientId && !h.invoiceId)
                            .sort((a, b) => b.month.localeCompare(a.month))
                            .map((h) => (
                              <SelectItem key={h.id} value={h.id}>
                                {h.month} — {h.totalHours}h @ £{h.rate}/hr
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : null}
                  <Field label="Hours" htmlFor="inv-hours">
                    <Input
                      id="inv-hours"
                      type="number"
                      min="0"
                      step="0.25"
                      value={form.hours}
                      onChange={(e) => set("hours", e.target.value)}
                    />
                  </Field>
                  <Field label="Rate (£/hr)" htmlFor="inv-rate">
                    <Input
                      id="inv-rate"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.rate}
                      onChange={(e) => set("rate", e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Amount ex VAT (£)"
                    hint="Calculated automatically from Hours × Rate."
                    className="sm:col-span-2"
                  >
                    <Input readOnly disabled value={formatMoney(computedAmount ?? 0)} />
                  </Field>
                  {invoice ? (
                    <div className="grid grid-cols-3 gap-3 rounded-sm border border-border bg-surface-muted px-4 py-3 sm:col-span-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Total Hours
                        </p>
                        <p className="num text-[15px] font-semibold">
                          {formatHours(invoice.hours ?? 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Processed Hours
                        </p>
                        <p className="num text-[15px] font-semibold">
                          {formatHours(processedHoursForInvoice(invoice.id, data.subcontracts))}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Remaining Hours
                        </p>
                        <p className="num text-[15px] font-semibold">
                          {formatHours(remainingInvoiceHours(invoice, data.subcontracts) ?? 0)}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <Field label="Amount ex VAT (£)" htmlFor="inv-amount">
                  <Input
                    id="inv-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amountExVat}
                    onChange={(e) => set("amountExVat", e.target.value)}
                  />
                </Field>
              )}
              <Field label="VAT Rate (%)" htmlFor="inv-vat-rate">
                <Input
                  id="inv-vat-rate"
                  type="number"
                  min="0"
                  step="0.5"
                  disabled={!form.vatIncluded}
                  value={form.vatRate}
                  onChange={(e) => set("vatRate", e.target.value)}
                />
              </Field>
              <Field label="VAT Included" hint="Turn off for zero-rated or VAT-exempt invoices.">
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    checked={form.vatIncluded}
                    onCheckedChange={(v) => set("vatIncluded", v)}
                    id="inv-vat"
                  />
                  <span className="text-[13px] text-muted-foreground">
                    {form.vatIncluded ? "VAT applied" : "No VAT"}
                  </span>
                </div>
              </Field>
              <Field
                label="VAT Basis"
                hint="On remaining balance: VAT is charged only on what's still unpaid, never retroactively on amounts already paid."
                className="sm:col-span-2"
              >
                <Select
                  value={form.vatMode}
                  onValueChange={(v) => set("vatMode", v as VatMode)}
                  disabled={!form.vatIncluded}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full invoice amount</SelectItem>
                    <SelectItem value="remaining">Remaining (unpaid) balance</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.vatIncluded && form.vatMode === "remaining" ? (
                <Field
                  label="Already paid before VAT (ex VAT)"
                  hint="e.g. the payroll payment. VAT is charged only on (invoice amount − this), and this base stays fixed when later payments are added."
                  htmlFor="inv-vat-paid-before"
                  className="sm:col-span-2"
                >
                  <Input
                    id="inv-vat-paid-before"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.vatPaidBefore}
                    onChange={(e) => set("vatPaidBefore", e.target.value)}
                  />
                </Field>
              ) : null}
              <Field
                label="Approval Status"
                hint="Separate from payment status — used for internal sign-off."
              >
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    checked={form.approved}
                    onCheckedChange={(v) => set("approved", v)}
                    id="inv-approved"
                  />
                  <span className="text-[13px] text-muted-foreground">
                    {form.approved ? "Approved" : "Unapproved"}
                  </span>
                </div>
              </Field>
              <Field label="Payment Terms">
                <Select value={form.paymentTerms} onValueChange={(v) => set("paymentTerms", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["On receipt", "7 days", "14 days", "30 days", "45 days", "60 days"].map(
                      (t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Notes" htmlFor="inv-notes" className="sm:col-span-2">
                <Textarea
                  id="inv-notes"
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
                  Amount inc VAT
                </p>
                <p className="num text-[15px] font-semibold">{formatMoney(preview.total)}</p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={goToReview} disabled={submitting}>
                Review
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
