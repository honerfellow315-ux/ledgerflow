import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/app/Field";
import { addStaff, updateStaff } from "@/lib/actions/salary";
import { errorMessage, useRefreshSalary } from "@/lib/payroll/queries";
import type { Staff } from "@/lib/payroll/types";

interface FormState {
  name: string;
  rssId: string;
  essId: string;
  ni: string;
  tag: string;
  area: string;
  accountDetail: string;
  notes: string;
  active: boolean;
}

const blank: FormState = {
  name: "",
  rssId: "",
  essId: "",
  ni: "",
  tag: "",
  area: "",
  accountDetail: "",
  notes: "",
  active: true,
};

const fromStaff = (s: Staff): FormState => ({
  name: s.name,
  rssId: s.rssId,
  essId: s.essId,
  ni: s.ni,
  tag: s.tag,
  area: s.area,
  accountDetail: s.accountDetail,
  notes: s.notes ?? "",
  active: s.active,
});

export function StaffDialog({
  open,
  onOpenChange,
  staff,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = add a new person */
  staff: Staff | null;
  canEdit: boolean;
}) {
  const refresh = useRefreshSalary();
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(staff ? fromStaff(staff) : blank);
    setError("");
  }, [open, staff]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const text = (k: Exclude<keyof FormState, "active">) => (e: { target: { value: string } }) =>
    set(k, e.target.value);

  async function save() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const values = {
        name: form.name.trim(),
        rssId: form.rssId.trim(),
        essId: form.essId.trim(),
        ni: form.ni.trim(),
        tag: form.tag.trim(),
        area: form.area.trim(),
        accountDetail: form.accountDetail.trim(),
        active: form.active,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      };
      if (staff)
        await updateStaff({
          data: { id: staff.id, patch: { ...values, notes: form.notes.trim() } },
        });
      else await addStaff({ data: values });
      await refresh();
      toast.success(staff ? "Staff updated." : "Staff added.");
      onOpenChange(false);
    } catch (err) {
      const msg = errorMessage(err, "Could not save.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{staff ? "Edit staff member" : "Add staff member"}</DialogTitle>
          <DialogDescription>
            One record per person — it is reused every month. RSS / ESS IDs are what shift exports
            are matched on.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <Input value={form.name} onChange={text("name")} disabled={!canEdit} autoFocus />
          </Field>
          <Field label="RSS ID">
            <Input
              value={form.rssId}
              onChange={text("rssId")}
              disabled={!canEdit}
              inputMode="numeric"
            />
          </Field>
          <Field label="ESS ID">
            <Input
              value={form.essId}
              onChange={text("essId")}
              disabled={!canEdit}
              inputMode="numeric"
            />
          </Field>
          <Field label="NI number">
            <Input
              value={form.ni}
              onChange={text("ni")}
              disabled={!canEdit}
              placeholder="AB 12 34 56 C"
            />
          </Field>
          <Field label="Tag">
            <Input
              value={form.tag}
              onChange={text("tag")}
              disabled={!canEdit}
              placeholder="ESS SES"
            />
          </Field>
          <Field label="Area">
            <Input value={form.area} onChange={text("area")} disabled={!canEdit} />
          </Field>
          <Field label="Active" hint="Inactive staff are hidden from the “add line” list.">
            <div className="flex h-9 items-center">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => set("active", v)}
                disabled={!canEdit}
              />
            </div>
          </Field>
          <Field
            label="Account detail"
            hint="Name, account number and sort code, e.g. “Dilip Chaudhary 40839877 04-29-09”."
            className="sm:col-span-2"
          >
            <Input
              value={form.accountDetail}
              onChange={text("accountDetail")}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={text("notes")} disabled={!canEdit} rows={2} />
          </Field>
        </div>

        {error ? (
          <p role="alert" className="text-[12px] font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {canEdit ? (
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : staff ? "Save changes" : "Add staff"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
