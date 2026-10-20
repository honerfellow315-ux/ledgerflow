import { Plus, Trash2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_EXPENSES } from "@/lib/payroll/types";
import type { ExpenseDraft } from "@/lib/payroll/expenseDrafts";

/**
 * Expenses of one person for the month: an amount and an optional description per
 * expense, with "Add more" up to MAX_EXPENSES. Empty = 0.
 */
export function ExpensesEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: ExpenseDraft[];
  onChange: (rows: ExpenseDraft[]) => void;
  disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<ExpenseDraft>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => {
    const next = rows.filter((_, k) => k !== i);
    onChange(next.length ? next : [{ amount: "", note: "" }]);
  };
  return (
    <div className="rounded-md border border-border px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-foreground">Expenses</p>
        <p className="text-[11px] text-muted-foreground">
          Amount + optional description · up to {MAX_EXPENSES}
        </p>
      </div>
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[130px_1fr_auto]">
            <Input
              inputMode="decimal"
              placeholder="0"
              aria-label={`Expense ${i + 1} amount`}
              value={r.amount}
              onChange={(e) => set(i, { amount: e.target.value })}
              disabled={disabled}
            />
            <Input
              placeholder="Description (optional)"
              aria-label={`Expense ${i + 1} description`}
              maxLength={200}
              value={r.note}
              onChange={(e) => set(i, { note: e.target.value })}
              disabled={disabled}
            />
            {!disabled && (rows.length > 1 || r.amount || r.note) ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove expense ${i + 1}`}
                onClick={() => remove(i)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {!disabled ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={rows.length >= MAX_EXPENSES}
          onClick={() => onChange([...rows, { amount: "", note: "" }])}
        >
          <Plus className="size-4" /> Add more
        </Button>
      ) : null}
    </div>
  );
}
