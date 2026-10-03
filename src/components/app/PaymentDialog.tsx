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
import { Field } from "./Field";
import { useLedger } from "@/lib/ledger/store";
import {
  formatHours,
  formatMoney,
  hasPayrollSplit,
  hoursRemainingToPay,
  payrollValue,
  round2,
} from "@/lib/ledger/calc";
import type { Payment, PaymentMethod } from "@/lib/ledger/types";

const today = () => new Date().toISOString().slice(0, 10);

export function PaymentDialog({
  open,
  onOpenChange,
  defaultClientId,
  defaultInvoiceId,
  payment,
  blankAmount,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultClientId?: string | undefined;
  defaultInvoiceId?: string | undefined;
  /** Pass an existing payment to edit it instead of recording a new one. */
  payment?: Payment | null | undefined;
  /** When opened as the "mark as Partially Paid" quick action, leave the
   * amount blank instead of prefilling the full outstanding balance — the
   * whole point of "partial" is a specific figure the user must enter. */
  blankAmount?: boolean | undefined;
}) {
  // Credit-adjusted views: an earlier overpayment is already netted off, so the
  // suggested amount / "due" figure is what the client really still owes.
  const { data, invoiceViewsWithCredit: invoiceViews, addPayment, updatePayment } = useLedger();
  const [clientId, setClientId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>("Bank Transfer");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  // "By Hours": amount isn't typed directly — pick an Hours entry for this
  // client, enter how many hours this payment covers, and the amount is
  // hoursPaid × that entry's rate. See hoursPaidForEntry()/hoursRemainingToPay()
  // in calc.ts for how the Hours screen shows this back.
  const [amountMode, setAmountMode] = useState<"amount" | "hours">("amount");
  const [hoursEntryId, setHoursEntryId] = useState("");
  const [hoursPaidInput, setHoursPaidInput] = useState("");

  useEffect(() => {
    if (!open) return;
    if (payment) {
      setClientId(payment.clientId);
      setInvoiceId(payment.invoiceId);
      setDate(payment.date);
      setMethod(payment.method);
      setAmount(String(payment.amount));
      setReference(payment.reference === "—" ? "" : payment.reference);
      setNotes(payment.notes ?? "");
      if (payment.hoursEntryId) {
        setAmountMode("hours");
        setHoursEntryId(payment.hoursEntryId);
        setHoursPaidInput(payment.hoursPaid != null ? String(payment.hoursPaid) : "");
      } else {
        setAmountMode("amount");
        setHoursEntryId("");
        setHoursPaidInput("");
      }
      return;
    }
    const invoice = defaultInvoiceId ? invoiceViews.find((i) => i.id === defaultInvoiceId) : null;
    setClientId(invoice?.clientId ?? defaultClientId ?? data.clients[0]?.id ?? "");
    setInvoiceId(invoice?.id ?? "");
    setDate(today());
    setMethod("Bank Transfer");
    setAmount(invoice && !blankAmount ? String(invoice.effectiveOutstanding) : "");
    setReference("");
    setNotes("");
    setAmountMode("amount");
    setHoursEntryId("");
    setHoursPaidInput("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payment, defaultClientId, defaultInvoiceId, blankAmount]);

  const clientInvoices = useMemo(
    () => invoiceViews.filter((i) => i.clientId === clientId),
    [invoiceViews, clientId],
  );
  const clientHours = useMemo(
    () => data.hours.filter((h) => h.clientId === clientId),
    [data.hours, clientId],
  );
  const selectedHoursEntry = clientHours.find((h) => h.id === hoursEntryId);
  const remainingToPay = selectedHoursEntry
    ? hoursRemainingToPay(selectedHoursEntry, data.payments) +
      // Editing this same payment: its own hours are already excluded from
      // "remaining" above (same reasoning as availableToApply below for
      // invoices) — add them back so the field validates against the right ceiling.
      (payment && payment.hoursEntryId === hoursEntryId ? (payment.hoursPaid ?? 0) : 0)
    : 0;

  // In "By Hours" mode the amount field is derived, not typed — keep it in
  // sync whenever the entry or the hours-paid figure changes.
  useEffect(() => {
    if (amountMode !== "hours") return;
    if (!selectedHoursEntry) return;
    const hrs = Number(hoursPaidInput) || 0;
    setAmount(String(round2(hrs * selectedHoursEntry.rate)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountMode, hoursPaidInput, selectedHoursEntry?.id, selectedHoursEntry?.rate]);

  const selected = invoiceViews.find((i) => i.id === invoiceId);

  // When editing, this payment's own current amount is already included in
  // `selected.outstanding` (outstanding = total - all payments incl. this
  // one). Add it back so editing the amount is validated against the
  // invoice total, not against a balance that already excludes this payment.
  const availableToApply =
    selected != null
      ? payment && payment.invoiceId === selected.id
        ? selected.outstanding + payment.amount
        : selected.effectiveOutstanding
      : 0;

  // Payroll split invoice (e.g. 10,000 h at the payroll rate + remaining hours at
  // the billing rate): the payroll part is paid first and has its own figure, so
  // offer it as a one-click amount. Method does not matter (Payroll, Bank, Cash...).
  const payrollDue =
    !payment && selected && hasPayrollSplit(selected)
      ? round2(payrollValue(selected) - selected.paid)
      : 0;

  const fail = (message: string): void => {
    toast.error(message);
  };

  const submit = (): void => {
    if (!clientId) return fail("Select a client.");
    if (!selected) return fail("Select an invoice.");
    if (!date) return fail("Enter a payment date.");
    if (amountMode === "hours") {
      if (!selectedHoursEntry) return fail("Select an Hours entry.");
      const hrs = Number(hoursPaidInput);
      if (!Number.isFinite(hrs) || hrs <= 0) return fail("Enter hours greater than zero.");
      if (hrs > remainingToPay + 0.004)
        return fail(
          `That's more than the ${formatHours(remainingToPay)} hours still owed on this entry.`,
        );
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0)
      return fail("Enter a payment amount greater than zero.");

    const payload = {
      invoiceId: selected.id,
      clientId: selected.clientId,
      date,
      method,
      amount: value,
      reference: reference.trim() || "—",
      notes,
      hoursEntryId: amountMode === "hours" ? hoursEntryId : "",
      ...(amountMode === "hours" ? { hoursPaid: Number(hoursPaidInput) } : {}),
    };

    if (payment) {
      updatePayment(payment.id, payload);
      toast.success(`Payment updated to ${formatMoney(value)} against ${selected.number}.`);
    } else {
      addPayment(payload);
      const overpaid = round2(value - availableToApply);
      toast.success(
        overpaid > 0.004
          ? `Payment of ${formatMoney(value)} recorded against ${selected.number} — ${formatMoney(overpaid)} extra saved as credit for their next invoice.`
          : `Payment of ${formatMoney(value)} recorded against ${selected.number}.`,
      );
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {payment ? "Edit Payment" : "Record Payment"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {payment
              ? "Correct this payment. The invoice's paid amount, outstanding balance and status recalculate automatically."
              : blankAmount
                ? "Enter the amount actually received. The invoice will show as Partially Paid once this is less than the full balance."
                : "Record a payment received against an invoice."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client">
            <Select
              value={clientId}
              onValueChange={(v) => {
                setClientId(v);
                setInvoiceId("");
                setAmount("");
                setAmountMode("amount");
                setHoursEntryId("");
                setHoursPaidInput("");
              }}
              disabled={!!payment}
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
          <Field
            label="Invoice"
            hint={selected ? `Available to apply: ${formatMoney(availableToApply)}` : undefined}
          >
            <Select
              value={invoiceId}
              onValueChange={(v) => {
                setInvoiceId(v);
                if (!payment) {
                  const inv = invoiceViews.find((i) => i.id === v);
                  if (inv) setAmount(blankAmount ? "" : String(inv.effectiveOutstanding));
                }
              }}
              disabled={!!payment}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select invoice" />
              </SelectTrigger>
              <SelectContent>
                {clientInvoices.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No invoices for this client
                  </SelectItem>
                ) : (
                  clientInvoices.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.number} — {formatMoney(i.effectiveOutstanding)} due
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Payment Date" htmlFor="pm-date">
            <Input
              id="pm-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Payment Method">
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.settings.paymentMethods.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount by" className="sm:col-span-2">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={amountMode === "amount" ? "default" : "outline"}
                onClick={() => {
                  setAmountMode("amount");
                  if (selected) setAmount(String(selected.effectiveOutstanding));
                }}
              >
                Fixed Amount
              </Button>
              <Button
                type="button"
                size="sm"
                variant={amountMode === "hours" ? "default" : "outline"}
                disabled={clientHours.length === 0}
                onClick={() => setAmountMode("hours")}
              >
                By Hours
              </Button>
            </div>
            {clientHours.length === 0 ? (
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                No Hours entries recorded for this client yet.
              </p>
            ) : null}
          </Field>

          {amountMode === "hours" ? (
            <>
              <Field label="Hours Entry">
                <Select
                  value={hoursEntryId}
                  onValueChange={(v) => {
                    setHoursEntryId(v);
                    setHoursPaidInput("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Hours entry" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientHours.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.month} — {formatMoney(h.rate)}/hr
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Hours Paid"
                htmlFor="pm-hours"
                hint={
                  selectedHoursEntry
                    ? `Rate £${selectedHoursEntry.rate}/hr · ${formatHours(remainingToPay)} hours still owed`
                    : undefined
                }
              >
                <Input
                  id="pm-hours"
                  type="number"
                  min="0"
                  step="0.25"
                  value={hoursPaidInput}
                  onChange={(e) => setHoursPaidInput(e.target.value)}
                  disabled={!selectedHoursEntry}
                />
              </Field>
            </>
          ) : null}

          <Field
            label="Amount (£)"
            htmlFor="pm-amount"
            className={amountMode === "hours" ? "sm:col-span-2" : undefined}
            hint={
              amountMode === "amount" && selected && Number(amount) > availableToApply + 0.004
                ? `${formatMoney(round2(Number(amount) - availableToApply))} more than what's due — saved as credit and applied automatically to their next invoice(s).`
                : undefined
            }
          >
            <Input
              id="pm-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={amountMode === "hours"}
            />
          </Field>
          {payrollDue > 0.004 && selected && amountMode === "amount" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border bg-surface-muted px-4 py-3 sm:col-span-2">
              <p className="text-[12.5px]">
                Payroll part of this invoice: {formatHours(selected.payrollHours ?? 0)} h × £
                {selected.payrollRate} ={" "}
                <span className="num font-semibold">{formatMoney(payrollDue)}</span> still to record.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setAmount(String(payrollDue));
                  setNotes((n) => n || "Payroll payment");
                  if (data.settings.paymentMethods.includes("Payroll")) setMethod("Payroll");
                }}
              >
                Use payroll amount
              </Button>
            </div>
          ) : null}
          <Field label="Reference" htmlFor="pm-ref">
            <Input
              id="pm-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Bank or payment reference"
            />
          </Field>
          <Field label="Notes" htmlFor="pm-notes" className="sm:col-span-2">
            <Textarea
              id="pm-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit}>
            {payment ? "Save Changes" : "Save Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
