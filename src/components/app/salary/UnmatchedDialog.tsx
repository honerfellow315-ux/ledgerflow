import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listUnmatchedShiftPeople, rematchShifts } from "@/lib/actions/salary";
import { errorMessage, useRefreshSalary } from "@/lib/payroll/queries";

/** Who the unmatched shifts belong to, with a re-match button for after the
 * missing people have been added / their IDs fixed on the Staff screen. */
export function UnmatchedDialog({
  open,
  onOpenChange,
  periodId,
  locked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  periodId: string;
  locked: boolean;
}) {
  const refresh = useRefreshSalary();
  const [busy, setBusy] = useState(false);
  const { data: people = [], isLoading } = useQuery({
    queryKey: ["salary", "unmatched", periodId],
    queryFn: () => listUnmatchedShiftPeople({ data: { periodId } }),
    enabled: open,
  });

  async function rematch() {
    setBusy(true);
    try {
      const r = await rematchShifts({ data: { periodId } });
      await refresh();
      toast.success(
        r.unmatched === 0
          ? "Every shift is matched now."
          : `${r.unmatched} shifts still unmatched.`,
      );
    } catch (err) {
      toast.error(errorMessage(err, "Could not re-match."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Shifts not matched to anyone</DialogTitle>
          <DialogDescription>
            These people aren't on the Staff list (or their RSS / ESS ID differs). Add them or fix
            their ID on the Staff screen, then re-match — their hours are not in the totals until
            then.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border rounded-md border border-border">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : people.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing unmatched.
            </p>
          ) : (
            people.map((p) => (
              <div
                key={`${p.source}-${p.employeeId}-${p.employeeName}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.employeeName || "(no name)"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {p.source} ID {p.employeeId || "—"}
                  </p>
                </div>
                <span className="num shrink-0 text-[12px] text-muted-foreground">
                  {p.shifts} shifts · {p.hours} h
                </span>
              </div>
            ))
          )}
        </div>
        {!locked ? (
          <Button onClick={rematch} disabled={busy} className="self-end">
            {busy ? "Re-matching…" : "Re-match shifts"}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
