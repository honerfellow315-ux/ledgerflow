/**
 * Domain types for the LedgerFlow frontend.
 *
 * These interfaces define the contract the future backend/API must satisfy.
 * No records are defined here — data is supplied at runtime by the data layer.
 */

export type ClientStatus = "active" | "on-hold" | "closed";
export type InvoiceStatus = "paid" | "partial" | "unpaid";
export type ApprovalStatus = "approved" | "unapproved";
export type CreditNoteStatus = "draft" | "issued" | "applied";
// Free-form / reusable — Settings > Payment Methods can add custom ones
// (still backed by the same paymentMethods list in Settings + database).
export type PaymentMethod = string;
/** VAT applied to the whole invoice ("full", default/unchanged) or only to
 * the currently outstanding ex-VAT balance ("remaining"), never
 * retroactively to amounts already paid. */
export type VatMode = "full" | "remaining";

export interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  status: ClientStatus;
  /** Default charge rate per hour, ex VAT. */
  rate?: number;
  /** Default payment term in days, used to calculate invoice due dates. */
  paymentTermDays?: number;
  vatNumber?: string;
  accountReference?: string;
  startDate?: string;
  notes?: string;
  /** Which of our billing companies this client is invoiced under. Unset/null = use global Settings. */
  companyId?: string | null;
}

/**
 * One of the billing entities this install invoices under (an install can run
 * several). When a client is linked to a company (`Client.companyId`), that
 * company's details are shown on that client's invoices/statements instead of
 * the global Settings business profile.
 */
export interface Company {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  vatNumber: string;
  companyNumber: string;
  website?: string;
  bankDetails?: string;
  /** Company logo, as a data URL (base64). */
  logo?: string;
  /**
   * Pre-printed letterhead this company's invoices/statements are rendered
   * on top of, as a data URL (full A4 page image). When set, this replaces
   * the plain logo+name header.
   */
  letterhead?: string;
  /** mm from the top edge the printable content must clear (letterhead artwork). */
  letterheadMarginTop?: number;
  /** mm from the bottom edge the printable content must clear (letterhead artwork). */
  letterheadMarginBottom?: number;
  /** Company-specific default invoice-number prefix, e.g. "FFM-". Unset/empty = use global Settings. */
  invoicePrefix?: string;
}

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amountExVat: number;
  orderIndex: number;
}

export interface Invoice {
  id: string;
  number: string;
  clientId: string;
  /** Billing month, yyyy-mm. */
  month?: string;
  invoiceDate: string; // yyyy-mm-dd
  dueDate: string;
  /** Purchase order or client reference. */
  poReference?: string;
  /** Optional end client this invoice was really raised for (e.g. one of the
   * clients behind a management account). Empty/unset = not assigned. */
  endClient?: string;
  description: string;
  /** Optional second description, printed under the main description. */
  description2?: string;
  amountExVat: number;
  /** Set when this invoice was billed as Hours × Rate rather than a fixed amount. */
  hours?: number;
  /** Rate per hour used with `hours` to compute `amountExVat`. */
  rate?: number;
  vatIncluded: boolean;
  vatRate: number; // percent
  /** How VAT is calculated against this invoice. Defaults to "full". */
  vatMode?: VatMode;
  /** Ex-VAT amount already paid when VAT was applied (only for vatMode
   * "remaining"). VAT is charged on amountExVat - vatPaidBefore, frozen. */
  vatPaidBefore?: number;
  paymentTerms: string;
  notes?: string;
  lineItems?: InvoiceLineItem[];
  /** Approval status, entirely separate from payment status. Defaults to false. */
  approved: boolean;
  /** Set when this invoice is an "Additional Invoice" referencing an original. */
  originalInvoiceId?: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  clientId: string;
  date: string;
  method: PaymentMethod;
  amount: number;
  reference: string;
  notes?: string;
  /** Set when this payment was entered as "N hours at this entry's rate"
   * rather than a typed amount — links back to the Hours entry so the Hours
   * screen can show hours paid vs remaining. Unset for an ordinary
   * fixed-amount payment. */
  hoursEntryId?: string;
  /** The number of hours this payment covers. Only meaningful together with
   * hoursEntryId — amount = hoursPaid × that entry's rate. */
  hoursPaid?: number;
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  description: string;
  amountExVat: number;
  vatAmount: number;
  method: PaymentMethod;
  paidTo: string;
  reference?: string;
  comments?: string;
  /** Optional job-costing link: the invoice this expense was incurred for
   * (e.g. a device repair job), so it can be netted against that invoice's
   * revenue. Most expenses have no linked invoice at all. */
  invoiceId?: string;
}

export interface HoursEntry {
  id: string;
  /** yyyy-mm */
  month: string;
  clientId: string;
  totalHours: number;
  payrollHours: number;
  managementPayrollHours: number;
  unpaidHours: number;
  rate: number;
  notes?: string;
  /** Invoice this month's hours were billed on, once raised. */
  invoiceId?: string;
}

export interface SubcontractEntry {
  id: string;
  month: string;
  clientId: string;
  /** The client invoice / work allocation this subcontracted work belongs to. */
  invoiceId?: string;
  /** Who the hours were subcontracted out to. */
  subcontractorName: string;
  hoursProceed: number;
  rate: number;
  /** What the hours were for, e.g. "Site A security cover". */
  description?: string;
  /** Free-form reference — PO number, work order, etc. */
  reference?: string;
  invoiceDate?: string;
  dueDate?: string;
  invoiceNumber?: string;
  notes?: string;
  /** Whether VAT applies to this subcontracted amount — off by default,
   * since most subcontractor payments are zero-rated/exempt. */
  vatIncluded: boolean;
  vatRate: number; // percent
}

export interface CreditNote {
  id: string;
  number: string;
  clientId: string;
  invoiceId?: string;
  date: string;
  reason: string;
  amountExVat: number;
  vatIncluded: boolean;
  vatRate: number;
  status: CreditNoteStatus;
  comments?: string;
}

export interface Settings {
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
  vatNumber: string;
  companyNumber: string;
  /** Optional company website, shown on invoices/statements when set. */
  businessWebsite?: string;
  defaultVatRate: number;
  currency: string;
  paymentMethods: PaymentMethod[];
  paymentTerms: string[];
  expenseCategories: string[];
  invoicePrefix: string;
  nextInvoiceNumber: number;
  creditNotePrefix: string;
  /** Freeform bank/payment details block printed on the invoice PDF. */
  bankDetails?: string;
  /** Company logo shown on invoices/statements, as a data URL (base64). */
  businessLogo?: string;
  /** Default letterhead for clients not billed under a specific Company. */
  businessLetterhead?: string;
  /** mm from the top edge the printable content must clear (letterhead artwork). */
  letterheadMarginTop?: number;
  /** mm from the bottom edge the printable content must clear (letterhead artwork). */
  letterheadMarginBottom?: number;
}

export interface LedgerData {
  clients: Client[];
  companies: Company[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  hours: HoursEntry[];
  subcontracts: SubcontractEntry[];
  creditNotes: CreditNote[];
  settings: Settings;
}
