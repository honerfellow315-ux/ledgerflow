import { sheetTotals, maskNi, type TimesheetSheet } from "./data";
import { formatMoney } from "../ledger/calc";
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
export function timesheetReportHtml(sheets: readonly TimesheetSheet[]): string {
  return sheets
    .map((sheet) => {
      const total = sheetTotals(sheet);
      return `<section><header><h1>Timesheet check receipt</h1><p>${esc(sheet.monthLabel)} · ${esc(sheet.staffName)}</p></header>
      <p>NI: ${esc(maskNi(sheet.ni))} · Source: ${esc(sheet.fileName)}</p>
      <p><strong>Status: ${esc(sheet.status.replace(/_/g, " "))}</strong>${sheet.matchedBy === "name" && !sheet.staffConfirmed ? " · Name match awaiting confirmation" : ""}</p>
      <p>Sheet hours: <b>${total.sheetHours}</b> · Recorded hours: <b>${total.recordHours}</b> · Difference: <b>${total.diff}</b> · Issues: <b>${total.issues}</b>${total.payCalculated && sheet.status !== "staff_not_found" ? ` · Hours to pay: <b>${total.payHours}</b> · Amount to pay: <b>${formatMoney(total.payAmount)}</b>` : ""}</p>
      ${sheet.statedAccepted ? `<p class="notice">Stated total differs from the rows. Accepted by ${esc(sheet.statedAccepted.by)}: ${esc(sheet.statedAccepted.note)}</p>` : ""}
      ${total.statedMismatch ? `<p class="notice">Stated total (${sheet.statedHours}) differs from the row total (${total.sheetHours}).</p>` : ""}
      ${sheet.readNote ? `<p class="notice">${esc(sheet.readNote)}</p>` : ""}
      <table><thead><tr><th>Date</th><th>Site</th><th>Time</th><th>Sheet h</th><th>Record h</th><th>Rate</th><th>Pay h</th><th>Amount</th><th>Result</th></tr></thead><tbody>${sheet.rows.map((row) => `<tr><td>${esc(row.date || "Unreadable")}</td><td>${esc(row.site)}</td><td>${esc(row.start)}–${esc(row.end)}</td><td>${row.sheetHours}</td><td>${row.recordHours ?? "—"}</td><td>${row.payRate == null ? "—" : formatMoney(row.payRate)}</td><td>${row.result !== "match" && !row.accepted ? "Pending" : (row.payHours ?? "—")}</td><td>${row.result !== "match" && !row.accepted ? "Pending" : row.payAmount == null ? "—" : formatMoney(row.payAmount)}</td><td>${esc(row.result.replace(/_/g, " "))}${row.accepted ? ` · <b>accepted</b>` : ""}${row.note ? `<br><small>${esc(row.note)}</small>` : ""}${row.accepted ? `<br><small>Accepted by ${esc(row.accepted.by)}${row.accepted.actualHours == null ? "" : ` · actual hours ${row.accepted.actualHours}`}: ${esc(row.accepted.note)}</small>` : ""}</td></tr>`).join("")}</tbody></table></section>`;
    })
    .join("");
}
export function printTimesheetReport(sheets: readonly TimesheetSheet[]): Promise<void> {
  if (!sheets.length) return Promise.reject(new Error("There are no sheets to print."));
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.style.cssText =
      "position:fixed;bottom:0;right:0;width:0;height:0;border:0;visibility:hidden";
    frame.setAttribute("aria-hidden", "true");
    let printed = false;
    frame.onload = () => {
      if (printed) return;
      printed = true;
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        reject(new Error("The print view could not open."));
        return;
      }
      win.onafterprint = () => window.setTimeout(() => frame.remove(), 1000);
      window.setTimeout(() => {
        try {
          win.focus();
          win.print();
          resolve();
        } catch (error) {
          frame.remove();
          reject(error);
        }
      }, 150);
      window.setTimeout(() => frame.remove(), 120000);
    };
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Timesheet receipts</title><style>
      @page {size:A4 landscape;margin:12mm} *{box-sizing:border-box} body{font:11px/1.5 Arial,sans-serif;color:#152b32} section{break-after:page} section:last-child{break-after:auto} h1{font-size:21px;margin:0} header{border-bottom:2px solid #087f70;padding-bottom:8px} table{width:100%;border-collapse:collapse;margin-top:15px} th,td{padding:7px;text-align:left;border-bottom:1px solid #d8e2e5;vertical-align:top;overflow-wrap:anywhere} th{background:#ecf4f3} thead{display:table-header-group} tr{break-inside:avoid} .notice{padding:8px;background:#fff4d6} small{color:#52626b}
      </style></head><body>${timesheetReportHtml(sheets)}</body></html>`;
    document.body.appendChild(frame);
  });
}
