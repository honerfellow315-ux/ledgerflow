/**
 * Bank Match: shared types and the matching rules (no database, no browser code here).
 *
 * A bank line is matched against the invoices that still have money outstanding:
 *   1. The invoice number in the bank text (strongest clue).
 *   2. A client name found in the bank text, or a payer name the person linked before.
 * A line is "matched" (ready to confirm) only when exactly ONE invoice fits and the amount is
 * exact. Anything less sure is "review", and nothing at all is "none". The system never records
 * a payment by itself: a person confirms (or the "Confirm all matched" button does, and the
 * server re-checks every line again at that moment).
 */
import { formatMoney, round2 } from "@/lib/ledger/calc";

export type LineStatus = "matched" | "review" | "none" | "confirmed" | "ignored";

export interface OpenInvoice {
  id: string;
  number: string;
  clientId: string;
  client: string;
  outstanding: number;
  dueDate: string;
  /** Payments already recorded on this invoice (used to warn about double recording). */
  payments: { date: string; amount: number }[];
}

export interface BankLine {
  id: string;
  statementId: string;
  date: string;
  description: string;
  amount: number;
  status: LineStatus;
  /** The invoice picked by the system (open lines) or by the person (confirmed lines). */
  invoiceId: string | null;
  /** Why the system picked this invoice, or why it could not. */
  reason: string;
  /** Other invoices worth a look, best first (open lines only). */
  candidateIds: string[];
}

export interface StatementInfo {
  id: string;
  fileName: string;
  lineCount: number;
  skippedOut: number;
  uploadedBy: string;
  uploadedAt: string;
  confirmed: number;
}

/* ------------------------------ text helpers ------------------------------ */

const PAYMENT_WORDS = new Set([
  "faster",
  "payment",
  "payments",
  "fp",
  "fpi",
  "bacs",
  "chaps",
  "transfer",
  "trf",
  "standing",
  "order",
  "so",
  "credit",
  "cr",
  "dd",
  "bgc",
  "tfr",
  "inv",
  "invoice",
  "ref",
  "from",
  "bank",
  "giro",
  "inward",
  "received",
]);
const NAME_STOP = new Set([
  "ltd",
  "limited",
  "plc",
  "llp",
  "the",
  "and",
  "uk",
  "group",
  "services",
  "service",
  "co",
  "company",
  "of",
]);

/** Upper-case letters and digits only. */
export const squash = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);

/** Words that identify a client (its name without Ltd, The, and so on). */
export function nameWords(name: string): string[] {
  const w = words(name).filter((x) => !NAME_STOP.has(x) && x.length > 1);
  return w.length > 0 ? w : words(name);
}

/**
 * The part of a bank text that says WHO paid: payment words, numbers and invoice references are
 * removed. Used as the key when a person links "this bank name = this client".
 */
export function payerKey(description: string): string {
  return words(description)
    .filter((w) => !PAYMENT_WORDS.has(w) && !/\d/.test(w))
    .join(" ")
    .slice(0, 80);
}

/** True when the invoice number appears in the bank text (ignoring spaces, dashes and case). */
export function textHasInvoiceNumber(text: string, number: string): boolean {
  const n = squash(number);
  if (n.length < 4) return false;
  return squash(text).includes(n);
}

/**
 * Banks often cut the reference short ("0139" instead of "INV-2026-0139"). The last group of
 * digits of the number (at least 3 digits) counts as a clue, but ONLY as a whole word in the
 * bank text and only together with a client name hit (the caller checks that).
 */
export function textHasShortRef(text: string, number: string): boolean {
  const groups = number.match(/\d+/g);
  const last = groups?.[groups.length - 1];
  if (!last || last.length < 3) return false;
  const w = words(text);
  return w.includes(last) || w.includes(last.replace(/^0+/, "") || last);
}

/** The first 2 significant words of the client name are in the bank text. */
export function textHasClientName(text: string, clientName: string): boolean {
  const need = nameWords(clientName).slice(0, 2);
  if (need.length === 0) return false;
  const have = new Set(words(text));
  return need.every((w) => have.has(w));
}

/* ------------------------------ amount ------------------------------ */

export const sameMoney = (a: number, b: number): boolean => Math.abs(round2(a - b)) < 0.005;

/** A payment can never be more than what is still owed on the invoice. */
export const overpays = (amount: number, inv: OpenInvoice): boolean =>
  round2(amount - inv.outstanding) > 0.004;

export function compareAmount(
  amount: number,
  inv: OpenInvoice,
): { label: string; tone: "good" | "warn" | "bad" } {
  const diff = round2(inv.outstanding - amount);
  if (Math.abs(diff) < 0.005) return { label: "Exact amount", tone: "good" };
  if (diff > 0) return { label: `Part payment, ${formatMoney(diff)} would remain`, tone: "warn" };
  return { label: `${formatMoney(-diff)} more than is owed, cannot be recorded`, tone: "bad" };
}

/** Days between two yyyy-mm-dd dates (absolute). */
function dayGap(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * The same money may already have been typed into Payments by hand. A payment of exactly this
 * amount on this invoice within a week of the bank date is flagged: a person must tick
 * "record anyway" before it is recorded a second time.
 */
export function duplicateWarning(
  line: { date: string; amount: number },
  inv: OpenInvoice,
): string | null {
  const hit = inv.payments.find(
    (p) => sameMoney(p.amount, line.amount) && dayGap(p.date, line.date) <= 7,
  );
  return hit
    ? `A payment of ${formatMoney(hit.amount)} was already recorded on this invoice on ${hit.date}.`
    : null;
}

/* ------------------------------ matching ------------------------------ */

export interface MatchResult {
  status: "matched" | "review" | "none";
  invoiceId: string | null;
  candidateIds: string[];
  reason: string;
}

interface Hit {
  inv: OpenInvoice;
  byNumber: boolean;
}

/** @param linkedClientId the client a person linked to this payer name before (or null) */
export function matchLine(
  line: { date: string; description: string; amount: number },
  open: OpenInvoice[],
  linkedClientId: string | null,
): MatchResult {
  const text = line.description;
  const hits: Hit[] = [];
  for (const inv of open) {
    const nameHit =
      textHasClientName(text, inv.client) ||
      (linkedClientId !== null && linkedClientId === inv.clientId);
    const numberHit =
      textHasInvoiceNumber(text, inv.number) || (nameHit && textHasShortRef(text, inv.number));
    if (numberHit || nameHit) hits.push({ inv, byNumber: numberHit });
  }
  if (hits.length === 0) {
    return {
      status: "none",
      invoiceId: null,
      candidateIds: [],
      reason: "Nothing in the bank text points to a client or an invoice.",
    };
  }

  const numbered = hits.filter((h) => h.byNumber);
  const pool = numbered.length > 0 ? numbered : hits;
  const isExact = (h: Hit) => sameMoney(h.inv.outstanding, line.amount);
  const exact = pool.filter(isExact);
  const ordered = [...pool].sort(
    (a, b) =>
      Number(isExact(b)) - Number(isExact(a)) ||
      Math.abs(line.amount - a.inv.outstanding) - Math.abs(line.amount - b.inv.outstanding) ||
      a.inv.dueDate.localeCompare(b.inv.dueDate),
  );
  const rest = hits.filter((h) => !pool.includes(h)).map((h) => h.inv.id);
  const candidateIds = [...ordered.map((h) => h.inv.id), ...rest];
  const clue =
    numbered.length > 0
      ? "Invoice number found in the bank text"
      : "Client name found in the bank text";
  const best = ordered[0]!;

  if (exact.length === 1) {
    const only = exact[0]!;
    const dup = duplicateWarning(line, only.inv);
    if (dup) return { status: "review", invoiceId: only.inv.id, candidateIds, reason: dup };
    return {
      status: "matched",
      invoiceId: only.inv.id,
      candidateIds,
      reason: `${clue} and the amount is exact.`,
    };
  }
  if (exact.length > 1) {
    return {
      status: "review",
      invoiceId: best.inv.id,
      candidateIds,
      reason: `${exact.length} invoices have exactly this amount${numbered.length > 0 ? " and the number in the text" : ""}. Pick the right one.`,
    };
  }
  const why = overpays(line.amount, best.inv)
    ? "but the payment is more than this invoice is owed."
    : "but the amount is less than the invoice (a part payment).";
  return { status: "review", invoiceId: best.inv.id, candidateIds, reason: `${clue}, ${why}` };
}

/** Open invoices for the choose dialog: the system's picks first, then the rest by closest amount. */
export function orderForChoosing(line: BankLine, open: OpenInvoice[]): OpenInvoice[] {
  const rank = new Map(line.candidateIds.map((id, i) => [id, i]));
  return [...open].sort((a, b) => {
    const ra = rank.get(a.id) ?? 1_000_000;
    const rb = rank.get(b.id) ?? 1_000_000;
    return ra - rb || Math.abs(line.amount - a.outstanding) - Math.abs(line.amount - b.outstanding);
  });
}
