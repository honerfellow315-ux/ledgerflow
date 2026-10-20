import { useEffect, useState } from "react";
import { Check, Pencil, Trash2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/ledger/calc";
import type { TimesheetPayInfo } from "@/lib/actions/timesheets";
import { ExpensesEditor } from "@/components/app/salary/ExpensesEditor";
import { fromExpenseDrafts, toExpenseDrafts, type ExpenseDraft } from "@/lib/payroll/expenseDrafts";

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
  onSaveExpenses,
  onDeletePayment,
}: {
  info: TimesheetPayInfo;
  busy: boolean;
  monthLabel: string;
  onSaveAccount?: (a: AccountInput) => void;
  onAddPayment?: (p: PaymentInput) => void;
  onSaveExpenses?: (expenses: { amount: number; note?: string }[]) => void;
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

  // Expenses of this person and month (the same ones the Salary Sheet form shows).
  const savedExpenses = pay?.expenses ?? [];
  const savedKey = JSON.stringify(savedExpenses);
  const [expRows, setExpRows] = useState<ExpenseDraft[]>(() => toExpenseDrafts(savedExpenses));
  useEffect(() => {
    setExpRows(toExpenseDrafts(savedExpenses));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, info.staffId]);

  if (!info.staffId || !pay) return null;
  const expChanged = JSON.stringify(fromExpenseDrafts(expRows)) !== savedKey;
  const canEditExpenses = Boolean(onSaveExpenses) && pay.hasSalaryMonth && !pay.salaryClosed;
  // Saved bank details, shown under "Bank Transfer" so the person paying knows which account.
  const bankLines: [string, string][] = acc
    ? (
        [
          ["Account holder", (acc.accountHolderName ?? "").trim()],
          ["Account number", (acc.accountNumber ?? "").trim()],
          ["Sort code", (acc.sortCode ?? "").trim()],
        ] as [string, string][]
      ).filter(([, v]) => v)
    : [];
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
            {pay.expensesTotal !== 0 ? (
              <p className="text-[11px] text-muted-foreground">
                incl. expenses {formatMoney(pay.expensesTotal)}
              </p>
            ) : null}
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

        {canEditExpenses || savedExpenses.length > 0 ? (
          <div className="mt-3">
            <ExpensesEditor rows={expRows} onChange={setExpRows} disabled={!canEditExpenses} />
            {canEditExpenses ? (
              <Button
                size="sm"
                className="mt-2"
                disabled={busy || !expChanged}
                onClick={() => onSaveExpenses?.(fromExpenseDrafts(expRows))}
              >
                <Check className="size-4" /> Save expenses
              </Button>
            ) : null}
          </div>
        ) : null}

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
              {method === "Bank Transfer" && bankLines.length > 0 ? (
                <div className="col-span-2 rounded-lg bg-surface-muted/60 px-3 py-2 text-xs">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="font-semibold text-muted-foreground">
                      Bank details — pay into this account
                    </p>
                    {onSaveAccount ? (
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => setEditAcc(true)}
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                    {bankLines.map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="num select-all break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
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
