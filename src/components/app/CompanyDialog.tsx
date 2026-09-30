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
import { Field } from "./Field";
import { LetterheadField } from "./LetterheadField";
import { useLedger } from "@/lib/ledger/store";
import type { Company } from "@/lib/ledger/types";

const empty = {
  name: "",
  email: "",
  phone: "",
  address: "",
  vatNumber: "",
  companyNumber: "",
  website: "",
  bankDetails: "",
  logo: "",
  letterhead: "",
  letterheadMarginTop: 0,
  letterheadMarginBottom: 0,
  invoicePrefix: "",
};

export function CompanyDialog({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  company?: Company | null;
}) {
  const { addCompany, updateCompany } = useLedger();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(company ? { ...empty, ...company } : empty);
  }, [open, company]);

  const set = <K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Company name is required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        vatNumber: form.vatNumber.trim(),
        companyNumber: form.companyNumber.trim(),
        website: form.website.trim(),
        bankDetails: form.bankDetails.trim(),
        logo: form.logo,
        letterhead: form.letterhead,
        letterheadMarginTop: form.letterheadMarginTop,
        letterheadMarginBottom: form.letterheadMarginBottom,
        invoicePrefix: form.invoicePrefix.trim(),
      };

      if (company) {
        updateCompany(company.id, payload);
        toast.success("Company updated.");
      } else {
        const created = await addCompany(payload);
        if (!created) {
          toast.error("Couldn't save the company — please try again.");
          setSaving(false);
          return;
        }
        toast.success("Company added.");
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
          <DialogTitle className="text-base">
            {company ? "Edit Company" : "Add Company"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Billing entities clients can be invoiced under. A client linked to a company shows this
            company's letterhead, name and address on its invoices and statements instead of the
            default Settings business profile.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <LetterheadField
            className="sm:col-span-2"
            letterhead={form.letterhead}
            marginTop={form.letterheadMarginTop}
            marginBottom={form.letterheadMarginBottom}
            onChange={(patch) => {
              setForm((f) => ({
                ...f,
                ...(patch.letterhead !== undefined ? { letterhead: patch.letterhead } : {}),
                ...(patch.marginTop !== undefined ? { letterheadMarginTop: patch.marginTop } : {}),
                ...(patch.marginBottom !== undefined
                  ? { letterheadMarginBottom: patch.marginBottom }
                  : {}),
              }));
            }}
          />
          <Field label="Company Name" htmlFor="co-name">
            <Input id="co-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="co-email">
            <Input
              id="co-email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="co-phone">
            <Input
              id="co-phone"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
          <Field label="Website" htmlFor="co-website">
            <Input
              id="co-website"
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
            />
          </Field>
          <Field label="Address" htmlFor="co-address" className="sm:col-span-2">
            <Input
              id="co-address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
          <Field label="VAT Number" htmlFor="co-vat">
            <Input
              id="co-vat"
              value={form.vatNumber}
              onChange={(e) => set("vatNumber", e.target.value)}
            />
          </Field>
          <Field label="Company Number" htmlFor="co-conum">
            <Input
              id="co-conum"
              value={form.companyNumber}
              onChange={(e) => set("companyNumber", e.target.value)}
            />
          </Field>
          <Field
            label="Invoice Number Prefix"
            htmlFor="co-inv-prefix"
            hint="e.g. FFM-. Leave blank to use the global default prefix from Settings."
          >
            <Input
              id="co-inv-prefix"
              placeholder={"(use global default)"}
              value={form.invoicePrefix}
              onChange={(e) => set("invoicePrefix", e.target.value)}
            />
          </Field>
          <Field label="Bank Details" htmlFor="co-bank" className="sm:col-span-2">
            <Textarea
              id="co-bank"
              rows={2}
              value={form.bankDetails}
              onChange={(e) => set("bankDetails", e.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? "Saving..." : company ? "Save Changes" : "Add Company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
