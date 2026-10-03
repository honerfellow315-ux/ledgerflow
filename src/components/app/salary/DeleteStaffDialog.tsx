import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteStaff, previewStaffDelete } from "@/lib/actions/staffDelete";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";

/**
 * Confirm step for deleting one staff profile or every staff profile.
 * It first asks the server what the delete would take with it (read-only),
 * shows that, and only deletes on the final click. Everything goes to the
 * Recycle Bin, so it can be restored.
 */
export function DeleteStaffDialog({
  open,
  onOpenChange,
  ids,
  label,
  requireTyping,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ids: string[];
  /** e.g. "Ali Khan" or "all 142 staff" */
  label: string;
  /** Delete-all asks the user to type DELETE first. */
  requireTyping: boolean;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const impact = useQuery({
    queryKey: ["staff-delete-impact", ids.length, ids[0] ?? ""],
    queryFn: () => unwrap(previewStaffDelete({ data: { ids } })),
    enabled: open && ids.length > 0,
    staleTime: 0,
    gcTime: 0,
  });

  const remove = useMutation({
    mutationFn: () => unwrap(deleteStaff({ data: { ids } })),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["trash"] });
      const skipped =
        res.skipped > 0
          ? ` ${res.skipped} skipped (in a closed month): ${res.skippedNames.join(", ")}.`
          : "";
      toast.success(
        `${res.deleted} staff moved to the Recycle Bin.${skipped}`,
      );
      onDone();
    },
    onError: (err: unknown) => toast.error(errorMessage(err, "Could not delete.")),
  });

  const i = impact.data;
  const typedOk = !requireTyping || typed.trim().toUpperCase() === "DELETE";
  const nothingToDelete = !!i && i.staff === 0;
  const canConfirm = !!i && !nothingToDelete && typedOk && !remove.isPending;

  return (
    <AlertDialog open={open} onOpenChange={(v) => (remove.isPending ? undefined : onOpenChange(v))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">Delete {label}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-[13px]">
              {impact.isLoading ? (
                <p>Checking what this will affect…</p>
              ) : impact.error ? (
                <p className="text-destructive">
                  {errorMessage(impact.error, "Couldn't check what this will affect.")}
                </p>
              ) : i ? (
                <>
                  <p>
                    {i.staff} staff profile{i.staff === 1 ? "" : "s"} will move to the Recycle Bin.
                    Their lines are removed from the sheets until you restore them:
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    <li>{i.salaryLines} salary sheet line{i.salaryLines === 1 ? "" : "s"}</li>
                    <li>{i.payrollLines} payroll sheet line{i.payrollLines === 1 ? "" : "s"}</li>
                    <li>{i.payments} cash payment{i.payments === 1 ? "" : "s"} recorded on those lines</li>
                    <li>{i.shifts} imported shift row{i.shifts === 1 ? "" : "s"} un-linked</li>
                  </ul>
                  {i.blocked > 0 ? (
                    <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-warning">
                      {i.blocked} {i.blocked === 1 ? "person is" : "people are"} in a closed month and
                      will be skipped: {i.blockedNames.join(", ")}
                      {i.blocked > i.blockedNames.length ? "…" : ""}
                    </p>
                  ) : null}
                  <p>You can bring them back from the Recycle Bin (admin only).</p>
                </>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {requireTyping ? (
          <div className="space-y-1.5">
            <p className="text-[12px] text-muted-foreground">
              Type <span className="font-semibold text-foreground">DELETE</span> to confirm.
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={!canConfirm} onClick={() => remove.mutate()}>
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
