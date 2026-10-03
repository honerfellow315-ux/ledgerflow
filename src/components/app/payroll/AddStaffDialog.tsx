import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, UserPlus } from "@/lib/icons";
import { addStaffToSheet } from "@/lib/actions/payroll";
import { errorMessage } from "@/lib/payroll/queries";
import { useAssignableStaff, useRefreshPayroll } from "@/lib/payroll/sheetQueries";
import { StaffDialog } from "@/components/app/salary/StaffDialog";

/**
 * Adds a person to this company's sheet: pick an existing staff member (also works for
 * someone who is already in another payroll company — same record, same ID), or create
 * a brand-new one, who is attached straight away with the "New Staff" comment.
 */
export function AddStaffDialog({
  open,
  onOpenChange,
  sheetId,
  companyName,
  defaultRate,
  canCreateStaff,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sheetId: string;
  companyName: string;
  defaultRate: number;
  canCreateStaff: boolean;
}) {
  const refresh = useRefreshPayroll();
  const q = useAssignableStaff(sheetId, open);
  const [search, setSearch] = useState("");
  const [rate, setRate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const rateNum = rate.trim() === "" ? undefined : Number(rate);
  const rateBad = rateNum !== undefined && (!Number.isFinite(rateNum) || rateNum < 0);

  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((s) => !needle || s.name.toLowerCase().includes(needle))
      .slice(0, 200);
  }, [q.data, search]);

  async function add(staffId: string, comment?: string) {
    if (rateBad) {
      toast.error("Enter a valid rate or leave it blank.");
      return;
    }
    setBusyId(staffId);
    try {
      await addStaffToSheet({
        data: {
          sheetId,
          staffId,
          ...(comment ? { comment } : {}),
          ...(rateNum !== undefined ? { rate: rateNum } : {}),
        },
      });
      await refresh();
      toast.success("Added to the sheet.");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not add."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Dialog open={open && !showNew} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add staff to {companyName}</DialogTitle>
            <DialogDescription>
              Choose someone already on file — they can be in several payroll companies at once.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  autoFocus
                  className="pl-8"
                  placeholder="Search staff by name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Input
                inputMode="decimal"
                placeholder={`Rate (default ${defaultRate})`}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                aria-label="Hourly rate for this person (optional)"
              />
            </div>

            <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {q.isLoading ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : list.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {search ? "No one matches." : "Everyone is already on this sheet."}
                </p>
              ) : (
                list.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{s.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[
                          !s.active ? "Inactive" : "",
                          s.contractStatus === "P45" ? "P45" : "",
                          s.alsoIn.length ? `Also in ${s.alsoIn.join(", ")}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId !== null}
                      onClick={() => add(s.id)}
                    >
                      {busyId === s.id ? "Adding…" : "Add"}
                    </Button>
                  </div>
                ))
              )}
            </div>

            {canCreateStaff ? (
              <Button variant="secondary" className="w-full" onClick={() => setShowNew(true)}>
                <UserPlus className="size-4" /> New staff member…
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <StaffDialog
        open={showNew}
        onOpenChange={(v) => {
          setShowNew(v);
          if (!v) onOpenChange(false);
        }}
        staff={null}
        canEdit
        onSaved={async (saved, isNew) => {
          if (!saved || !isNew || saved instanceof Response) return;
          await addStaffToSheet({
            data: {
              sheetId,
              staffId: saved.id,
              comment: "New Staff",
              ...(rateNum !== undefined && !rateBad ? { rate: rateNum } : {}),
            },
          });
          await refresh();
        }}
      />
    </>
  );
}
