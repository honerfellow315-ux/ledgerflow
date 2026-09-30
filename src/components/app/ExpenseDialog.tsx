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
import { expenseTotal, formatMoney } from "@/lib/ledger/calc";
import type { Expense, PaymentMethod } from "@/lib/ledger/types";

const blank = {
  date: "",
  category: "",
  description: "",
  amountExVat: "",
  vatAmount: "",
  method: "Bank Transfer" as PaymentMethod,
  paidTo: "",
  reference: "",
  comments: "",
  invoiceId: "",
};

const today = () => new Date().toISOString().slice(0, 10);

type Errors = { [K in keyof typeof blank]?: string | undefined };

export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expense?: Expense | null | undefined;
}) {
  const { data, invoiceViews, addExpense, updateExpense } = useLedger();
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (expense) {
      setForm({
        date: expense.date,
        category: expense.category,
        description: expense.description,
        amountExVat: String(expense.amountExVat),
        vatAmount: String(expense.vatAmount),
        method: expense.method,
        paidTo: expense.paidTo,
        reference: expense.reference ?? "",
        comments: expense.comments ?? "",
        invoiceId: expense.invoiceId ?? "",
      });
      return;
    }
    setForm({
      ...blank,
      date: today(),
      category: data.settings.expenseCategories[0] ?? "",
      method: data.settings.paymentMethods[0] ?? "Bank Transfer",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense]);

  const set = <K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const preview = useMemo(
    () =>
      expenseTotal({
        amountExVat: Number(form.amountExVat) || 0,
        vatAmount: Number(form.vatAmount) || 0,
      } as Expense),
    [form.amountExVat, form.vatAmount],
  );

  const validate = (): Errors => {
    const next: Errors = {};
    if (!form.date) next.date = "Enter an expense date.";
    if (!form.category) next.category = "Select a category.";
    if (!form.description.trim()) next.description = "Description is required.";
    if (!form.paidTo.trim()) next.paidTo = "Paid to is required.";

    const amount = Number(form.amountExVat);
    if (form.amountExVat.trim() === "") next.amountExVat = "Amount is required.";
    else if (!Number.isFinite(amount)) next.amountExVat = "Amount must be a number.";
    else if (amount < 0) next.amountExVat = "Amount cannot be negative.";
    else if (amount <= 0) next.amountExVat = "Amount must be greater than zero.";

    const vat = Number(form.vatAmount);
    if (form.vatAmount.trim() === "") next.vatAmount = "VAT amount is required (enter 0 if none).";
    else if (!Number.isFinite(vat)) next.vatAmount = "VAT amount must be a number.";
    else if (vat < 0) next.vatAmount = "VAT amount cannot be negative.";

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
      date: form.date,
      category: form.category,
      description: form.description.trim(),
      amountExVat: Number(form.amountExVat),
      vatAmount: Number(form.vatAmount),
      method: form.method,
      paidTo: form.paidTo.trim(),
      reference: form.reference.trim(),
      comments: form.comments.trim(),
      invoiceId: form.invoiceId,
    };

    if (expense) {
      updateExpense(expense.id, payload);
      toast.success("Expense updated.");
    } else {
      addExpense(payload);
      toast.success("Expense recorded.");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {expense ? "Edit Expense" : "Add Expense"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Record a business cost with its VAT so the net, VAT and gross totals stay accurate.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="ex-date" error={errors.date}>
            <Input
              id="ex-date"
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label="Category" error={errors.category}>
            <Select value={form.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {data.settings.expenseCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Description"
            htmlFor="ex-desc"
            className="sm:col-span-2"
            error={errors.description}
          >
            <Input
              id="ex-desc"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <Field label="Amount ex VAT (£)" htmlFor="ex-amount" error={errors.amountExVat}>
            <Input
              id="ex-amount"
              type="number"
              min="0"
              step="0.01"
              value={form.amountExVat}
              onChange={(e) => set("amountExVat", e.target.value)}
            />
          </Field>
          <Field label="VAT Amount (£)" htmlFor="ex-vat" error={errors.vatAmount}>
            <Input
              id="ex-vat"
              type="number"
              min="0"
              step="0.01"
              value={form.vatAmount}
              onChange={(e) => set("vatAmount", e.target.value)}
            />
          </Field>
          <Field label="Payment Method">
            <Select value={form.method} onValueChange={(v) => set("method", v as PaymentMethod)}>
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
          <Field label="Paid To" htmlFor="ex-paid-to" error={errors.paidTo}>
            <Input
              id="ex-paid-to"
              value={form.paidTo}
              onChange={(e) => set("paidTo", e.target.value)}
            />
          </Field>
          <Field label="Reference" htmlFor="ex-ref">
            <Input
              id="ex-ref"
              value={form.reference}
              onChange={(e) => set("reference", e.target.value)}
            />
          </Field>
          <Field label="Comments" htmlFor="ex-comments" className="sm:col-span-2">
            <Textarea
              id="ex-comments"
              rows={2}
              value={form.comments}
              onChange={(e) => set("comments", e.target.value)}
            />
          </Field>
          <Field
            label="Related Invoice"
            htmlFor="ex-invoice"
            className="sm:col-span-2"
            hint="Optional — link this expense to the invoice it was incurred for (e.g. a device repair job) to see the two netted against each other on the Invoices list."
          >
            <Select
              value={form.invoiceId || "none"}
              onValueChange={(v) => set("invoiceId", v === "none" ? "" : v)}
            >
              <SelectTrigger id="ex-invoice">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {invoiceViews.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.number} — {i.clientCompany}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-sm border border-border bg-surface-muted px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Net
            </p>
            <p className="num text-[15px] font-semibold">
              {formatMoney(Number(form.amountExVat) || 0)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              VAT
            </p>
            <p className="num text-[15px] font-semibold">
              {formatMoney(Number(form.vatAmount) || 0)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total
            </p>
            <p className="num text-[15px] font-semibold">{formatMoney(preview)}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit}>
            {expense ? "Save Changes" : "Add Expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
