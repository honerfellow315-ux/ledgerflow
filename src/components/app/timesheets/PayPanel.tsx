import { useState } from "react";
import { Check, Pencil, Trash2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/ledger/calc";
import type { TimesheetPayInfo } from "@/lib/actions/timesheets";

export interface PaymentInput {
  date: string;
  amount: number;
  method: string;
  reference: string;
  notes: string;
}
export interface AccountInput {
  accountHolderName: string;
  accountNumber: string;
  sortCode: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const field = "mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm";

/**
 * Bank account details of the staff member, and the payments (cash, bank transfer ...) made
 * for this month. Payments are Salary Sheet payments (P1, P2 ...), so both screens agree.
 */
export function PayPanel({
  info,
  busy,
  monthLabel,
  onSaveAccount,
  onAddPayment,
  onDeletePayment,
}: {
  info: TimesheetPayInfo;
  busy: boolean;
  monthLabel: string;
  onSaveAccount?: (a: AccountInput) => void;
  onAddPayment?: (p: PaymentInput) => void;
  onDeletePayment?: (paymentId: string) => void;
}) {
  const acc = info.account;
  const [editAcc, setEditAcc] = useState(false);
  const [holder, setHolder] = useState(acc?.accountHolderName ?? "");
  const [number, setNumber] = useState(acc?.accountNumber ?? "");
  const [sort, setSort] = useState(acc?.sortCode ?? "");

  const pay = info.pay;
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("Bank Transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const amountNum = amount.trim() === "" ? NaN : Number(amount);
  const canAdd = Number.isFinite(amountNum) && amountNum > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  if (!info.staffId || !pay) return null;
  const maskedNumber = number
    ? `${"•".repeat(Math.max(0, number.length - 4))}${number.slice(-4)}`
    : "";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {info.canSeeAccount ? (
        <section
          aria-label="Account details"
          className="rounded-xl border border-border p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Account details</h2>
            {onSaveAccount ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setEditAcc(!editAcc)}
              >
                <Pencil className="size-4" />{" "}
                {editAcc ? "Close" : acc?.accountNumber ? "Edit" : "Add"}
              </Button>
            ) : null}
          </div>
          {editAcc && onSaveAccount ? (
            <div className="mt-3 space-y-3">
              <label className="block text-xs">
                Account holder name
                <input
                  value={holder}
                  onChange={(e) => setHolder(e.target.value)}
                  maxLength={120}
                  className={field}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">
                  Account number
                  <input
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    inputMode="numeric"
                    maxLength={20}
                    className={cn(field, "num")}
                  />
                </label>
                <label className="block text-xs">
                  Sort code
                  <input
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    placeholder="12-34-56"
                    maxLength={12}
                    className={cn(field, "num")}
                  />
                </label>
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  onSaveAccount({
                    accountHolderName: holder,
                    accountNumber: number,
                    sortCode: sort,
                  });
                  setEditAcc(false);
                }}
              >
                <Check className="size-4" /> Save account details
              </Button>
              <p className="text-xs text-muted-foreground">
                Saved on the Staff record, so Staff, Payroll Sheet and Salary Sheet show the same
                details.
              </p>
            </div>
          ) : acc && (acc.accountHolderName || acc.accountNumber || acc.sortCode) ? (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Holder</dt>
              <dd>{acc.accountHolderName || "—"}</dd>
              <dt className="text-muted-foreground">Account</dt>
              <dd className="num">{maskedNumber || "—"}</dd>
              <dt className="text-muted-foreground">Sort code</dt>
              <dd className="num">{acc.sortCode || "—"}</dd>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No bank details saved yet.</p>
          )}
        </section>
      ) : null}

      <section aria-label="Payments" className="rounded-xl border border-border p-4 sm:p-5">
        <h2 className="text-base font-semibold text-foreground">Payments — {monthLabel}</h2>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg bg-surface-muted/60 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">To pay</p>
            <p className="num font-semibold">{formatMoney(pay.payable)}</p>
          </div>
          <div className="rounded-lg bg-surface-muted/60 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid</p>
            <p className="num font-semibold">{formatMoney(pay.paid)}</p>
          </div>
          <div className="rounded-lg bg-surface-muted/60 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Balance</p>
            <p
              className={cn(
                "num font-semibold",
                pay.balance > 0
                  ? "text-warning"
                  : pay.balance < 0
                    ? "text-destructive"
                    : "text-success",
              )}
            >
              {formatMoney(pay.balance)}
            </p>
          </div>
        </div>

        {pay.payments.length > 0 ? (
          <ul className="mt-3 divide-y divide-border/60 text-sm">
            {pay.payments.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 break-words">
                  <span className="text-muted-foreground">P{pay.payments.length - i}</span> ·{" "}
                  {p.date} · {p.method}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span className="flex items-center gap-2">
                  <span className="num font-medium">{formatMoney(p.amount)}</span>
                  {onDeletePayment && !pay.salaryClosed ? (
                    <button
                      type="button"
                      aria-label="Delete payment"
                      disabled={busy}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onDeletePayment(p.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No payment recorded yet.</p>
        )}

        {!pay.hasSalaryMonth ? (
          <p className="mt-3 text-xs text-warning">
            There is no Salary Sheet for {monthLabel} yet. Create it in Salary Sheet to record
            payments.
          </p>
        ) : pay.salaryClosed ? (
          <p className="mt-3 text-xs text-muted-foreground">
            The Salary Sheet month is closed; reopen it there to add payments.
          </p>
        ) : onAddPayment ? (
          <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs">
                Amount (£)
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={pay.balance > 0 ? String(pay.balance) : ""}
                  className={cn(field, "num")}
                />
              </label>
              <label className="block text-xs">
                Date
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={field}
                />
              </label>
              <label className="block text-xs">
                Paid by
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className={field}
                >
                  {info.methods.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                Reference
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={120}
                  className={field}
                />
              </label>
            </div>
            <label className="block text-xs">
              Notes (optional)
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={300}
                className={field}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || !canAdd}
                onClick={() => {
                  onAddPayment({ date, amount: amountNum, method, reference, notes });
                  setAmount("");
                  setReference("");
                  setNotes("");
                }}
              >
                <Check className="size-4" /> Add payment
              </Button>
              {pay.balance > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setAmount(String(pay.balance))}
                >
                  Fill balance
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
