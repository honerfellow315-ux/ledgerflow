import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/ledger/calc";
import { fmtDate, fmtDiff, fmtHours, type SheetRow } from "@/lib/timesheets/data";

/** Short reasons the approver can tap; the text stays editable. */
const QUICK_REASONS = [
  "Our booking time was wrong",
  "Guard's sheet was wrong",
  "Client confirmed the hours",
  "Break not deducted",
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning" | "danger" | "success";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted/60 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-base font-semibold num",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * "Accept with note" as a pop-up in front of the page (like the other dialogs), so the row
 * never grows. Also used to EDIT an acceptance that was already made.
 */
export function AcceptDifferenceDialog({
  row,
  busy,
  onClose,
  onSubmit,
}: {
  row: SheetRow | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string, actualHours: number) => void;
}) {
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");

  const rowId = row?.id ?? null;
  useEffect(() => {
    if (!row) return;
    setHours(
      row.accepted?.actualHours !== null && row.accepted?.actualHours !== undefined
        ? String(row.accepted.actualHours)
        : "",
    );
    setNote(row.accepted?.note ?? "");
    // Only when another row is opened; typing must never reset the fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  const parsed = hours.trim() === "" ? null : Number(hours);
  const valid = parsed !== null && Number.isFinite(parsed) && parsed >= 0 && parsed <= 24;
  const rate = row ? (row.payRate ?? row.rate ?? 0) : 0;
  const amount = useMemo(() => (valid ? round2(parsed * rate) : null), [valid, parsed, rate]);
  const canSave = valid && note.trim().length >= 3 && !busy;
  const editing = Boolean(row?.accepted);
  const diff = row && row.recordHours !== null ? round2(row.sheetHours - row.recordHours) : null;

  return (
    <Dialog open={row !== null} onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit accepted difference" : "Accept with note"}</DialogTitle>
              <DialogDescription className="break-words">
                {fmtDate(row.date)}
                {row.site ? ` · ${row.site}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <Figure label="Sheet says" value={fmtHours(row.sheetHours)} />
                <Figure
                  label="Our record"
                  value={row.recordHours === null ? "No shift" : fmtHours(row.recordHours)}
                />
                <Figure
                  label="Difference"
                  value={diff === null ? "—" : fmtDiff(diff)}
                  tone={diff === null ? "warning" : diff > 0 ? "danger" : "warning"}
                />
              </div>
              {row.note ? (
                <p className="rounded-md bg-surface-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {row.note}
                </p>
              ) : null}

              <div className="space-y-2">
                <label htmlFor="accept-hours" className="text-sm font-medium text-foreground">
                  Actual hours worked
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="accept-hours"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={24}
                    step={0.25}
                    autoFocus
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder="e.g. 8.5"
                    className="h-10 w-32 rounded-md border border-input bg-transparent px-3 text-base text-foreground num focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant={parsed === row.sheetHours ? "default" : "outline"}
                    onClick={() => setHours(String(row.sheetHours))}
                  >
                    Sheet {fmtHours(row.sheetHours)}
                  </Button>
                  {row.recordHours !== null ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={parsed === row.recordHours ? "default" : "outline"}
                      onClick={() => setHours(String(row.recordHours))}
                    >
                      Record {fmtHours(row.recordHours)}
                    </Button>
                  ) : null}
                </div>
                {parsed !== null && !valid ? (
                  <p className="text-xs text-destructive">Enter hours between 0 and 24.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label htmlFor="accept-note" className="text-sm font-medium text-foreground">
                  Reason
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REASONS.map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => setNote(text)}
                      className="rounded-full border border-border bg-surface-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <Textarea
                  id="accept-note"
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why are these the right hours? (required)"
                />
              </div>

              <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  This row will be paid
                </p>
                <p className="mt-1 text-sm text-foreground num">
                  {valid ? fmtHours(parsed) : "— h"} × {formatMoney(rate)}
                  <span className="mx-2 text-muted-foreground">=</span>
                  <strong className="text-lg text-primary">
                    {amount === null ? "—" : formatMoney(amount)}
                  </strong>
                </p>
                {rate <= 0 ? (
                  <p className="mt-1 text-xs text-warning">
                    No rate was found in the Salary Sheet for this person, so the amount is £0.00.
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  After accepting, the difference on this row becomes 0 h.
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!canSave}
                onClick={() => {
                  if (valid) onSubmit(note.trim(), parsed);
                }}
              >
                {editing ? "Save changes" : "Accept"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
