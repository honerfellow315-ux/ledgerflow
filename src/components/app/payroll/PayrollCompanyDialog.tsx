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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/app/Field";
import { Pencil, Plus } from "@/lib/icons";
import { createSheetCompany, updateSheetCompany } from "@/lib/actions/payroll";
import { errorMessage } from "@/lib/payroll/queries";
import { useRefreshPayroll } from "@/lib/payroll/sheetQueries";
import type { PayrollSheetCompany } from "@/lib/payroll/sheetTypes";
import { formatMoney } from "@/lib/ledger/calc";

interface Form {
  name: string;
  defaultRate: string;
  address: string;
  notes: string;
}
const blank: Form = { name: "", defaultRate: "", address: "", notes: "" };

/** Add / edit / archive the payroll companies. Each company gets its own sheet every month. */
export function PayrollCompanyDialog({
  open,
  onOpenChange,
  companies,
  canCreate,
  canEdit,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: PayrollSheetCompany[];
  canCreate: boolean;
  canEdit: boolean;
  onCreated?: (c: PayrollSheetCompany) => void;
}) {
  const refresh = useRefreshPayroll();
  const [editing, setEditing] = useState<PayrollSheetCompany | "new" | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startNew = () => {
    setForm(blank);
    setError("");
    setEditing("new");
  };
  const startEdit = (c: PayrollSheetCompany) => {
    setForm({
      name: c.name,
      defaultRate: String(c.defaultRate),
      address: c.address ?? "",
      notes: c.notes ?? "",
    });
    setError("");
    setEditing(c);
  };

  async function save() {
    const name = form.name.trim();
    const rate = form.defaultRate.trim() === "" ? 0 : Number(form.defaultRate);
    if (!name) return setError("Company name is required.");
    if (!Number.isFinite(rate) || rate < 0) return setError("Enter a valid hourly rate.");
    setBusy(true);
    try {
      if (editing === "new") {
        const created = await createSheetCompany({
          data: { name, defaultRate: rate, address: form.address, notes: form.notes },
        });
        await refresh();
        toast.success("Payroll company added.");
        if (created && !(created instanceof Response)) onCreated?.(created);
      } else if (editing) {
        await updateSheetCompany({
          data: {
            id: editing.id,
            patch: { name, defaultRate: rate, address: form.address, notes: form.notes },
          },
        });
        await refresh();
        toast.success("Company updated.");
      }
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err, "Could not save."));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c: PayrollSheetCompany, active: boolean) {
    setBusy(true);
    try {
      await updateSheetCompany({ data: { id: c.id, patch: { active } } });
      await refresh();
      toast.success(active ? "Company restored." : "Company archived.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not update."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setEditing(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payroll companies</DialogTitle>
          <DialogDescription>
            Every company has its own payroll sheet each month. A person can be on several
            companies. Archiving hides a company without losing its history.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="space-y-3">
            <Field label="Company name">
              <Input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field
              label="Default hourly rate (£)"
              hint="Used for staff who have no rate of their own."
            >
              <Input
                inputMode="decimal"
                value={form.defaultRate}
                onChange={(e) => setForm({ ...form, defaultRate: e.target.value })}
              />
            </Field>
            <Field label="Address (optional)">
              <Textarea
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field label="Notes (optional)">
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            {error ? (
              <p role="alert" className="text-[12px] font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                Back
              </Button>
              <Button onClick={save} disabled={busy}>
                {editing === "new" ? "Add company" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {canCreate ? (
              <Button size="sm" onClick={startNew}>
                <Plus className="size-4" /> Add payroll company
              </Button>
            ) : null}
            <div className="divide-y divide-border rounded-md border border-border">
              {companies.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No payroll companies yet.
                </p>
              ) : (
                companies.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p
                        className={
                          c.active
                            ? "truncate text-[13px] font-medium"
                            : "truncate text-[13px] text-muted-foreground line-through"
                        }
                      >
                        {c.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatMoney(c.defaultRate)}/hr · {c.staffCount} active staff
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {canEdit ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => startEdit(c)}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            {c.active ? "Active" : "Archived"}
                            <Switch
                              checked={c.active}
                              disabled={busy}
                              onCheckedChange={(v) => toggle(c, v)}
                            />
                          </label>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
