import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RowResultBadge } from "@/components/app/timesheets/badges";
import { formatMoney } from "@/lib/ledger/calc";
import { fmtDate, fmtDiff, fmtHours, type SheetRow } from "@/lib/timesheets/data";

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "lf-read-field col-span-2 sm:col-span-3" : "lf-read-field"}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Read mode: shows one timesheet row in full, so the table rows can stay one size. */
export function ReadRowDialog({ row, onClose }: { row: SheetRow | null; onClose: () => void }) {
  const has = (t: string) => Boolean(t) && t !== "—";
  const diff =
    row && (row.accepted || row.edited)
      ? fmtDiff(0)
      : row && row.recordHours !== null
        ? fmtDiff(row.sheetHours - row.recordHours)
        : "—";
  return (
    <Dialog open={row !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle>Shift on {fmtDate(row.date)}</DialogTitle>
              <DialogDescription>Everything about this row in one place.</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Field label="Site on sheet" wide>
                {row.site || "Not provided"}
              </Field>
              <Field label="Start">{has(row.start) ? row.start : "Not given"}</Field>
              <Field label="End">{has(row.end) ? row.end : "Not given"}</Field>
              <Field label="Result">
                <RowResultBadge result={row.result} />
              </Field>
              <Field label="Sheet hours">{fmtHours(row.sheetHours)}</Field>
              <Field label="Recorded hours">
                {row.recordHours === null ? "—" : fmtHours(row.recordHours)}
              </Field>
              <Field label="Difference">{diff}</Field>
              <Field label="Rate">
                {row.payRate === null || row.payRate === undefined
                  ? "—"
                  : row.payRate > 0
                    ? formatMoney(row.payRate)
                    : "No rate"}
              </Field>
              <Field label="Pay hours">
                {row.payAmount === null || row.payAmount === undefined
                  ? "—"
                  : fmtHours(row.payHours ?? 0)}
              </Field>
              <Field label="Amount">
                {row.payAmount === null || row.payAmount === undefined
                  ? "—"
                  : formatMoney(row.payAmount)}
              </Field>
              {row.note ? (
                <Field label="Note" wide>
                  <span className="whitespace-pre-line">{row.note}</span>
                </Field>
              ) : null}
              {row.accepted ? (
                <Field label={`Accepted by ${row.accepted.by}`} wide>
                  {row.accepted.actualHours !== null && row.accepted.actualHours !== undefined
                    ? `Actual ${fmtHours(row.accepted.actualHours)} — `
                    : ""}
                  <span className="whitespace-pre-line">{row.accepted.note}</span>
                </Field>
              ) : null}
              {row.edited ? (
                <Field label={`Edited by ${row.edited.by}`} wide>
                  {fmtHours(row.edited.hours)} × {formatMoney(row.edited.rate)}
                  {row.edited.note ? (
                    <span className="block whitespace-pre-line text-muted-foreground">
                      {row.edited.note}
                    </span>
                  ) : null}
                </Field>
              ) : null}
            </dl>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
