import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLedger } from "@/lib/ledger/store";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { Panel, PanelHeader } from "@/components/app/Panel";
import { Field } from "@/components/app/Field";
import { LetterheadField } from "@/components/app/LetterheadField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X } from "@/lib/icons";

export const Route = createFileRoute("/settings/")({
  head: () => ({
    meta: [
      { title: "Settings — LedgerFlow" },
      {
        name: "description",
        content:
          "Business details, VAT registration, default VAT rate, currency and payment methods used across invoices and statements.",
      },
      { property: "og:title", content: "Settings — LedgerFlow" },
      {
        property: "og:description",
        content: "Configure business details, VAT and payment methods for your ledger.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <RequireView module="settings">
      <SettingsPageContent />
    </RequireView>
  );
}

function SettingsPageContent() {
  const { data, hydrated, updateSettings } = useLedger();
  const { can } = usePermissions();
  const s = data.settings;

  const [name, setName] = useState(s.businessName);
  const [email, setEmail] = useState(s.businessEmail);
  const [phone, setPhone] = useState(s.businessPhone);
  const [address, setAddress] = useState(s.businessAddress);
  const [vatNumber, setVatNumber] = useState(s.vatNumber);
  const [companyNumber, setCompanyNumber] = useState(s.companyNumber);
  const [website, setWebsite] = useState(s.businessWebsite ?? "");
  const [vat, setVat] = useState(String(s.defaultVatRate));
  const [invoicePrefix, setInvoicePrefix] = useState(s.invoicePrefix);
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState(String(s.nextInvoiceNumber));
  const [bankDetails, setBankDetails] = useState(s.bankDetails ?? "");
  const [letterhead, setLetterhead] = useState(s.businessLetterhead ?? "");
  const [marginTop, setMarginTop] = useState(s.letterheadMarginTop ?? 0);
  const [marginBottom, setMarginBottom] = useState(s.letterheadMarginBottom ?? 0);
  const [newMethod, setNewMethod] = useState("");

  // Re-sync the form once the data layer has hydrated.
  useEffect(() => {
    setName(s.businessName);
    setEmail(s.businessEmail);
    setPhone(s.businessPhone);
    setAddress(s.businessAddress);
    setVatNumber(s.vatNumber);
    setCompanyNumber(s.companyNumber);
    setWebsite(s.businessWebsite ?? "");
    setVat(String(s.defaultVatRate));
    setInvoicePrefix(s.invoicePrefix);
    setNextInvoiceNumber(String(s.nextInvoiceNumber));
    setBankDetails(s.bankDetails ?? "");
    setLetterhead(s.businessLetterhead ?? "");
    setMarginTop(s.letterheadMarginTop ?? 0);
    setMarginBottom(s.letterheadMarginBottom ?? 0);
  }, [
    hydrated,
    s.businessName,
    s.businessEmail,
    s.businessPhone,
    s.businessAddress,
    s.vatNumber,
    s.companyNumber,
    s.businessWebsite,
    s.defaultVatRate,
    s.invoicePrefix,
    s.nextInvoiceNumber,
    s.bankDetails,
    s.businessLetterhead,
    s.letterheadMarginTop,
    s.letterheadMarginBottom,
  ]);

  const saveBusiness = () => {
    if (!name.trim()) {
      toast.error("Business name is required.");
      return;
    }
    updateSettings({
      businessName: name.trim(),
      businessEmail: email.trim(),
      businessPhone: phone.trim(),
      businessAddress: address.trim(),
      vatNumber: vatNumber.trim(),
      companyNumber: companyNumber.trim(),
      businessWebsite: website.trim(),
    });
    toast.success("Business information saved.");
  };

  const saveVat = () => {
    const rate = Number(vat);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error("Enter a VAT rate between 0 and 100.");
      return;
    }
    updateSettings({ defaultVatRate: rate });
    toast.success(`Default VAT rate set to ${rate}%.`);
  };

  const saveInvoiceNumbering = () => {
    const next = Number(nextInvoiceNumber);
    if (!invoicePrefix.trim()) {
      toast.error("Invoice number prefix is required.");
      return;
    }
    if (!Number.isFinite(next) || !Number.isInteger(next) || next <= 0) {
      toast.error("Enter a whole number greater than zero.");
      return;
    }
    updateSettings({ invoicePrefix: invoicePrefix.trim(), nextInvoiceNumber: next });
    toast.success("Invoice numbering saved.");
  };

  const saveBankDetails = () => {
    updateSettings({ bankDetails: bankDetails.trim() });
    toast.success("Payment details saved.");
  };

  const removeMethod = (method: string) => {
    if (s.paymentMethods.length <= 1) {
      toast.error("At least one payment method must stay enabled.");
      return;
    }
    updateSettings({ paymentMethods: s.paymentMethods.filter((m) => m !== method) });
  };

  const addMethod = () => {
    const trimmed = newMethod.trim();
    if (!trimmed) return;
    if (s.paymentMethods.some((m) => m.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("That payment method already exists.");
      return;
    }
    updateSettings({ paymentMethods: [...s.paymentMethods, trimmed] });
    setNewMethod("");
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Panel>
        <PanelHeader
          title="Business Information"
          description="Shown on invoices, credit notes and client statements."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <LetterheadField
            className="sm:col-span-2"
            letterhead={letterhead}
            marginTop={marginTop}
            marginBottom={marginBottom}
            onChange={(patch) => {
              if (patch.letterhead !== undefined) setLetterhead(patch.letterhead);
              if (patch.marginTop !== undefined) setMarginTop(patch.marginTop);
              if (patch.marginBottom !== undefined) setMarginBottom(patch.marginBottom);
              updateSettings({
                ...(patch.letterhead !== undefined ? { businessLetterhead: patch.letterhead } : {}),
                ...(patch.marginTop !== undefined ? { letterheadMarginTop: patch.marginTop } : {}),
                ...(patch.marginBottom !== undefined
                  ? { letterheadMarginBottom: patch.marginBottom }
                  : {}),
              });
            }}
          />
          <Field label="Business Name" htmlFor="set-name">
            <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="set-email">
            <Input
              id="set-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="set-phone">
            <Input id="set-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Website" htmlFor="set-website">
            <Input
              id="set-website"
              placeholder="www.yourcompany.com"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </Field>
          <Field label="VAT Number" htmlFor="set-vatno">
            <Input
              id="set-vatno"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
            />
          </Field>
          <Field label="Company Number" htmlFor="set-cono">
            <Input
              id="set-cono"
              value={companyNumber}
              onChange={(e) => setCompanyNumber(e.target.value)}
            />
          </Field>
          <Field label="Address" htmlFor="set-address" className="sm:col-span-2">
            <Textarea
              id="set-address"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
          {can("settings", "edit") ? (
            <div className="sm:col-span-2">
              <Button size="sm" onClick={saveBusiness}>
                Save Business Information
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="VAT" description="Applied to new invoices by default." />
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Default VAT Rate (%)" htmlFor="set-vat" className="w-48">
            <Input
              id="set-vat"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={vat}
              onChange={(e) => setVat(e.target.value)}
            />
          </Field>
          {can("settings", "edit") ? (
            <Button size="sm" onClick={saveVat}>
              Save VAT Rate
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Invoice Numbering"
          description="Used to suggest the next invoice number when you create one."
        />
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Prefix" htmlFor="set-inv-prefix" className="w-40">
            <Input
              id="set-inv-prefix"
              value={invoicePrefix}
              onChange={(e) => setInvoicePrefix(e.target.value)}
            />
          </Field>
          <Field label="Next Invoice Number" htmlFor="set-inv-next" className="w-48">
            <Input
              id="set-inv-next"
              type="number"
              min="1"
              step="1"
              value={nextInvoiceNumber}
              onChange={(e) => setNextInvoiceNumber(e.target.value)}
            />
          </Field>
          {can("settings", "edit") ? (
            <Button size="sm" onClick={saveInvoiceNumbering}>
              Save Invoice Numbering
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Payment Details"
          description="Bank details printed on the invoice PDF so clients know where to pay."
        />
        <div className="space-y-3 p-4">
          <Field label="Bank / Payment Details" htmlFor="set-bank-details">
            <Textarea
              id="set-bank-details"
              rows={3}
              placeholder={"Account holder: \nSort code: \nAccount number: "}
              value={bankDetails}
              onChange={(e) => setBankDetails(e.target.value)}
            />
          </Field>
          {can("settings", "edit") ? (
            <Button size="sm" onClick={saveBankDetails}>
              Save Payment Details
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Currency" description="All amounts are shown in this currency." />
        <div className="p-4">
          <Field label="Currency" htmlFor="set-currency" className="w-48">
            <Input id="set-currency" value="GBP (£)" readOnly disabled />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Payment Methods"
          description="Reusable methods available when recording a payment. Add your own custom methods below."
        />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {s.paymentMethods.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-muted px-3 py-1 text-[13px]"
              >
                {m}
                {can("settings", "edit") ? (
                  <button
                    type="button"
                    aria-label={`Remove ${m}`}
                    onClick={() => removeMethod(m)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
          {can("settings", "edit") ? (
            <div className="flex items-end gap-2">
              <Field label="Add Payment Method" htmlFor="set-new-method" className="w-64">
                <Input
                  id="set-new-method"
                  placeholder="e.g. Card"
                  value={newMethod}
                  onChange={(e) => setNewMethod(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addMethod();
                    }
                  }}
                />
              </Field>
              <Button size="sm" variant="outline" onClick={addMethod}>
                Add
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
