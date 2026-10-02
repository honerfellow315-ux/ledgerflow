import { AlertTriangle, CheckCircle2 } from "@/lib/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/ledger/calc";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { errorMessage, useImportChecks } from "@/lib/payroll/queries";

/**
 * "Check the data first": what the month's imported shifts look like and what
 * needs a person's eyes before the lines are trusted. Read-only; it re-reads
 * every time it opens so it always reflects the latest import / edits.
 */
export function CheckReportDialog({
  open,
  onOpenChange,
  periodId,
  month,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  periodId: string;
  month: string;
}) {
  const q = useImportChecks(periodId, open);
  const errors = q.data?.issues.filter((i) => i.level === "error") ?? [];
  const warns = q.data?.issues.filter((i) => i.level === "warn") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check data — {formatMonthLabel(month)}</DialogTitle>
          <DialogDescription>
            Go through this before sending anyone to payroll. Nothing here changes any data.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <p className="text-[13px] text-muted-foreground">Checking…</p>
        ) : q.error ? (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            {errorMessage(q.error, "Couldn't run the checks.")}
          </p>
        ) : q.data ? (
          <div className="space-y-4">
            {q.data.summary.length === 0 ? (
              <p className="rounded-md border border-border bg-surface-muted/50 px-3 py-2 text-[13px]">
                No shifts have been imported into this month yet.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {q.data.summary.map((s) => (
                  <div
                    key={s.source}
                    className="rounded-md border border-border bg-surface-muted/50 px-3 py-2 text-[12px]"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {s.source}
                    </p>
                    <p className="num mt-0.5 text-[13px] font-medium">
                      {s.shifts} shifts · {s.people} people
                    </p>
                    <p className="num text-muted-foreground">
                      {s.hours} hours · {formatMoney(s.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {q.data.issues.length === 0 ? (
              <p className="flex items-center gap-2 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-[13px] text-success">
                <CheckCircle2 className="size-4" /> Everything checks out.
              </p>
            ) : (
              <ul className="space-y-2">
                {[...errors, ...warns].map((i) => (
                  <li
                    key={i.code}
                    className={
                      i.level === "error"
                        ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
                        : "rounded-md border border-warning/30 bg-warning-soft px-3 py-2"
                    }
                  >
                    <p
                      className={`flex items-center gap-2 text-[13px] font-semibold ${i.level === "error" ? "text-destructive" : "text-warning"}`}
                    >
                      <AlertTriangle className="size-4 shrink-0" />
                      {i.title} <span className="num font-normal">({i.count})</span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{i.hint}</p>
                    {i.examples.length > 0 ? (
                      <p className="mt-1 text-[12px] text-foreground">
                        e.g. {i.examples.join(", ")}
                        {i.count > i.examples.length ? " …" : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
