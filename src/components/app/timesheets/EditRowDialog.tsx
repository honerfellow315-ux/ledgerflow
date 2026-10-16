import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/ledger/calc";
import { fmtDate, fmtHours, type SheetRow } from "@/lib/timesheets/data";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Edit the hours and the rate of ONE shift. The same figures are written to the Salary Sheet
 * (our shift record), so everything that is paid or reported from there matches this sheet.
 */
export function EditRowDialog({
  row,
  busy,
  onClose,
  onSubmit,
}: {
  row: SheetRow | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (hours: number, rate: number, note: string) => void;
}) {
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");

  const rowId = row?.id ?? null;
  useEffect(() => {
    if (!row) return;
    // Start from what is paid today: an earlier edit, else the recorded hours, else the sheet's.
    const h = row.edited?.hours ?? row.payHours ?? row.recordHours ?? row.sheetHours;
    const r = row.edited?.rate ?? row.payRate ?? row.rate ?? 0;
    setHours(String(round2(h)));
    setRate(String(round2(r)));
    setNote(row.edited?.note ?? "");
    // Only when another row is opened; typing must never reset the fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  const h = hours.trim() === "" ? null : Number(hours);
  const r = rate.trim() === "" ? null : Number(rate);
  const hOk = h !== null && Number.isFinite(h) && h >= 0 && h <= 24;
  const rOk = r !== null && Number.isFinite(r) && r >= 0 && r <= 1000;
  const total = hOk && rOk ? round2(h * r) : null;

  return (
    <Dialog open={row !== null} onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle>Edit shift</DialogTitle>
              <DialogDescription className="break-words">
                {fmtDate(row.date)}
                {row.site ? ` · ${row.site}` : ""} · Sheet {fmtHours(row.sheetHours)}
                {row.recordHours !== null ? ` · Record ${fmtHours(row.recordHours)}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">
                  Hours worked
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.25"
                    min={0}
                    max={24}
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border bg-background px-2 num"
                  />
                </label>
                <label className="block text-xs">
                  Rate per hour (£)
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={0}
                    max={1000}
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border bg-background px-2 num"
                  />
                </label>
              </div>
              <p className="rounded-md bg-surface-muted/60 px-3 py-2 text-sm">
                Amount for this shift:{" "}
                <strong className="num">{total === null ? "—" : formatMoney(total)}</strong>
              </p>
              <label className="block text-xs">
                Reason (optional)
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. Client confirmed 9 hours"
                  className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                These figures are also saved in the Salary Sheet for this shift, so the pay there
                matches this sheet.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={busy || !hOk || !rOk}
                onClick={() => {
                  if (hOk && rOk) onSubmit(h, r, note.trim());
                }}
              >
                Save shift
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
