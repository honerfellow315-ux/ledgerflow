/**
 * Owner Overview summary (Excel): the sentences, the client table, money still to collect,
 * and the six months. Built in the browser from the numbers already on screen, so the file
 * and the screen can never disagree.
 */
import { formatDate, formatMoney } from "@/lib/ledger/calc";
import { marginOf, marginPct, summaryLines, totals, type Overview } from "./data";

const HEAD = "FFE8EEF1";
const MONEY = "£#,##0.00;[Red]-£#,##0.00";

export async function downloadOwnerSummary(o: Overview): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const isMonth = o.range.kind === "month";
  const t = totals(o.rows);
  const head = (ws: import("exceljs").Worksheet) => {
    const r = ws.getRow(1);
    r.font = { bold: true };
    r.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  const sum = wb.addWorksheet("Summary");
  sum.columns = [
    {
      header: `Owner Overview: ${o.range.label} (${formatDate(o.range.from)} to ${formatDate(o.range.to)})`,
      key: "t",
      width: 120,
    },
  ];
  head(sum);
  for (const l of summaryLines(o.range, o.rows, formatMoney)) sum.addRow({ t: l });
  if (o.notes.length > 0) {
    sum.addRow({ t: "" });
    sum.addRow({ t: "Please note" }).font = { bold: true };
    for (const n of o.notes) sum.addRow({ t: n });
  }
  sum.eachRow((r) => {
    r.alignment = { wrapText: true, vertical: "top" };
  });

  const ws = wb.addWorksheet("By client");
  ws.columns = [
    { header: "Client", key: "client", width: 32 },
    { header: "Hours", key: "hours", width: 10 },
    {
      header: o.range.kind === "week" ? "Invoiced (ex VAT)" : "Billed (ex VAT)",
      key: "billed",
      width: 18,
    },
    { header: "Staff cost", key: "cost", width: 14 },
    ...(isMonth
      ? [
          { header: "Margin", key: "margin", width: 14 },
          { header: "Margin %", key: "pct", width: 11 },
        ]
      : []),
    { header: "Received (inc VAT)", key: "received", width: 19 },
    { header: "Outstanding (inc VAT)", key: "out", width: 21 },
    { header: "Overdue (inc VAT)", key: "over", width: 18 },
  ];
  head(ws);
  const add = (name: string, r: Omit<(typeof o.rows)[number], "id" | "client">) => {
    const p = marginPct(r);
    return ws.addRow({
      client: name,
      hours: r.hours,
      billed: r.billed,
      cost: r.staffCost,
      margin: isMonth && r.billed > 0 ? marginOf(r) : "",
      pct: isMonth && p !== null ? p / 100 : "",
      received: r.received,
      out: r.outstanding,
      over: r.overdue,
    });
  };
  for (const r of o.rows) add(r.client, r);
  add("All clients", t).font = { bold: true };
  // "margin" and "pct" exist on month sheets only.
  for (const key of ["billed", "cost", ...(isMonth ? ["margin"] : []), "received", "out", "over"])
    ws.getColumn(key).numFmt = MONEY;
  if (isMonth) ws.getColumn("pct").numFmt = "0.0%";

  const ag = wb.addWorksheet("Still to collect");
  ag.columns = [
    { header: "How late (right now)", key: "l", width: 26 },
    { header: "Amount (inc VAT)", key: "a", width: 20 },
  ];
  head(ag);
  for (const a of o.ageing) ag.addRow({ l: a.label, a: a.amount });
  ag.getColumn("a").numFmt = MONEY;

  const tr = wb.addWorksheet("Last 6 months");
  tr.columns = [
    { header: "Month", key: "m", width: 12 },
    { header: "Billed (ex VAT)", key: "b", width: 18 },
    { header: "Received (inc VAT)", key: "r", width: 20 },
  ];
  head(tr);
  for (const m of o.trend) tr.addRow({ m: m.month, b: m.billed, r: m.received });
  tr.getColumn("b").numFmt = MONEY;
  tr.getColumn("r").numFmt = MONEY;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Owner summary - ${o.range.label} ${o.range.to}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
