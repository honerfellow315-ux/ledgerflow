import { Button } from "@/components/ui/button";
import { SheetStatusBadge, Pill } from "./badges";
import { fmtHours, fmtDiff, fmtDateTime, maskNi, FORMAT_LABEL } from "@/lib/timesheets/data";
import { formatMoney } from "@/lib/ledger/calc";
import type { SheetListItem } from "@/lib/timesheets/listTypes";

export function TimesheetList({
  items,
  disabled,
  onOpen,
  onDelete,
}: {
  items: SheetListItem[];
  disabled: boolean;
  onOpen: (id: string) => void;
  /** Left out for people without the Delete permission. */
  onDelete?: (sheet: SheetListItem) => void;
}) {
  const actions = (s: SheetListItem) => (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => onOpen(s.id)}
        aria-label={`Review ${s.staffName}`}
      >
        Review
      </Button>
      {onDelete ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={disabled}
          onClick={() => onDelete(s)}
          aria-label={`Delete timesheet for ${s.staffName}`}
        >
          Delete
        </Button>
      ) : null}
    </div>
  );
  const identity = (s: SheetListItem) => (
    <div className="min-w-0 space-y-1">
      <button
        type="button"
        className="text-left font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => onOpen(s.id)}
      >
        {s.staffName}
      </button>
      <p className="text-xs text-muted-foreground">
        {s.monthLabel} · NI {maskNi(s.ni)}
      </p>
      <p title={s.fileName} className="break-all text-xs text-muted-foreground">
        {FORMAT_LABEL[s.format]} · {s.fileName}
        {s.sheetLabel ? ` (${s.sheetLabel})` : ""}
      </p>
      <p className="text-xs text-muted-foreground">Uploaded {fmtDateTime(s.uploadedAt)}</p>
      {s.matchedBy === "name" && !s.staffConfirmed ? (
        <Pill tone="warn">Confirm name match</Pill>
      ) : null}
      {s.statedMismatch ? <Pill tone="warn">File total differs from rows</Pill> : null}
    </div>
  );
  const record = (s: SheetListItem) =>
    s.status === "staff_not_found" ? "Not linked" : fmtHours(s.recordHours);
  const diff = (s: SheetListItem) =>
    s.status === "staff_not_found" ? "Not compared" : fmtDiff(s.diff);
  const pay = (s: SheetListItem) =>
    s.status === "staff_not_found" || s.payAmount === null
      ? "—"
      : `${formatMoney(s.payAmount)}${s.issues > 0 ? " *" : ""}`;
  const payHrs = (s: SheetListItem) =>
    s.status === "staff_not_found" || s.payHours === null ? "—" : fmtHours(s.payHours);
  return (
    <>
      <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
        Sheet hours are compared with imported shifts for the same staff member and month.
        Difference = sheet hours minus recorded hours (differences you accepted are not counted).
        Pay = matched rows + the actual hours you entered when accepting a difference, × rate. * =
        rows still to look at are not included yet.
      </p>
      <div className="divide-y divide-border md:hidden">
        {items.map((s) => (
          <article key={s.id} className="space-y-3 p-4">
            {identity(s)}
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-surface-muted p-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Pay hours</dt>
                <dd className="mt-1 font-semibold num">{payHrs(s)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Amount to pay</dt>
                <dd className="mt-1 font-semibold num">{pay(s)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sheet hours</dt>
                <dd className="mt-1 font-semibold num">{fmtHours(s.sheetHours)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Recorded hours</dt>
                <dd className="mt-1 font-semibold num">{record(s)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Difference</dt>
                <dd className="mt-1 font-semibold num">{diff(s)}</dd>
              </div>
            </dl>
            <SheetStatusBadge status={s.status} />
            {actions(s)}
          </article>
        ))}
      </div>
      <div className="hidden md:block">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="bg-surface-muted text-muted-foreground">
            <tr>
              <th scope="col" className="w-[26%] px-4 py-3">
                Staff / uploaded file
              </th>
              <th scope="col" className="w-[10%] px-2 py-3 text-right">
                Sheet hours
              </th>
              <th scope="col" className="w-[10%] px-2 py-3 text-right">
                Recorded hours
              </th>
              <th scope="col" className="w-[9%] px-2 py-3 text-right">
                Difference
              </th>
              <th scope="col" className="w-[9%] px-2 py-3 text-right">
                Pay hours
              </th>
              <th scope="col" className="w-[12%] px-2 py-3 text-right">
                Amount to pay
              </th>
              <th scope="col" className="w-[24%] px-4 py-3">
                Status / actions
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-t border-border align-top hover:bg-surface-muted/40">
                <td className="px-4 py-4">{identity(s)}</td>
                <td className="px-2 py-4 text-right font-semibold num">{fmtHours(s.sheetHours)}</td>
                <td className="px-2 py-4 text-right num">{record(s)}</td>
                <td className="px-2 py-4 text-right num">{diff(s)}</td>
                <td className="px-2 py-4 text-right num">{payHrs(s)}</td>
                <td className="px-2 py-4 text-right font-semibold num">{pay(s)}</td>
                <td className="px-4 py-4">
                  <SheetStatusBadge status={s.status} />
                  {actions(s)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
