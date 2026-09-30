import type { LedgerData, PaymentMethod, Settings } from "./types";

/**
 * Configuration defaults for a new installation. These are option catalogues
 * and business preferences only — they contain no business records. Once the
 * backend is connected, settings are loaded from the database instead.
 */

// Starting set — Settings > Payment Methods lets the user add their own
// reusable custom methods on top of these (stored in settings.paymentMethods).
export const PAYMENT_METHODS: PaymentMethod[] = ["Bank Transfer", "Cash", "Payroll", "Other"];

export const PAYMENT_TERMS = [
  "On receipt",
  "7 days",
  "14 days",
  "15 days",
  "30 days",
  "45 days",
  "60 days",
  "90 days",
];

export const EXPENSE_CATEGORIES = [
  "Subcontractors",
  "Payroll",
  "Insurance",
  "Equipment",
  "Software & Subscriptions",
  "Travel & Mileage",
  "Training & Licensing",
  "Professional Fees",
  "Office & Admin",
  "Other",
];

export const defaultSettings: Settings = {
  businessName: "",
  businessEmail: "",
  businessPhone: "",
  businessAddress: "",
  vatNumber: "",
  companyNumber: "",
  businessWebsite: "",
  defaultVatRate: 20,
  currency: "GBP",
  paymentMethods: PAYMENT_METHODS,
  paymentTerms: PAYMENT_TERMS,
  expenseCategories: EXPENSE_CATEGORIES,
  invoicePrefix: "INV-",
  nextInvoiceNumber: 1,
  creditNotePrefix: "CN-",
  bankDetails: "",
  businessLogo: "",
};

/** An empty ledger. Real records arrive from the backend once connected. */
export function createEmptyLedger(): LedgerData {
  return {
    clients: [],
    companies: [],
    invoices: [],
    payments: [],
    expenses: [],
    hours: [],
    subcontracts: [],
    creditNotes: [],
    settings: { ...defaultSettings },
  };
}
