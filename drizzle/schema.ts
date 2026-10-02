/**
 * LedgerFlow database schema (Postgres, via Drizzle ORM).
 *
 * Target: Neon (https://neon.tech) — free serverless Postgres, no card required.
 * Works unchanged on any other Postgres host (Railway, Fly.io, a local Postgres, etc).
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { Permissions } from "../src/lib/permissions";

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });

// Real Postgres enums (not just varchar) so the DB rejects bad values too,
// and so Drizzle infers the same union types the frontend already uses
// (src/lib/ledger/types.ts) instead of plain `string`.
export const clientStatusEnum = pgEnum("client_status", ["active", "on-hold", "closed"]);
// NOTE: payment methods used to be this fixed Postgres enum. They're now
// free-form/reusable (Settings > Payment Methods lets you add custom ones),
// so the `method` columns below use plain `text` instead — see the
// migration at the bottom of schema/ledgerflow-schema.sql. The enum type
// itself is left in place in the database (unused) rather than dropped.
export const creditNoteStatusEnum = pgEnum("credit_note_status", ["draft", "issued", "applied"]);

/* ---------- Auth ---------- */

// Multi-user RBAC. `role: "admin"` always passes every permission check
// (see requirePermission() in src/lib/server/auth.ts) regardless of what's
// in `permissions` — admins don't need every box ticked by hand.
// `permissions` is a sparse Record<module, Record<action, boolean>>; a
// missing module/action key is treated as `false` (see hasPermission()).
export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);

// NOTE: this table used to be `admin_users` (single shared login, no roles).
// It's renamed to `users` here — see README-BACKEND.md's "Migrating from
// admin_users" section for how existing installs move their one row across
// without locking themselves out.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull().default(""),
  role: userRoleEnum("role").notNull().default("user"),
  // Record<module, Record<action, boolean>> — see src/lib/permissions.ts for
  // the canonical module/action lists. Ignored entirely for admins.
  permissions: jsonb("permissions")
    .$type<Permissions>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Who created this account, for audit purposes. Null for the original
  // bootstrap admin (created via scripts/create-admin.ts, not through the
  // app). Self-referencing, so it must stay nullable.
  createdBy: text("created_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
});

// Proper user activity log: who created/edited/deleted/restored what, and
// when. Every server fn that mutates data (see src/lib/server/activity.ts
// and its call sites across src/lib/actions/*.ts) writes one row here after
// it succeeds. `userId` is nullable and `username`/`displayName` are
// snapshotted onto the row itself (not just joined via userId) so the log
// stays readable — with the name of who did it — even after that user
// account is later deleted. Admin-only screen: src/routes/activity-log.index.tsx.
export const activityLog = pgTable("activity_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  username: text("username").notNull().default("system"),
  displayName: text("display_name").notNull().default(""),
  // "created" | "updated" | "deleted" | "restored" | "purged" | "login" |
  // "login_failed" | "logout" — see ActivityAction in src/lib/server/activity.ts.
  action: text("action").notNull(),
  // Which part of the app this happened in — "clients", "invoices", "users",
  // "settings", "auth", etc. Loosely mirrors Module from permissions.ts but
  // also covers non-module surfaces like "auth" and "users".
  module: text("module").notNull(),
  entityId: text("entity_id"),
  // Human-readable line identifying what was affected, e.g.
  // "Invoice INV-045 — Acme Ltd", snapshotted at the time of the action so
  // it still reads sensibly even if the record is later changed or deleted.
  label: text("label").notNull().default(""),
  // Optional extra context, e.g. which fields changed on an update.
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // random token, also the cookie value
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Core ledger tables (mirrors src/lib/ledger/types.ts) ---------- */

// A billing entity ("we run 4-5 companies through this system"). A client is
// optionally linked to one via `clients.companyId`; when linked, invoices and
// statements for that client show this company's details instead of the
// single global Settings business profile.
export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  vatNumber: text("vat_number").notNull().default(""),
  companyNumber: text("company_number").notNull().default(""),
  website: text("website").notNull().default(""),
  bankDetails: text("bank_details").notNull().default(""),
  logo: text("logo").notNull().default(""),
  // Pre-printed letterhead the invoice/statement is rendered on top of, as a
  // data URL (full A4 page image). When set, this replaces the plain
  // logo+name header on invoices for this company.
  letterhead: text("letterhead").notNull().default(""),
  // How far down/up (in mm, from the A4 page edge) the printable content
  // must stay clear of the letterhead's own header/footer artwork. Filled in
  // automatically from a scan of the uploaded image, editable by the user.
  letterheadMarginTop: numeric("letterhead_margin_top", { precision: 6, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  letterheadMarginBottom: numeric("letterhead_margin_bottom", {
    precision: 6,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  // Company-specific default invoice-number prefix (e.g. "FFM-"). Empty
  // string = fall back to the global Settings invoicePrefix.
  invoicePrefix: text("invoice_prefix").notNull().default(""),
  // Recycle bin: set instead of actually removing the row when a user
  // deletes it. Null = active/visible everywhere as normal. Every
  // list*() server fn filters this out; deleteX() sets it instead of
  // running a real DELETE; restoreX() clears it back to null. Only an
  // admin, via the Recycle Bin screen (src/lib/actions/trash.ts), can see
  // or permanently purge soft-deleted rows.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const clients = pgTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  status: clientStatusEnum("status").notNull().default("active"),
  rate: money("rate"),
  paymentTermDays: integer("payment_term_days"),
  vatNumber: text("vat_number"),
  accountReference: text("account_reference"),
  startDate: text("start_date"), // yyyy-mm-dd
  notes: text("notes"),
  // Which of our own billing companies this client is invoiced under.
  // Null = fall back to the global Settings business profile.
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  // See companies.deletedAt above — same recycle-bin pattern.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  number: text("number").notNull(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  month: text("month"), // yyyy-mm
  invoiceDate: text("invoice_date").notNull(), // yyyy-mm-dd
  dueDate: text("due_date").notNull(), // yyyy-mm-dd
  poReference: text("po_reference"),
  // Optional "who this was really billed for" — used when one client record
  // (e.g. a management/agency account) carries invoices for several end
  // clients. Plain nullable text: existing rows stay NULL (= unassigned) and
  // are never modified.
  endClient: text("end_client"),
  description: text("description").notNull().default(""),
  // Optional second description line (printed under the main description).
  description2: text("description_2"),
  amountExVat: money("amount_ex_vat").notNull(),
  // Only set when the invoice was billed as Hours × Rate instead of a fixed
  // amount. `amountExVat` above always holds the final total either way.
  hours: numeric("hours", { precision: 10, scale: 2, mode: "number" }),
  rate: money("rate"),
  vatIncluded: boolean("vat_included").notNull().default(false),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(20),
  paymentTerms: text("payment_terms").notNull().default(""),
  notes: text("notes"),
  // Approval status — deliberately separate from payment status (see below).
  approved: boolean("approved").notNull().default(false),
  // 'full' (default) applies VAT to the whole amountExVat, unchanged from
  // prior behaviour. 'remaining' applies VAT only to the currently
  // outstanding ex-VAT balance, never retroactively to amounts already paid.
  vatMode: text("vat_mode").notNull().default("full"),
  // Only used when vatMode = 'remaining': the ex-VAT amount that had already
  // been paid (e.g. a payroll payment) at the moment VAT was applied. VAT is
  // charged on (amountExVat - vatPaidBefore) and that base is FROZEN — payments
  // recorded afterwards never shrink it. Null = legacy row (falls back to the
  // old "paid so far" behaviour).
  vatPaidBefore: money("vat_paid_before"),
  // Set when this invoice is an "Additional Invoice" against an original —
  // a separate, independently-tracked invoice that references but never
  // modifies the original. Several additional invoices may share one.
  originalInvoiceId: text("original_invoice_id").references((): AnyPgColumn => invoices.id, {
    onDelete: "set null",
  }),
  // See companies.deletedAt above — same recycle-bin pattern.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const invoiceLineItems = pgTable("invoice_line_items", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull().default(""),
  quantity: numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(1),
  unitPrice: money("unit_price").notNull().default(0),
  amountExVat: money("amount_ex_vat").notNull().default(0),
  // Preserves row order in the UI/PDF; not relied on for calculations.
  orderIndex: integer("order_index").notNull().default(0),
});

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // yyyy-mm-dd
  // Free-form/reusable — see note above paymentMethodEnum's old declaration.
  method: text("method").notNull().default("Bank Transfer"),
  amount: money("amount").notNull(),
  reference: text("reference").notNull().default(""),
  notes: text("notes"),
  // Hours-wise payment recording: when a payment is entered as "N hours at
  // this entry's rate" rather than a typed amount, these two capture that
  // so the Hours screen can show how many hours have been paid vs remain
  // (see hoursPaidForEntry() in calc.ts). Both null for an ordinary
  // fixed-amount payment — the invoice link above is unaffected either way.
  hoursEntryId: text("hours_entry_id").references((): AnyPgColumn => hoursEntries.id, {
    onDelete: "set null",
  }),
  hoursPaid: numeric("hours_paid", { precision: 10, scale: 2, mode: "number" }),
  // See companies.deletedAt above — same recycle-bin pattern.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const expenses = pgTable("expenses", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  category: text("category").notNull().default(""),
  description: text("description").notNull().default(""),
  amountExVat: money("amount_ex_vat").notNull(),
  vatAmount: money("vat_amount").notNull().default(0),
  method: text("method").notNull().default("Bank Transfer"),
  paidTo: text("paid_to").notNull().default(""),
  reference: text("reference"),
  comments: text("comments"),
  // Optional job-costing link: ties this expense to the invoice it was
  // incurred for (e.g. a device repair invoice), so the invoice list can
  // net "invoiced minus this expense" without forcing every expense to
  // have one — most day-to-day expenses have no linked invoice at all.
  invoiceId: text("invoice_id").references((): AnyPgColumn => invoices.id, {
    onDelete: "set null",
  }),
  // See companies.deletedAt above — same recycle-bin pattern.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const hoursEntries = pgTable("hours_entries", {
  id: text("id").primaryKey(),
  month: text("month").notNull(), // yyyy-mm
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  totalHours: numeric("total_hours", { precision: 10, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  payrollHours: numeric("payroll_hours", { precision: 10, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  managementPayrollHours: numeric("management_payroll_hours", {
    precision: 10,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  unpaidHours: numeric("unpaid_hours", { precision: 10, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  rate: money("rate").notNull().default(0),
  notes: text("notes"),
  // The invoice raised for this month's hours, if any — same pattern as
  // subcontractEntries.invoiceId below. Lets the Hours screen show that an
  // entry has already been billed.
  invoiceId: text("invoice_id").references((): AnyPgColumn => invoices.id, {
    onDelete: "set null",
  }),
  // See companies.deletedAt above — same recycle-bin pattern.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const subcontractEntries = pgTable("subcontract_entries", {
  id: text("id").primaryKey(),
  month: text("month").notNull(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  // The client invoice / work allocation this subcontracted work belongs to.
  invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  // Who the hours were subcontracted out to — separate from the client the
  // work was billed to (clientId above).
  subcontractorName: text("subcontractor_name").notNull().default(""),
  hoursProceed: numeric("hours_proceed", { precision: 10, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  rate: money("rate").notNull().default(0),
  description: text("description"),
  reference: text("reference"),
  invoiceDate: text("invoice_date"),
  dueDate: text("due_date"),
  invoiceNumber: text("invoice_number"),
  notes: text("notes"),
  // Off by default — most subcontractor payments are zero-rated/exempt.
  vatIncluded: boolean("vat_included").notNull().default(false),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
  // See companies.deletedAt above — same recycle-bin pattern.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const creditNotes = pgTable("credit_notes", {
  id: text("id").primaryKey(),
  number: text("number").notNull(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  date: text("date").notNull(),
  reason: text("reason").notNull().default(""),
  amountExVat: money("amount_ex_vat").notNull(),
  vatIncluded: boolean("vat_included").notNull().default(false),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(20),
  status: creditNoteStatusEnum("status").notNull().default("draft"),
  comments: text("comments"),
  // See companies.deletedAt above — same recycle-bin pattern.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// Single-row table: one settings record per installation (id is always "default").
export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("default"),
  businessName: text("business_name").notNull().default(""),
  businessEmail: text("business_email").notNull().default(""),
  businessPhone: text("business_phone").notNull().default(""),
  businessAddress: text("business_address").notNull().default(""),
  vatNumber: text("vat_number").notNull().default(""),
  companyNumber: text("company_number").notNull().default(""),
  businessWebsite: text("business_website").notNull().default(""),
  defaultVatRate: numeric("default_vat_rate", { precision: 5, scale: 2, mode: "number" })
    .notNull()
    .default(20),
  currency: text("currency").notNull().default("GBP"),
  paymentMethods: text("payment_methods")
    .array()
    .notNull()
    .default(["Bank Transfer", "Cash", "Payroll", "Other"]),
  paymentTerms: text("payment_terms").array().notNull().default(["On receipt", "30 days"]),
  expenseCategories: text("expense_categories").array().notNull().default(["Other"]),
  invoicePrefix: text("invoice_prefix").notNull().default("INV-"),
  nextInvoiceNumber: integer("next_invoice_number").notNull().default(1),
  creditNotePrefix: text("credit_note_prefix").notNull().default("CN-"),
  bankDetails: text("bank_details").notNull().default(""),
  businessLogo: text("business_logo").notNull().default(""),
  // Default letterhead used for clients not billed under a specific company
  // (see `companies.letterhead` above for the per-company version).
  businessLetterhead: text("business_letterhead").notNull().default(""),
  letterheadMarginTop: numeric("letterhead_margin_top", { precision: 6, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  letterheadMarginBottom: numeric("letterhead_margin_bottom", {
    precision: 6,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
});

/* ---------- Salary sheet (staff, periods, shifts, payroll, cash payments) ---------- */

// One row per staff member — ever. Repeats nothing month to month; every
// month's salary line points back here. NI / bank details live here only and
// are protected by the separate "staff" permission module.
export const payrollStaff = pgTable("payroll_staff", {
  id: text("id").primaryKey(),
  rssId: text("rss_id").notNull().default(""),
  essId: text("ess_id").notNull().default(""),
  // The person's ID inside every other shift company: { "ABC": "1234" }.
  // RSS / ESS keep their own columns above.
  extIds: jsonb("ext_ids").$type<Record<string, string>>().notNull().default({}),
  ni: text("ni").notNull().default(""),
  name: text("name").notNull(),
  tag: text("tag").notNull().default(""),
  // "Name 12345678 04-29-09" — free text for now, same as the Excel column.
  accountDetail: text("account_detail").notNull().default(""),
  area: text("area").notNull().default(""),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  // --- "All Payroll Format" fields (all nullable; dates are yyyy-mm-dd text; age is never stored) ---
  dob: text("dob"),
  gender: text("gender"),
  rtwShareCode: text("rtw_share_code"),
  shareCodeExpiry: text("share_code_expiry"),
  address: text("address"),
  town: text("town"),
  postCode: text("post_code"),
  uniform: text("uniform"),
  accountHolderName: text("account_holder_name"),
  accountNumber: text("account_number"),
  sortCode: text("sort_code"),
  employmentStartDate: text("employment_start_date"),
  employmentEndDate: text("employment_end_date"),
  contractStatus: text("contract_status"), // Active | P45 | Need P45
  email: text("email"),
  immigrationStatus: text("immigration_status"),
  hoursAllowed: text("hours_allowed"),
  siaNumber: text("sia_number"),
  role: text("role"),
  serviceType: text("service_type"),
});

// The companies that supply raw shift exports. RSS and ESS are seeded; the
// client can add as many more as needed from the UI (no code change).
export const shiftCompanies = pgTable("shift_companies", {
  code: text("code").primaryKey(), // upper-case, e.g. "RSS"
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The payroll columns of the sheet (ESS, Fortexo, Secure FM, SES, SPL,
// HS Guarding, Leverage, ...). Managed from the UI so a new company never
// needs a code change.
export const payrollCompanies = pgTable("payroll_companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

// One month = one run. draft -> reviewed -> verified -> closed (locked).
export const salaryPeriods = pgTable("salary_periods", {
  id: text("id").primaryKey(),
  month: text("month").notNull().unique(), // yyyy-mm
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One line of the sheet: one staff member in one month.
export const salaryEntries = pgTable(
  "salary_entries",
  {
    id: text("id").primaryKey(),
    periodId: text("period_id")
      .notNull()
      .references(() => salaryPeriods.id, { onDelete: "cascade" }),
    staffId: text("staff_id")
      .notNull()
      .references(() => payrollStaff.id, { onDelete: "cascade" }),
    rssAmount: money("rss_amount").notNull().default(0),
    rssHours: numeric("rss_hours", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
    essAmount: money("ess_amount").notNull().default(0),
    essHours: numeric("ess_hours", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
    // Earnings from every other shift company: { "ABC": { amount, hours } }.
    // Derived from salary_shifts on each import, like the RSS / ESS columns.
    extra: jsonb("extra")
      .$type<Record<string, { amount: number; hours: number }>>()
      .notNull()
      .default({}),
    // -OverPaid / +Remaining from the previous month (replaces the Excel
    // "OverPaid last month" lookup sheet).
    carryForward: money("carry_forward").notNull().default(0),
    taxDeduction: money("tax_deduction").notNull().default(0),
    deduction: money("deduction").notNull().default(0),
    deductionNote: text("deduction_note"),
    checkStatus: text("check_status").notNull().default(""), // "" | Reviewed | Verified
    flag: text("flag").notNull().default(""), // the sheet's "Client" column (e.g. "pay back")
    // { [payrollCompanyId]: amount } — sparse, so adding a company needs no migration.
    payroll: jsonb("payroll").$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [uniqueIndex("salary_entries_period_staff_uq").on(t.periodId, t.staffId)],
);

// P1, P2, ... — any number of cash payments per line (the sheet shows P1-P4).
export const salaryPayments = pgTable("salary_payments", {
  id: text("id").primaryKey(),
  entryId: text("entry_id")
    .notNull()
    .references(() => salaryEntries.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // yyyy-mm-dd
  amount: money("amount").notNull(),
  method: text("method").notNull().default("Bank Transfer"),
  reference: text("reference").notNull().default(""),
  notes: text("notes"),
});

// The raw shift export rows, kept so any amount can be traced back to its shifts.
export const salaryShifts = pgTable(
  "salary_shifts",
  {
    id: text("id").primaryKey(),
    periodId: text("period_id")
      .notNull()
      .references(() => salaryPeriods.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // "RSS" | "ESS"
    staffId: text("staff_id").references(() => payrollStaff.id, { onDelete: "set null" }),
    employeeId: text("employee_id").notNull().default(""),
    employeeName: text("employee_name").notNull().default(""),
    ni: text("ni").notNull().default(""),
    date: text("date").notNull().default(""),
    clientName: text("client_name").notNull().default(""),
    siteName: text("site_name").notNull().default(""),
    hours: numeric("hours", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
    rate: money("rate").notNull().default(0),
    amount: money("amount").notNull().default(0),
    expenses: money("expenses").notNull().default(0),
    penalty: money("penalty").notNull().default(0),
  },
  (t) => [
    index("salary_shifts_period_source_idx").on(t.periodId, t.source),
    index("salary_shifts_staff_idx").on(t.staffId),
  ],
);
