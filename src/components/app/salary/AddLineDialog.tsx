import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search } from "@/lib/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addEntry } from "@/lib/actions/salary";
import { errorMessage, useRefreshSalary } from "@/lib/payroll/queries";
import { formatMonthLabel, normNi } from "@/lib/payroll/calc";
import type { Staff } from "@/lib/payroll/types";

/** Adds a staff member who has no line yet in this month (e.g. someone paid
 * only by payroll, with no shifts in the export). */
export function AddLineDialog({
  open,
  onOpenChange,
  periodId,
  month,
  staff,
  haveStaffIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  periodId: string;
  month: string;
  staff: Staff[];
  haveStaffIds: Set<string>;
}) {
  const refresh = useRefreshSalary();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ni = normNi(q);
    return staff
      .filter((s) => s.active && !haveStaffIds.has(s.id))
      .filter(
        (s) =>
          !needle ||
          s.name.toLowerCase().includes(needle) ||
          s.rssId === needle ||
          s.essId === needle ||
          (ni.length >= 3 && normNi(s.ni).includes(ni)),
      )
      .slice(0, 40);
  }, [staff, haveStaffIds, q]);

  async function add(s: Staff) {
    setBusyId(s.id);
    try {
      await addEntry({ data: { periodId, staffId: s.id } });
      await refresh();
      toast.success(`${s.name} added to ${formatMonthLabel(month)}.`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not add that line."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a line to {formatMonthLabel(month)}</DialogTitle>
          <DialogDescription>
            Staff who aren't on this month's sheet yet. New people are added on the Staff screen.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, ID or NI"
            className="pl-8"
          />
        </div>
        <div className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
          {candidates.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No one left to add.
            </p>
          ) : (
            candidates.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {[s.rssId && `RSS ${s.rssId}`, s.essId && `ESS ${s.essId}`, s.area]
                      .filter(Boolean)
                      .join(" · ") || "No IDs"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === s.id}
                  onClick={() => add(s)}
                >
                  Add
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
