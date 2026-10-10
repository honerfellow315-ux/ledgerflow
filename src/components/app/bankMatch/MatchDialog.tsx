import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/app/timesheets/badges";
import { formatMoney, formatDate } from "@/lib/ledger/calc";
import { compareAmount, suggestions, type BankLine } from "@/lib/bankMatch/data";

export function MatchDialog({
  line,
  onClose,
  onChoose,
}: {
  line: BankLine | null;
  onClose: () => void;
  onChoose: (lineId: string, invoiceId: string) => void;
}) {
  return (
    <Dialog open={line !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {line ? <Body key={line.id} line={line} onClose={onClose} onChoose={onChoose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  line,
  onClose,
  onChoose,
}: {
  line: BankLine;
  onClose: () => void;
  onChoose: (lineId: string, invoiceId: string) => void;
}) {
  const list = suggestions(line);
  const [picked, setPicked] = useState<string>(line.invoiceId ?? list[0]?.id ?? "");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose the invoice</DialogTitle>
        <DialogDescription>
          {formatDate(line.date)}, {formatMoney(line.amount)}, {line.description}
        </DialogDescription>
      </DialogHeader>
      <fieldset className="space-y-2">
        <legend className="sr-only">Open invoices</legend>
        {list.map((inv) => {
          const c = compareAmount(line.amount, inv);
          const on = picked === inv.id;
          return (
            <label
              key={inv.id}
              className={
                on
                  ? "flex cursor-pointer items-start gap-3 rounded-lg border border-primary bg-info-soft px-3 py-2.5"
                  : "flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-accent/40"
              }
            >
              <input
                type="radio"
                name="invoice"
                className="mt-1"
                checked={on}
                onChange={() => setPicked(inv.id)}
              />
              <span className="min-w-0 flex-1 text-[13px]">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {inv.number}, {inv.client}
                  </span>
                  <span className="num font-medium text-foreground">{formatMoney(inv.outstanding)}</span>
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  Due {formatDate(inv.dueDate)}
                  <Pill tone={c.tone}>{c.label}</Pill>
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!picked} onClick={() => onChoose(line.id, picked)}>
          Match to this invoice
        </Button>
      </DialogFooter>
    </>
  );
}
