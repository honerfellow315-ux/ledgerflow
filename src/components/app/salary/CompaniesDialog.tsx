import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "@/lib/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { addPayrollCompany, updatePayrollCompany } from "@/lib/actions/salary";
import { errorMessage, useAllPayrollCompanies, useRefreshSalary } from "@/lib/payroll/queries";

/** Manage the payroll columns (ESS, Fortexo, Secure FM, ...). A new company
 * appears as a new column immediately — no code change. Archiving hides the
 * column but keeps every amount already entered in it. */
export function CompaniesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const refresh = useRefreshSalary();
  const { data: companies = [] } = useAllPayrollCompanies(open);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err, "Could not save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Payroll companies</DialogTitle>
          <DialogDescription>
            Each one is a column in the payroll block of the sheet. Archive one to hide its column.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New company, e.g. Leverage"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !busy) {
                void run(() => addPayrollCompany({ data: { name } }), "Company added.").then(() =>
                  setName(""),
                );
              }
            }}
          />
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              run(() => addPayrollCompany({ data: { name } }), "Company added.").then(() =>
                setName(""),
              )
            }
          >
            <Plus className="size-4" /> Add
          </Button>
        </div>

        <div className="divide-y divide-border rounded-md border border-border">
          {companies.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No payroll companies yet.
            </p>
          ) : (
            companies.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span
                  className={
                    c.active
                      ? "text-[13px] font-medium"
                      : "text-[13px] text-muted-foreground line-through"
                  }
                >
                  {c.name}
                </span>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {c.active ? "Shown" : "Archived"}
                  <Switch
                    checked={c.active}
                    disabled={busy}
                    onCheckedChange={(v) =>
                      run(
                        () => updatePayrollCompany({ data: { id: c.id, patch: { active: v } } }),
                        v ? "Column shown." : "Column archived.",
                      )
                    }
                  />
                </label>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
