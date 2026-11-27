/**
 * "Invoice statement": a print-out of ONLY a client's invoices and where each one stands
 * (paid / partially paid / unpaid) — no account ledger, no payments list.
 *
 * It opens its own small print window, so it never touches the existing statement print
 * (letterhead / print layout), which stays exactly as it was.
 */
import { formatDate, formatMoney, round2, type InvoiceViewWithCredit } from "./calc";
import type { Settings } from "./types";

const esc = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STATUS_LABEL = { paid: "Paid", partial: "Partially paid", unpaid: "Unpaid" } as const;

export function buildInvoiceStatusHtml(args: {
  settings: Pick<Settings, "businessName" | "businessAddress" | "businessEmail" | "businessPhone">;
  clientName: string;
  endClientLabel?: string | undefined;
  invoices: InvoiceViewWithCredit[];
  statementDate: string;
}): string {
  const { settings, clientName, endClientLabel, statementDate } = args;
  const invoices = [...args.invoices].sort(
    (a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.number.localeCompare(b.number),
  );
  const count = { paid: 0, partial: 0, unpaid: 0 };
  let total = 0;
  let settled = 0;
  let outstanding = 0;
  const rows = invoices
    .map((v) => {
      const left = round2(v.effectiveOutstanding);
      const done = round2(v.total - left);
      count[v.effectiveStatus] += 1;
      total += v.total;
      settled += done;
      outstanding += left;
      return `<tr class="${v.effectiveStatus}">
        <td>${esc(v.number)}</td>
        <td>${esc(formatDate(v.invoiceDate))}</td>
        <td>${esc(formatDate(v.dueDate))}</td>
        <td class="n">${esc(formatMoney(v.total))}</td>
        <td class="n">${esc(formatMoney(done))}</td>
        <td class="n">${esc(formatMoney(left))}</td>
        <td>${STATUS_LABEL[v.effectiveStatus]}</td>
      </tr>`;
    })
    .join("");
  const business = [
    settings.businessName,
    settings.businessAddress,
    settings.businessEmail,
    settings.businessPhone,
  ]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .map((x, i) => (i === 0 ? `<strong>${esc(x)}</strong>` : esc(x).replace(/\n/g, "<br>")))
    .join("<br>");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice statement - ${esc(clientName)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .top { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 14px; }
  .meta { text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  .n { text-align: right; white-space: nowrap; }
  tr { page-break-inside: avoid; }
  tfoot td { font-weight: bold; border-top: 2px solid #111; border-bottom: 0; }
  .summary { margin-top: 14px; }
  .summary span { margin-right: 18px; }
</style></head><body>
  <div class="top">
    <div><h1>Invoice statement</h1>
      <div>${esc(clientName)}${endClientLabel ? `<br>${esc(endClientLabel)}` : ""}</div></div>
    <div class="meta">${business}<br>Statement date: ${esc(formatDate(statementDate))}</div>
  </div>
  <table>
    <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th class="n">Total</th><th class="n">Paid / credited</th><th class="n">Outstanding</th><th>Status</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7">No invoices.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="n">${esc(formatMoney(round2(total)))}</td><td class="n">${esc(formatMoney(round2(settled)))}</td><td class="n">${esc(formatMoney(round2(outstanding)))}</td><td></td></tr></tfoot>
  </table>
  <p class="summary"><span>${invoices.length} invoice${invoices.length === 1 ? "" : "s"}</span>
    <span>Paid: ${count.paid}</span><span>Partially paid: ${count.partial}</span><span>Unpaid: ${count.unpaid}</span></p>
</body></html>`;
}

/** Opens the print dialog in a new window. Returns false when the browser blocked the pop-up. */
export function printInvoiceStatus(args: Parameters<typeof buildInvoiceStatusHtml>[0]): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(buildInvoiceStatusHtml(args));
  w.document.close();
  w.focus();
  window.setTimeout(() => w.print(), 300);
  return true;
}
