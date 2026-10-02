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
import { createShiftCompany, updateShiftCompany } from "@/lib/actions/salary";
import { errorMessage, useRefreshSalary, useShiftCompanies } from "@/lib/payroll/queries";

/** Manage the companies whose shift exports are imported (RSS, ESS, and any new
 * one). Switching one off only hides it from the import list: shifts already
 * imported keep their amounts. Nothing is ever deleted. */
export function ShiftCompaniesDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the new company's code, so the import screen can pick it. */
  onCreated?: (code: string) => void;
}) {
  const refresh = useRefreshSalary();
  const { data: companies = [] } = useShiftCompanies(open);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error(errorMessage(err, "Could not save."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const c = code.trim().toUpperCase();
    const ok = await run(
      () => createShiftCompany({ data: { code: c, name: name.trim() || c } }),
      "Company added.",
    );
    if (ok) {
      setCode("");
      setName("");
      onCreated?.(c);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Shift companies</DialogTitle>
          <DialogDescription>
            The companies you import shift exports from. Add a new one and it appears in the import
            list straight away.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            className="w-28 uppercase"
            value={code}
            maxLength={20}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Code"
            aria-label="Company code"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            aria-label="Company name"
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.trim() && !busy) void add();
            }}
          />
          <Button disabled={busy || code.trim().length < 2} onClick={() => void add()}>
            <Plus className="size-4" /> Add
          </Button>
        </div>

        <div className="divide-y divide-border rounded-md border border-border">
          {companies.map((c) => (
            <div key={c.code} className="flex items-center justify-between gap-3 px-3 py-2">
              <span
                className={
                  c.active
                    ? "text-[13px] font-medium"
                    : "text-[13px] text-muted-foreground line-through"
                }
              >
                <span className="num font-semibold">{c.code}</span>
                {c.name !== c.code ? <span className="text-muted-foreground"> · {c.name}</span> : null}
              </span>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {c.active ? "On" : "Off"}
                <Switch
                  checked={c.active}
                  disabled={busy}
                  onCheckedChange={(v) =>
                    run(
                      () => updateShiftCompany({ data: { code: c.code, patch: { active: v } } }),
                      v ? "Company switched on." : "Company switched off.",
                    )
                  }
                />
              </label>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
