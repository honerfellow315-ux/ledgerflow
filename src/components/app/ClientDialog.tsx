import { useEffect, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "./Field";
import { useLedger } from "@/lib/ledger/store";
import type { Client, ClientStatus, Company } from "@/lib/ledger/types";

// Keep the stored data URL small — same limit as the Settings business logo.
const MAX_LOGO_BYTES = 400 * 1024; // 400 KB
const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const NEW_COMPANY = "__new__";
const NO_COMPANY = "__none__";

const empty = {
  name: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  vatNumber: "",
  accountReference: "",
  status: "active" as ClientStatus,
  notes: "",
  companyId: undefined as string | undefined,
};

const emptyNewCompany = {
  name: "",
  email: "",
  phone: "",
  address: "",
  vatNumber: "",
  companyNumber: "",
  website: "",
  bankDetails: "",
  logo: "",
};

export function ClientDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client?: Client | null;
}) {
  const { data, addClient, updateClient, addCompany } = useLedger();
  const companies = data.companies;
  const [form, setForm] = useState(empty);
  const [companyChoice, setCompanyChoice] = useState<string>(NO_COMPANY);
  const [newCompany, setNewCompany] = useState(emptyNewCompany);
  const [logoBusy, setLogoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(client ? { ...empty, ...client } : empty);
    setCompanyChoice(client?.companyId ?? NO_COMPANY);
    setNewCompany(emptyNewCompany);
  }, [open, client]);

  const set = <K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setNew = <K extends keyof typeof emptyNewCompany>(
    key: K,
    value: (typeof emptyNewCompany)[K],
  ) => setNewCompany((f) => ({ ...f, [key]: value }));

  const handleLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      toast.error("Use a PNG, JPG, WEBP or SVG file for the logo.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo is too large — please use an image under 400 KB.");
      return;
    }
    setLogoBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      setNew("logo", String(reader.result ?? ""));
      setLogoBusy(false);
    };
    reader.onerror = () => {
      setLogoBusy(false);
      toast.error("Couldn't read that file — please try again.");
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.company.trim()) {
      toast.error("Client name and company are required.");
      return;
    }
    if (companyChoice === NEW_COMPANY && !newCompany.name.trim()) {
      toast.error("Enter a name for the new company, or pick an existing one.");
      return;
    }

    setSaving(true);
    try {
      // `null` (not `undefined`) so an edit that switches back to "No
      // company" actually clears companyId server-side — an `undefined`
      // key is dropped by JSON serialization and would leave it unchanged.
      let companyId: string | null = companyChoice === NO_COMPANY ? null : companyChoice;

      if (companyChoice === NEW_COMPANY) {
        const created: Company | undefined = await addCompany({
          name: newCompany.name.trim(),
          email: newCompany.email.trim(),
          phone: newCompany.phone.trim(),
          address: newCompany.address.trim(),
          vatNumber: newCompany.vatNumber.trim(),
          companyNumber: newCompany.companyNumber.trim(),
          website: newCompany.website.trim(),
          bankDetails: newCompany.bankDetails.trim(),
          logo: newCompany.logo,
        });
        if (!created) {
          toast.error("Couldn't save the new company — please try again.");
          setSaving(false);
          return;
        }
        companyId = created.id;
      }

      const payload = { ...form, companyId };
      if (client) {
        updateClient(client.id, payload);
        toast.success("Client record updated.");
      } else {
        addClient(payload);
        toast.success("Client added.");
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{client ? "Edit Client" : "Add Client"}</DialogTitle>
          <DialogDescription className="text-xs">
            Enter the client’s contact and account details.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client Name" htmlFor="cl-name">
            <Input id="cl-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Company" htmlFor="cl-company">
            <Input
              id="cl-company"
              value={form.company}
              onChange={(e) => set("company", e.target.value)}
            />
          </Field>
          <Field label="Email" htmlFor="cl-email">
            <Input
              id="cl-email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="cl-phone">
            <Input
              id="cl-phone"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
          <Field label="Address" htmlFor="cl-address" className="sm:col-span-2">
            <Input
              id="cl-address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
          <Field label="VAT Number" htmlFor="cl-vat">
            <Input
              id="cl-vat"
              value={form.vatNumber ?? ""}
              onChange={(e) => set("vatNumber", e.target.value)}
            />
          </Field>
          <Field label="Account Reference" htmlFor="cl-account-ref">
            <Input
              id="cl-account-ref"
              value={form.accountReference ?? ""}
              onChange={(e) => set("accountReference", e.target.value)}
            />
          </Field>
          <Field label="Account Status">
            <Select value={form.status} onValueChange={(v) => set("status", v as ClientStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on-hold">On hold</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Bill Under Company"
            className="sm:col-span-2"
            hint="Invoices and statements for this client use this company's name, logo and address instead of the default Settings business info."
          >
            <Select value={companyChoice} onValueChange={setCompanyChoice}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COMPANY}>No company (use default business info)</SelectItem>
                {companies.map((co) => (
                  <SelectItem key={co.id} value={co.id}>
                    {co.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_COMPANY}>+ Add a new company…</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {companyChoice === NEW_COMPANY ? (
            <div className="grid gap-4 rounded-md border border-dashed border-border p-3 sm:col-span-2 sm:grid-cols-2">
              <Field label="Company Logo" className="sm:col-span-2">
                <div className="flex items-center gap-3">
                  <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-surface-muted/60">
                    {newCompany.logo ? (
                      <img
                        src={newCompany.logo}
                        alt="Company logo"
                        className="size-full object-contain p-1"
                      />
                    ) : (
                      <span className="text-[9px] font-medium text-muted-foreground">No logo</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={logoBusy}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {logoBusy ? "Uploading..." : newCompany.logo ? "Replace logo" : "Upload logo"}
                  </Button>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept={ACCEPTED_LOGO_TYPES.join(",")}
                    className="hidden"
                    onChange={(e) => handleLogoFile(e.target.files?.[0])}
                  />
                </div>
              </Field>
              <Field label="Company Name" htmlFor="nc-name">
                <Input
                  id="nc-name"
                  value={newCompany.name}
                  onChange={(e) => setNew("name", e.target.value)}
                />
              </Field>
              <Field label="Email" htmlFor="nc-email">
                <Input
                  id="nc-email"
                  value={newCompany.email}
                  onChange={(e) => setNew("email", e.target.value)}
                />
              </Field>
              <Field label="Phone" htmlFor="nc-phone">
                <Input
                  id="nc-phone"
                  value={newCompany.phone}
                  onChange={(e) => setNew("phone", e.target.value)}
                />
              </Field>
              <Field label="Website" htmlFor="nc-website">
                <Input
                  id="nc-website"
                  value={newCompany.website}
                  onChange={(e) => setNew("website", e.target.value)}
                />
              </Field>
              <Field label="Address" htmlFor="nc-address" className="sm:col-span-2">
                <Input
                  id="nc-address"
                  value={newCompany.address}
                  onChange={(e) => setNew("address", e.target.value)}
                />
              </Field>
              <Field label="VAT Number" htmlFor="nc-vat">
                <Input
                  id="nc-vat"
                  value={newCompany.vatNumber}
                  onChange={(e) => setNew("vatNumber", e.target.value)}
                />
              </Field>
              <Field label="Company Number" htmlFor="nc-conum">
                <Input
                  id="nc-conum"
                  value={newCompany.companyNumber}
                  onChange={(e) => setNew("companyNumber", e.target.value)}
                />
              </Field>
              <Field label="Bank Details" htmlFor="nc-bank" className="sm:col-span-2">
                <Textarea
                  id="nc-bank"
                  rows={2}
                  value={newCompany.bankDetails}
                  onChange={(e) => setNew("bankDetails", e.target.value)}
                />
              </Field>
            </div>
          ) : null}

          <Field label="Notes" htmlFor="cl-notes" className="sm:col-span-2">
            <Textarea
              id="cl-notes"
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? "Saving..." : client ? "Save Changes" : "Add Client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
