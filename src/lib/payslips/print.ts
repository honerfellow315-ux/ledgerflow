/**
 * Prints payslips (one per page) through the browser's print dialog, where "Save as PDF"
 * makes the PDF. The page is built in a hidden frame of its own, so nothing in the app's
 * styles can change how a payslip looks, and no extra library is needed.
 * Every value is escaped before it goes into the page.
 */
import { formatMoney } from "../ledger/calc";
import { formatMonthLabel, formatNi } from "../payroll/calc";
import { earningLines, payslipTotals, type PayslipRow } from "./data";

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const hrs = (n: number) => String(Number(n.toFixed(2)));

function payslipHtml(p: PayslipRow): string {
  const lines = earningLines(p);
  const body =
    lines.length === 0
      ? `<tr><td colspan="4" class="mute">No pay recorded for this month.</td></tr>`
      : lines
          .map(
            (l) =>
              `<tr><td>${esc(l.label)}</td><td class="r">${l.hours === null ? "" : hrs(l.hours)}</td><td class="r">${l.rate === null ? "" : esc(formatMoney(l.rate))}</td><td class="r">${esc(formatMoney(l.amount))}</td></tr>`,
          )
          .join("");
  return `<section class="slip">
  <header>
    <div><h1>${esc(p.company)}</h1>${p.companyAddress ? `<p class="mute pre">${esc(p.companyAddress)}</p>` : ""}<p class="mute">Payslip</p></div>
    <div class="r"><p class="mute">Pay period</p><p class="b">${esc(formatMonthLabel(p.month))}</p></div>
  </header>
  <dl>
    <div><dt>Name</dt><dd>${esc(p.name)}</dd></div>
    <div><dt>NI number</dt><dd>${p.ni.trim() ? esc(formatNi(p.ni)) : "Not recorded"}</dd></div>
  </dl>
  <table>
    <thead><tr><th>Description</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  <footer><span>Total pay</span><span>${esc(formatMoney(payslipTotals(p).amount))}</span></footer>
</section>`;
}

const STYLE = `
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.45 Arial, Helvetica, sans-serif; color: #0f172a; }
.slip { page-break-after: always; break-after: page; }
.slip:last-child { page-break-after: auto; break-after: auto; }
header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #cbd5e1; padding-bottom: 12px; }
h1 { margin: 0; font-size: 20px; }
p { margin: 2px 0; }
.mute { color: #64748b; }
.pre { white-space: pre-line; }
.b { font-weight: 700; }
.r { text-align: right; }
dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 0; padding: 14px 0; border-bottom: 1px solid #cbd5e1; }
dt { color: #64748b; }
dd { margin: 0; font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin-top: 14px; }
th { text-align: left; color: #64748b; font-weight: 600; padding: 0 0 6px; border-bottom: 1px solid #cbd5e1; }
th.r { text-align: right; }
td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
td.r { text-align: right; font-variant-numeric: tabular-nums; }
footer { display: flex; justify-content: space-between; margin-top: 14px; padding-top: 10px; border-top: 2px solid #94a3b8; font-size: 16px; font-weight: 700; }
`;

/** Opens the print dialog for these payslips. Resolves once the dialog has been opened. */
export function printPayslips(rows: readonly PayslipRow[], title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (rows.length === 0) {
      reject(new Error("There are no payslips to print."));
      return;
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    const cleanup = () => window.setTimeout(() => frame.remove(), 1000);
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        reject(new Error("The print window could not be opened."));
        return;
      }
      win.onafterprint = cleanup;
      window.setTimeout(() => {
        win.focus();
        win.print();
        resolve();
        // Some browsers never fire afterprint: remove the frame later anyway.
        window.setTimeout(() => frame.remove(), 120000);
      }, 150);
    };
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${rows
      .map(payslipHtml)
      .join("")}</body></html>`;
    document.body.appendChild(frame);
  });
}
