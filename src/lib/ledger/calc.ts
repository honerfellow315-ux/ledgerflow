import type {
  Client,
  Company,
  CreditNote,
  Expense,
  HoursEntry,
  Invoice,
  InvoiceStatus,
  Payment,
  Settings,
  SubcontractEntry,
} from "./types";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(value || 0);
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** yyyy-mm -> "September 2025" */
export function formatMonth(month: string): string {
  if (!month) return "—";
  const d = new Date(month + "-01T00:00:00");
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function formatHours(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

/**
 * Ex-VAT amount VAT is charged on. "full" mode: the whole invoice. "remaining"
 * mode: invoice amount minus what had ALREADY been paid when VAT was applied
 * (`invoice.vatPaidBefore`, e.g. a payroll payment). That figure is frozen on
 * the invoice, so payments recorded afterwards never change the VAT base.
 *
 * `paidSoFar` is only a fallback for legacy rows that have no `vatPaidBefore`
 * saved yet (old behaviour) — re-save such an invoice to freeze the value.
 */
export function vatBase(invoice: Invoice, paidSoFar = 0): number {
  if (invoice.vatMode !== "remaining") return invoice.amountExVat;
  const paidBefore = invoice.vatPaidBefore ?? paidSoFar;
  return Math.max(0, round2(invoice.amountExVat - paidBefore));
}

export function vatAmount(invoice: Invoice, paidSoFar = 0): number {
  if (!invoice.vatIncluded) return 0;
  return round2(vatBase(invoice, paidSoFar) * (invoice.vatRate / 100));
}

export function amountIncVat(invoice: Invoice, paidSoFar = 0): number {
  return round2(invoice.amountExVat + vatAmount(invoice, paidSoFar));
}

export function paidForInvoice(invoiceId: string, payments: Payment[]): number {
  return round2(
    payments.filter((p) => p.invoiceId === invoiceId).reduce((sum, p) => sum + p.amount, 0),
  );
}

export function statusFor(total: number, paid: number): InvoiceStatus {
  if (paid <= 0.004) return "unpaid";
  if (paid >= total - 0.004) return "paid";
  return "partial";
}

/** Whole days an unpaid invoice is past its due date. */
export function ageingDays(dueDate: string, outstanding: number, today = new Date()): number {
  if (outstanding <= 0.004 || !dueDate) return 0;
  const due = new Date(dueDate + "T00:00:00");
  if (Number.isNaN(due.getTime())) return 0;
  const diff = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  return diff > 0 ? diff : 0;
}

export function ageingBand(days: number): string {
  if (days <= 0) return "Current";
  if (days <= 30) return "1–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "90+ days";
}

export interface InvoiceView extends Invoice {
  vat: number;
  total: number;
  paid: number;
  outstanding: number;
  status: InvoiceStatus;
  ageing: number;
  clientName: string;
  clientCompany: string;
  /** Month the invoice was settled in full, yyyy-mm, when applicable. */
  monthOfPayment: string;
  lastPaymentDate: string;
  /** Ex-VAT balance that VAT was charged on (== amountExVat unless "remaining" mode). */
  vatBase: number;
  /** Ex-VAT amount that had been paid before VAT was applied ("remaining" mode only, else 0). */
  paidBeforeVat: number;
  /** True when the printed invoice should show only the VAT-bearing balance
   * (not the full original amount) — the full amount stays in history/ledger. */
  balanceOnly: boolean;
  /** Total of the issued / applied credit notes linked to this invoice.
   * Calculated on screen only — nothing is written to the invoice row. `total`
   * stays the original invoice value; `outstanding` and `status` are after it. */
  credited: number;
  /** Every credit note linked to this invoice (any status), oldest first. */
  linkedCreditNotes: CreditNote[];
}

/** Credit notes in these statuses reduce the invoice they are linked to. */
export const DEDUCTING_CREDIT_STATUSES = ["issued", "applied"] as const;

export function buildInvoiceViews(
  invoices: Invoice[],
  payments: Payment[],
  clients: Client[],
  creditNotes: CreditNote[] = [],
): InvoiceView[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const notesByInvoice = new Map<string, CreditNote[]>();
  for (const n of creditNotes) {
    if (!n.invoiceId) continue;
    const list = notesByInvoice.get(n.invoiceId) ?? [];
    list.push(n);
    notesByInvoice.set(n.invoiceId, list);
  }
  return invoices.map((inv) => {
    // Paid amount is computed before VAT so "remaining" VAT mode can charge
    // VAT only on what's still outstanding ex-VAT (see vatAmount above).
    const paid = paidForInvoice(inv.id, payments);
    const vat = vatAmount(inv, paid);
    const base = inv.vatIncluded ? vatBase(inv, paid) : inv.amountExVat;
    const paidBeforeVat = round2(inv.amountExVat - base);
    const balanceOnly = inv.vatIncluded && inv.vatMode === "remaining" && paidBeforeVat > 0.004;
    const total = round2(inv.amountExVat + vat);
    const client = byId.get(inv.clientId);
    const linkedCreditNotes = [...(notesByInvoice.get(inv.id) ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
    );
    // A credit note can never take an invoice below zero.
    const credited = Math.min(
      total,
      round2(
        linkedCreditNotes
          .filter((n) => (DEDUCTING_CREDIT_STATUSES as readonly string[]).includes(n.status))
          .reduce((sum, n) => sum + creditNoteTotal(n), 0),
      ),
    );
    const netTotal = round2(total - credited);
    const outstanding = round2(netTotal - paid);
    const status: InvoiceStatus =
      credited > 0.004 && netTotal <= 0.004 ? "paid" : statusFor(netTotal, paid);
    const invoicePayments = payments
      .filter((p) => p.invoiceId === inv.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    const lastPaymentDate = invoicePayments.at(-1)?.date ?? "";
    return {
      ...inv,
      vat,
      total,
      paid,
      outstanding,
      status,
      ageing: ageingDays(inv.dueDate, outstanding),
      clientName: client?.name ?? "—",
      clientCompany: client?.company ?? "—",
      monthOfPayment: status === "paid" ? lastPaymentDate.slice(0, 7) : "",
      lastPaymentDate,
      vatBase: base,
      paidBeforeVat: balanceOnly ? paidBeforeVat : 0,
      balanceOnly,
      credited,
      linkedCreditNotes,
    };
  });
}

export interface ClientTotals {
  invoiced: number;
  paid: number;
  outstanding: number;
  invoiceCount: number;
}

export function totalsForClient(clientId: string, views: InvoiceView[]): ClientTotals {
  const rows = views.filter((v) => v.clientId === clientId);
  return {
    invoiced: round2(rows.reduce((s, r) => s + r.total, 0)),
    paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
    outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
    invoiceCount: rows.length,
  };
}

/* ---------- Credit balance (overpayment carried forward) ---------- */

export interface InvoiceViewWithCredit extends InvoiceView {
  /** How much of this invoice's total was settled from a prior credit
   * balance rather than from a payment recorded directly against it. */
  creditApplied: number;
  /** `outstanding` after netting off any credit applied — what's actually
   * still owed once earlier overpayments have been used to cover this
   * invoice. This is what should be shown/used anywhere "outstanding" or
   * "status" would otherwise be misleading for a client who's ahead. */
  effectiveOutstanding: number;
  effectiveStatus: InvoiceStatus;
}

/**
 * Walks a client's invoices oldest-first and carries any overpayment
 * forward: if invoice A is paid £50 more than it's worth, that £50 is
 * automatically available to cover invoice B (or C, D…) the moment it
 * exists — no separate "apply credit" step, no fabricated payment record on
 * B. `paid`/`outstanding` (the real, per-invoice figures from payments)
 * are untouched; only the new `effective*` fields and `creditApplied`
 * reflect the carried-forward credit, and `remainingCredit` is what's left
 * over (unused) after every invoice has had a chance to draw on it.
 */
export function applyClientCredit(views: InvoiceView[]): {
  views: InvoiceViewWithCredit[];
  remainingCredit: number;
} {
  const ordered = [...views].sort(
    (a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.id.localeCompare(b.id),
  );
  let pool = 0;
  const out: InvoiceViewWithCredit[] = [];
  for (const v of ordered) {
    if (v.outstanding <= 0.004) {
      // Already settled (or overpaid) on its own — any overpayment on this
      // specific invoice tops the pool up for whatever comes next.
      pool = round2(pool + Math.max(0, -v.outstanding));
      out.push({ ...v, creditApplied: 0, effectiveOutstanding: 0, effectiveStatus: "paid" });
      continue;
    }
    const applied = round2(Math.min(pool, v.outstanding));
    pool = round2(pool - applied);
    const effectiveOutstanding = round2(v.outstanding - applied);
    out.push({
      ...v,
      creditApplied: applied,
      effectiveOutstanding,
      effectiveStatus: statusFor(v.total, round2(v.paid + applied)),
    });
  }
  // Restore the caller's original ordering (newest-first lists etc.) —
  // only the allocation pass above needs chronological order.
  const byId = new Map(out.map((v) => [v.id, v]));
  return {
    views: views.map((v) => byId.get(v.id)!),
    remainingCredit: pool,
  };
}

/** A client's current, unallocated credit balance — money they've paid in
 * that hasn't (yet) been needed to cover any of their invoices. Shown on
 * the client profile and the Invoices list so it's obvious before the next
 * invoice is even raised. */
export function clientCreditBalance(clientId: string, views: InvoiceView[]): number {
  return applyClientCredit(views.filter((v) => v.clientId === clientId)).remainingCredit;
}

/* ---------- Expenses ---------- */

export function expenseTotal(expense: Expense): number {
  return round2(expense.amountExVat + expense.vatAmount);
}

/** Sum of every expense linked to this invoice (expense.invoiceId === invoice.id)
 * — the "job cost" side of the plus-minus view on the Invoices list. */
export function expensesForInvoice(invoiceId: string, expenses: Expense[]): number {
  return round2(
    expenses.filter((e) => e.invoiceId === invoiceId).reduce((sum, e) => sum + expenseTotal(e), 0),
  );
}

export interface ExpenseTotals {
  net: number;
  vat: number;
  gross: number;
  count: number;
}

export function totalsForExpenses(expenses: Expense[]): ExpenseTotals {
  return {
    net: round2(expenses.reduce((s, e) => s + e.amountExVat, 0)),
    vat: round2(expenses.reduce((s, e) => s + e.vatAmount, 0)),
    gross: round2(expenses.reduce((s, e) => s + expenseTotal(e), 0)),
    count: expenses.length,
  };
}

/** Revenue (ex VAT) minus expenses (ex VAT). */
export function netProfit(revenueExVat: number, expensesExVat: number): number {
  return round2(revenueExVat - expensesExVat);
}

/* ---------- Hours & subcontracting ---------- */

export function remainingHours(entry: HoursEntry): number {
  return round2(
    entry.totalHours - entry.payrollHours - entry.managementPayrollHours - entry.unpaidHours,
  );
}

export function hoursValue(entry: HoursEntry): number {
  return round2(remainingHours(entry) * entry.rate);
}

/** Total hours paid against this entry so far, via payments recorded "by
 * hours" (payment.hoursEntryId === entry.id). Ordinary fixed-amount
 * payments (hoursEntryId unset) never contribute here. */
export function hoursPaidForEntry(entryId: string, payments: Payment[]): number {
  return round2(
    payments
      .filter((p) => p.hoursEntryId === entryId)
      .reduce((sum, p) => sum + (p.hoursPaid ?? 0), 0),
  );
}

/** Billable hours still owed a payment: remaining (billable) hours minus
 * whatever's already been paid by hours. Never negative — overpaying by
 * hours (e.g. a rate change) just floors at 0 rather than going negative. */
export function hoursRemainingToPay(entry: HoursEntry, payments: Payment[]): number {
  return Math.max(0, round2(remainingHours(entry) - hoursPaidForEntry(entry.id, payments)));
}

/**
 * Whether this invoice tracks hours at all. Only invoices billed as
 * Hours × Rate have `hours` set (see InvoiceDialog's "Billing Type"); a
 * Fixed Amount or Line Items invoice has no hours to allocate to
 * subcontractors, so the remaining-hours feature simply doesn't apply.
 */
export function invoiceTracksHours(invoice: Pick<Invoice, "hours">): boolean {
  return invoice.hours != null;
}

/** Total hours already processed against this invoice via (non-deleted)
 * subcontractor entries. `excludeEntryId` lets an edit-in-progress compute
 * "everyone else's hours" so the entry being edited isn't double-counted
 * against itself. */
export function processedHoursForInvoice(
  invoiceId: string,
  subcontracts: SubcontractEntry[],
  excludeEntryId?: string,
): number {
  return round2(
    subcontracts
      .filter((s) => s.invoiceId === invoiceId && s.id !== excludeEntryId)
      .reduce((sum, s) => sum + s.hoursProceed, 0),
  );
}

/**
 * Remaining Hours = Invoice Total Hours − Total Hours Already Processed
 * Through Subcontractor Entries. Returns `null` when the invoice doesn't
 * track hours at all (see invoiceTracksHours) — there's nothing to remain.
 * Never negative: floors at 0 so a data inconsistency never displays as a
 * negative remaining balance.
 */
export function remainingInvoiceHours(
  invoice: Pick<Invoice, "id" | "hours">,
  subcontracts: SubcontractEntry[],
  excludeEntryId?: string,
): number | null {
  if (!invoiceTracksHours(invoice)) return null;
  const total = invoice.hours ?? 0;
  const processed = processedHoursForInvoice(invoice.id, subcontracts, excludeEntryId);
  return Math.max(0, round2(total - processed));
}

/**
 * Hours covered by payments received on this invoice. Proportional to the
 * paid share of the invoice total (so VAT and part-payments are handled
 * automatically): paidHours = hours x (paid / total), capped at the invoice
 * hours. Returns 0 for invoices that don't track hours.
 */
export function paidHoursForInvoice(
  invoice: Pick<Invoice, "hours">,
  paid: number,
  total: number,
): number {
  if (!invoiceTracksHours(invoice) || total <= 0.004 || paid <= 0) return 0;
  const hours = invoice.hours ?? 0;
  return Math.min(hours, round2(hours * (paid / total)));
}

/**
 * Display figures for the Invoices screen. Processed = subcontract hours +
 * hours covered by payments received; Remaining = Total - Processed (never
 * negative). Display only: the subcontract allocation cap
 * (remainingInvoiceHours) is intentionally unchanged.
 */
export function invoiceHoursDisplay(
  invoice: Pick<Invoice, "id" | "hours">,
  subcontracts: SubcontractEntry[],
  paid: number,
  total: number,
): { total: number; subcontractHours: number; paidHours: number; processed: number; remaining: number } {
  const totalHours = invoice.hours ?? 0;
  const subcontractHours = processedHoursForInvoice(invoice.id, subcontracts);
  const paidHours = paidHoursForInvoice(invoice, paid, total);
  const processed = round2(subcontractHours + paidHours);
  return {
    total: totalHours,
    subcontractHours,
    paidHours,
    processed,
    remaining: Math.max(0, round2(totalHours - processed)),
  };
}

export interface InvoiceHoursSummary {
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  totalHours: number;
  processedHours: number;
  remainingHours: number;
}

/** One row per hours-tracking invoice, for the "Company → its invoices'
 * hours" overview (see the Subcontracting screen's Company filter). */
export function invoiceHoursSummaries(
  invoices: Invoice[],
  subcontracts: SubcontractEntry[],
): InvoiceHoursSummary[] {
  return invoices.filter(invoiceTracksHours).map((inv) => {
    const processedHours = processedHoursForInvoice(inv.id, subcontracts);
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      clientId: inv.clientId,
      totalHours: inv.hours ?? 0,
      processedHours,
      remainingHours: Math.max(0, round2((inv.hours ?? 0) - processedHours)),
    };
  });
}

export function subcontractValue(entry: SubcontractEntry): number {
  return round2(entry.hoursProceed * entry.rate);
}

/** Same simple on/off pattern as creditNoteVat — no partial-payment "remaining
 * balance" mode like invoices have, since a subcontract entry isn't paid down
 * incrementally. */
export function subcontractVat(entry: SubcontractEntry): number {
  if (!entry.vatIncluded) return 0;
  return round2(subcontractValue(entry) * (entry.vatRate / 100));
}

export function subcontractValueIncVat(entry: SubcontractEntry): number {
  return round2(subcontractValue(entry) + subcontractVat(entry));
}

/* ---------- Credit notes ---------- */

export function creditNoteVat(note: CreditNote): number {
  if (!note.vatIncluded) return 0;
  return round2(note.amountExVat * (note.vatRate / 100));
}

export function creditNoteTotal(note: CreditNote): number {
  return round2(note.amountExVat + creditNoteVat(note));
}

/* ---------- Multi-company billing ---------- */

/**
 * The business profile to print on a client's invoice/statement: their
 * linked company's details if they have one, otherwise the global Settings
 * business profile (unchanged behaviour for clients with no company set).
 */
export function businessProfileFor(
  settings: Settings,
  companies: Company[],
  client: Client | undefined,
): Settings {
  const company = client?.companyId ? companies.find((c) => c.id === client.companyId) : undefined;
  if (!company) return settings;
  return {
    ...settings,
    businessName: company.name,
    businessEmail: company.email,
    businessPhone: company.phone,
    businessAddress: company.address,
    vatNumber: company.vatNumber,
    companyNumber: company.companyNumber,
    businessWebsite: company.website ?? "",
    bankDetails: company.bankDetails ?? "",
    businessLogo: company.logo ?? "",
    businessLetterhead: company.letterhead ?? "",
    letterheadMarginTop: company.letterheadMarginTop ?? settings.letterheadMarginTop ?? 0,
    letterheadMarginBottom: company.letterheadMarginBottom ?? settings.letterheadMarginBottom ?? 0,
  };
}

/* ---------- Invoice numbering ---------- */

/** Splits "FFM-0644" into { prefix: "FFM-", digits: "0644" }; null when the number doesn't end in digits. */
function splitInvoiceNumber(number: string): { prefix: string; digits: string } | null {
  const m = /^(.*?)(\d+)$/.exec(number.trim());
  return m ? { prefix: m[1] ?? "", digits: m[2] ?? "" } : null;
}

/**
 * The next invoice number in sequence for a client: the highest number already
 * used in the same series, plus one (644 -> 645). A "series" is the invoices
 * with the same prefix that belong to the same billing company (or, for
 * clients with no billing company, the same default-business group), so
 * different clients under one company share one running line.
 *
 * Nothing is stored — the suggestion is derived from the existing invoices
 * every time, and the person can still overtype it.
 */
export function suggestNextInvoiceNumber(args: {
  invoices: Invoice[];
  clients: Client[];
  clientId: string;
  /** Prefix configured for this client's company (or the global one). */
  prefix: string;
  /** Last-resort counter from Settings, used only when no earlier invoice gives a series. */
  fallbackNext: number;
}): string {
  const { invoices, clients, clientId, prefix, fallbackNext } = args;
  const companyOf = new Map(clients.map((c) => [c.id, c.companyId ?? null]));
  const scope = companyOf.get(clientId) ?? null;
  const inScope = invoices.filter((i) => (companyOf.get(i.clientId) ?? null) === scope);

  const highestIn = (pfx: string, pool: Invoice[]) => {
    let best: { value: number; width: number } | null = null;
    for (const inv of pool) {
      const parts = splitInvoiceNumber(inv.number);
      if (!parts || parts.prefix !== pfx) continue;
      const value = Number.parseInt(parts.digits, 10);
      if (!Number.isFinite(value)) continue;
      if (!best || value > best.value) best = { value, width: parts.digits.length };
    }
    return best;
  };

  // 1) The configured prefix, within this company's invoices.
  let pfx = prefix;
  let best = highestIn(pfx, inScope);

  // 2) No invoice uses that prefix yet: follow the series this client's most
  //    recent invoice is already in (e.g. plain "643" with no prefix at all).
  if (!best) {
    const latest = inScope
      .filter((i) => i.clientId === clientId)
      .sort(
        (a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.number.localeCompare(a.number),
      )
      .find((i) => splitInvoiceNumber(i.number));
    const parts = latest ? splitInvoiceNumber(latest.number) : null;
    if (parts) {
      pfx = parts.prefix;
      best = highestIn(pfx, inScope);
    }
  }

  if (best) return `${pfx}${String(best.value + 1).padStart(best.width, "0")}`;
  return `${prefix}${String(fallbackNext).padStart(3, "0")}`;
}

/* ---------- End clients & ownership ---------- */

/** Filter value meaning "invoices that have no End Client set". */
export const UNASSIGNED_END_CLIENT = "__unassigned__";

/** Trimmed End Client name; "" when not assigned. */
export function endClientOf(invoice: Pick<Invoice, "endClient">): string {
  return (invoice.endClient ?? "").trim();
}

const sameName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/**
 * Whether an invoice falls inside an End Client filter. "" = no filter (every
 * invoice), UNASSIGNED_END_CLIENT = only invoices with no End Client, anything
 * else = that End Client name (case-insensitive).
 */
export function matchesEndClient(invoice: Pick<Invoice, "endClient">, filter: string): boolean {
  if (!filter) return true;
  const name = endClientOf(invoice);
  if (filter === UNASSIGNED_END_CLIENT) return name === "";
  return sameName(name, filter);
}

/** Distinct End Client names used on a client's invoices (A–Z, one spelling per name) plus whether any invoice has none. */
export function endClientOptions(
  invoices: Pick<Invoice, "clientId" | "endClient">[],
  clientId?: string,
): { names: string[]; hasUnassigned: boolean } {
  const seen = new Map<string, string>();
  let hasUnassigned = false;
  for (const inv of invoices) {
    if (clientId && inv.clientId !== clientId) continue;
    const name = endClientOf(inv);
    if (!name) hasUnassigned = true;
    else if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return { names: [...seen.values()].sort((a, b) => a.localeCompare(b)), hasUnassigned };
}

/**
 * Who a payment belongs to is decided by the invoice it pays, not by the
 * copy of clientId stored on the payment row: if an invoice is ever moved to
 * another client, its payments follow it automatically and nothing in the
 * database has to be rewritten. Falls back to the stored clientId only when
 * the invoice can't be found.
 */
export function paymentOwnerClientId(
  payment: Pick<Payment, "invoiceId" | "clientId">,
  invoiceById: Map<string, Pick<Invoice, "clientId">>,
): string {
  return invoiceById.get(payment.invoiceId)?.clientId ?? payment.clientId;
}

/** Same rule for credit notes: a note linked to an invoice belongs to that invoice's client. */
export function creditNoteOwnerClientId(
  note: Pick<CreditNote, "invoiceId" | "clientId">,
  invoiceById: Map<string, Pick<Invoice, "clientId">>,
): string {
  return (note.invoiceId ? invoiceById.get(note.invoiceId)?.clientId : undefined) ?? note.clientId;
}

/** Totals for an already-filtered set of invoice views (e.g. one End Client). */
export function totalsForViews(views: InvoiceView[]): ClientTotals {
  return {
    invoiced: round2(views.reduce((s, r) => s + r.total, 0)),
    paid: round2(views.reduce((s, r) => s + r.paid, 0)),
    outstanding: round2(views.reduce((s, r) => s + r.outstanding, 0)),
    invoiceCount: views.length,
  };
}

/** PO / reference of the invoice a credit note is linked to ("" when unlinked
 * or the invoice has none). Credit notes always show this live value, so the
 * PO can never drift from the invoice and a wrong link is easy to spot. */
export function creditNotePoReference(
  note: Pick<CreditNote, "invoiceId">,
  invoices: Pick<Invoice, "id" | "poReference">[],
): string {
  if (!note.invoiceId) return "";
  return (invoices.find((i) => i.id === note.invoiceId)?.poReference ?? "").trim();
}