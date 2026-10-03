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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/app/Field";
import { addStaff, updateStaff } from "@/lib/actions/salary";
import { isValidNi } from "@/lib/payroll/calc";
import {
  GENDER_OPTIONS,
  HOURS_ALLOWED_OPTIONS,
  IMMIGRATION_OPTIONS,
  ROLE_OPTIONS,
  SERVICE_OPTIONS,
  ageFromDob,
  shareCodeState,
} from "@/lib/payroll/staffFields";
import { errorMessage, useRefreshSalary } from "@/lib/payroll/queries";
import { CONTRACT_STATUSES, type ContractStatus, type Staff } from "@/lib/payroll/types";

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
  // Personal
  dob: string;
  gender: string;
  rtwShareCode: string;
  shareCodeExpiry: string;
  address: string;
  town: string;
  postCode: string;
  uniform: string;
  // Banking
  accountHolderName: string;
  accountNumber: string;
  sortCode: string;
  // Contract
  employmentStartDate: string;
  employmentEndDate: string;
  contractStatus: string;
  email: string;
  immigrationStatus: string;
  hoursAllowed: string;
  // SIA
  siaNumber: string;
  role: string;
  serviceType: string;
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
  dob: "",
  gender: "",
  rtwShareCode: "",
  shareCodeExpiry: "",
  address: "",
  town: "",
  postCode: "",
  uniform: "",
  accountHolderName: "",
  accountNumber: "",
  sortCode: "",
  employmentStartDate: "",
  employmentEndDate: "",
  contractStatus: "",
  email: "",
  immigrationStatus: "",
  hoursAllowed: "",
  siaNumber: "",
  role: "",
  serviceType: "",
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
  dob: s.dob ?? "",
  gender: s.gender ?? "",
  rtwShareCode: s.rtwShareCode ?? "",
  shareCodeExpiry: s.shareCodeExpiry ?? "",
  address: s.address ?? "",
  town: s.town ?? "",
  postCode: s.postCode ?? "",
  uniform: s.uniform ?? "",
  accountHolderName: s.accountHolderName ?? "",
  accountNumber: s.accountNumber ?? "",
  sortCode: s.sortCode ?? "",
  employmentStartDate: s.employmentStartDate ?? "",
  employmentEndDate: s.employmentEndDate ?? "",
  contractStatus: s.contractStatus ?? "",
  email: s.email ?? "",
  immigrationStatus: s.immigrationStatus ?? "",
  hoursAllowed: s.hoursAllowed ?? "",
  siaNumber: s.siaNumber ?? "",
  role: s.role ?? "",
  serviceType: s.serviceType ?? "",
});

const NONE = "__none";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Text box that suggests the report's dropdown values but still accepts anything. */
function Suggest({
  id,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  disabled: boolean;
}) {
  return (
    <>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        list={id}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

export function StaffDialog({
  open,
  onOpenChange,
  staff,
  canEdit,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = add a new person */
  staff: Staff | null;
  canEdit: boolean;
  /** Called after a successful save with the saved record (used by the payroll sheet to attach a new person). */
  onSaved?: (saved: Staff | undefined, isNew: boolean) => void | Promise<void>;
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

  const age = ageFromDob(form.dob || undefined);
  const expiry = shareCodeState({ shareCodeExpiry: form.shareCodeExpiry || undefined });

  async function save() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      // Blank detail fields are sent as "" — the server stores them as NULL.
      const t = (v: string) => v.trim();
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
        dob: t(form.dob),
        gender: t(form.gender),
        rtwShareCode: t(form.rtwShareCode),
        shareCodeExpiry: t(form.shareCodeExpiry),
        address: t(form.address),
        town: t(form.town),
        postCode: t(form.postCode),
        uniform: t(form.uniform),
        accountHolderName: t(form.accountHolderName),
        accountNumber: t(form.accountNumber),
        sortCode: t(form.sortCode),
        employmentStartDate: t(form.employmentStartDate),
        employmentEndDate: t(form.employmentEndDate),
        contractStatus: t(form.contractStatus) as ContractStatus | "",
        email: t(form.email),
        immigrationStatus: t(form.immigrationStatus),
        hoursAllowed: t(form.hoursAllowed),
        siaNumber: t(form.siaNumber),
        role: t(form.role),
        serviceType: t(form.serviceType),
      };
      let saved: Staff | undefined;
      if (staff)
        saved = await updateStaff({
          data: { id: staff.id, patch: { ...values, notes: form.notes.trim() } },
        });
      else saved = await addStaff({ data: values });
      await onSaved?.(saved, !staff);
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
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{staff ? "Edit staff member" : "Add staff member"}</DialogTitle>
          <DialogDescription>
            One record per person — it is reused every month. RSS / ESS IDs are what shift exports
            are matched on.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Section title="Employment">
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
            <Field
              label="NI number"
              hint="Saved as AB 12 34 56 C. Imports match on it ignoring spaces and capitals."
              error={
                form.ni.trim() && !isValidNi(form.ni)
                  ? "Doesn't look like a valid NI number (2 letters, 6 digits, then A–D). You can still save it."
                  : undefined
              }
            >
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
            <Field label="Notes" className="sm:col-span-2">
              <Textarea value={form.notes} onChange={text("notes")} disabled={!canEdit} rows={2} />
            </Field>
          </Section>

          <Section title="Personal">
            <Field
              label="Date of birth"
              hint={age === "" ? undefined : `Age: ${age} (calculated, not saved)`}
            >
              <Input type="date" value={form.dob} onChange={text("dob")} disabled={!canEdit} />
            </Field>
            <Field label="Gender">
              <Suggest
                id="staff-gender"
                value={form.gender}
                onChange={(v) => set("gender", v)}
                options={GENDER_OPTIONS}
                disabled={!canEdit}
              />
            </Field>
            <Field label="RTW share code">
              <Input
                value={form.rtwShareCode}
                onChange={text("rtwShareCode")}
                disabled={!canEdit}
                placeholder="W12 345 678"
              />
            </Field>
            <Field
              label="Share code expiry"
              error={
                expiry === "expired"
                  ? "This share code has expired."
                  : expiry === "soon"
                    ? "Expires within 60 days."
                    : undefined
              }
            >
              <Input
                type="date"
                value={form.shareCodeExpiry}
                onChange={text("shareCodeExpiry")}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input value={form.address} onChange={text("address")} disabled={!canEdit} />
            </Field>
            <Field label="Town">
              <Input value={form.town} onChange={text("town")} disabled={!canEdit} />
            </Field>
            <Field label="Post code">
              <Input
                value={form.postCode}
                onChange={text("postCode")}
                disabled={!canEdit}
                placeholder="AB1 2CD"
              />
            </Field>
            <Field label="Uniform" hint="e.g. the uniform deposit / size, as in the report.">
              <Input value={form.uniform} onChange={text("uniform")} disabled={!canEdit} />
            </Field>
          </Section>

          <Section title="Banking">
            <Field label="Account holder name" className="sm:col-span-2">
              <Input
                value={form.accountHolderName}
                onChange={text("accountHolderName")}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Account number">
              <Input
                value={form.accountNumber}
                onChange={text("accountNumber")}
                disabled={!canEdit}
                inputMode="numeric"
                placeholder="00000000"
              />
            </Field>
            <Field label="Sort code">
              <Input
                value={form.sortCode}
                onChange={text("sortCode")}
                disabled={!canEdit}
                placeholder="00-00-00"
              />
            </Field>
            <Field
              label="Account detail (old free-text)"
              hint="Still used by the salary sheet. Free text, e.g. “Test Person 00000000 00-00-00”."
              className="sm:col-span-2"
            >
              <Input
                value={form.accountDetail}
                onChange={text("accountDetail")}
                disabled={!canEdit}
              />
            </Field>
          </Section>

          <Section title="Contract status">
            <Field label="Employment start date">
              <Input
                type="date"
                value={form.employmentStartDate}
                onChange={text("employmentStartDate")}
                disabled={!canEdit}
              />
            </Field>
            <Field label="End date">
              <Input
                type="date"
                value={form.employmentEndDate}
                onChange={text("employmentEndDate")}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Status">
              <Select
                value={form.contractStatus || NONE}
                onValueChange={(v) => set("contractStatus", v === NONE ? "" : v)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {CONTRACT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={text("email")}
                disabled={!canEdit}
                placeholder="name@example.com"
              />
            </Field>
            <Field label="Immigration status">
              <Suggest
                id="staff-immigration"
                value={form.immigrationStatus}
                onChange={(v) => set("immigrationStatus", v)}
                options={IMMIGRATION_OPTIONS}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Hours of work allowed">
              <Suggest
                id="staff-hours-allowed"
                value={form.hoursAllowed}
                onChange={(v) => set("hoursAllowed", v)}
                options={HOURS_ALLOWED_OPTIONS}
                disabled={!canEdit}
              />
            </Field>
          </Section>

          <Section title="SIA">
            <Field label="SIA number" className="sm:col-span-2">
              <Input
                value={form.siaNumber}
                onChange={text("siaNumber")}
                disabled={!canEdit}
                placeholder="0000 0000 0000 0000"
              />
            </Field>
            <Field label="Role">
              <Suggest
                id="staff-role"
                value={form.role}
                onChange={(v) => set("role", v)}
                options={ROLE_OPTIONS}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Services type">
              <Suggest
                id="staff-service"
                value={form.serviceType}
                onChange={(v) => set("serviceType", v)}
                options={SERVICE_OPTIONS}
                disabled={!canEdit}
              />
            </Field>
          </Section>
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
