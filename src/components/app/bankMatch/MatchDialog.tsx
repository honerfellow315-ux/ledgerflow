import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/app/timesheets/badges";
import { formatMoney, formatDate } from "@/lib/ledger/calc";
import {
  compareAmount,
  duplicateWarning,
  orderForChoosing,
  overpays,
  type BankLine,
} from "@/lib/bankMatch/data";
import { listChoices } from "@/lib/actions/bankMatch";
import { unwrap } from "@/lib/unwrap";
import { errorMessage } from "@/lib/payroll/queries";

export function MatchDialog({
  line,
  busy,
  onClose,
  onChoose,
}: {
  line: BankLine | null;
  busy: boolean;
  onClose: () => void;
  onChoose: (lineId: string, invoiceId: string, recordAnyway: boolean) => void;
}) {
  return (
    <Dialog open={line !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {line ? (
          <Body key={line.id} line={line} busy={busy} onClose={onClose} onChoose={onChoose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  line,
  busy,
  onClose,
  onChoose,
}: {
  line: BankLine;
  busy: boolean;
  onClose: () => void;
  onChoose: (lineId: string, invoiceId: string, recordAnyway: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ["bankMatch", "choices", line.id],
    queryFn: () => unwrap(listChoices({ data: { lineId: line.id } })),
    staleTime: 0,
    gcTime: 0,
  });
  const list = q.data
    ? orderForChoosing({ ...line, candidateIds: q.data.candidateIds }, q.data.invoices)
    : [];
  const [picked, setPicked] = useState<string | null>(null);
  const [anyway, setAnyway] = useState(false);
  const chosenId = picked ?? line.invoiceId ?? list[0]?.id ?? "";
  const chosen = list.find((i) => i.id === chosenId);
  const warn = chosen ? duplicateWarning(line, chosen) : null;
  const tooMuch = chosen ? overpays(line.amount, chosen) : false;
  const canSave = !!chosen && !tooMuch && !busy && (!warn || anyway);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose the invoice</DialogTitle>
        <DialogDescription>
          {formatDate(line.date)}, {formatMoney(line.amount)}, {line.description}
        </DialogDescription>
      </DialogHeader>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading open invoices...</p>
      ) : null}
      {q.isError ? (
        <p className="text-sm text-destructive">
          {errorMessage(q.error, "The invoices could not be loaded.")}
        </p>
      ) : null}
      {q.data && list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoice has money outstanding.</p>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="sr-only">Open invoices</legend>
        {list.map((inv) => {
          const c = compareAmount(line.amount, inv);
          const on = chosenId === inv.id;
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
                onChange={() => {
                  setPicked(inv.id);
                  setAnyway(false);
                }}
              />
              <span className="min-w-0 flex-1 text-[13px]">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {inv.number}, {inv.client}
                  </span>
                  <span className="num font-medium text-foreground">
                    {formatMoney(inv.outstanding)}
                  </span>
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {inv.dueDate ? <>Due {formatDate(inv.dueDate)}</> : null}
                  <Pill tone={c.tone}>{c.label}</Pill>
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {warn ? (
        <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5 text-[13px] text-foreground">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={anyway}
            onChange={(e) => setAnyway(e.target.checked)}
          />
          <span>{warn} Tick to record it anyway as a second payment.</span>
        </label>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!canSave} onClick={() => onChoose(line.id, chosenId, anyway)}>
          Record payment
        </Button>
      </DialogFooter>
    </>
  );
}
