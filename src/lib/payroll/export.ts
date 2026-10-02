/**
 * Excel export of one salary month in the same column layout as the original
 * "Salary Sheet" workbook, with live formulas (and cached values so it also
 * reads correctly in viewers that don't recalculate).
 */
import { formatMonthLabel, round2, sumRows, type SheetRow } from "./calc";
import type { PayrollCompany } from "./types";

const col = (n: number): string => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

export async function exportSalarySheet(
  month: string,
  rows: readonly SheetRow[],
  companies: readonly PayrollCompany[],
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Salary Sheet", {
    views: [{ state: "frozen", xSplit: 6, ySplit: 3 }],
  });

  const known = new Set(companies.map((c) => c.id));
  const hasOther = rows.some((r) =>
    Object.entries(r.entry.payroll).some(([id, v]) => !known.has(id) && v !== 0),
  );
  const payrollCols = [
    ...companies.map((c) => ({ id: c.id as string | null, name: c.name })),
    ...(hasOther ? [{ id: null, name: "Other (archived)" }] : []),
  ];
  const nPay = Math.max(4, ...rows.map((r) => r.payments.length));

  // Shift companies other than RSS / ESS that have any money, hours or staff ID
  // in these rows: one ID column and one Amount + Hours pair each.
  const extraCodes = [
    ...new Set(
      rows.flatMap((r) => [
        ...Object.entries(r.entry.extra ?? {})
          .filter(([, v]) => v && (v.amount || v.hours))
          .map(([c]) => c),
        ...Object.entries(r.staff.extIds ?? {})
          .filter(([, v]) => v)
          .map(([c]) => c),
      ]),
    ),
  ].sort();
  const nx = extraCodes.length;

  // column numbers (A is an empty margin column, like the original)
  const idCol = (k: number) => 4 + k;
  const base = 4 + nx; // first column after the ID columns
  const C = {
    rssId: 2,
    essId: 3,
    ni: base,
    tag: base + 1,
    name: base + 2,
    rssAmt: base + 3,
    rssHrs: base + 4,
    essAmt: base + 5,
    essHrs: base + 6,
    carry: base + 7 + nx * 2,
    totHrs: base + 8 + nx * 2,
    totAmt: base + 9 + nx * 2,
    check: base + 10 + nx * 2,
  };
  const xAmt = (k: number) => base + 7 + k * 2;
  const xHrs = (k: number) => base + 8 + k * 2;
  const firstPay = C.check + 1;
  const lastPay = firstPay + payrollCols.length - 1;
  const tax = lastPay + 1;
  const totPayroll = tax + 1;
  const p1 = totPayroll + 1;
  const totCash = p1 + nPay;
  const deduction = totCash + 1;
  const outstanding = deduction + 1;
  const account = outstanding + 1;
  const status = account + 1;
  const flag = status + 1;
  const area = flag + 1;

  const groups: [number, string][] = [
    [C.rssId, "Profile of Staff"],
    [C.rssAmt, "RSS Data"],
    [C.essAmt, "ESS Data"],
    ...extraCodes.map((code, k): [number, string] => [xAmt(k), `${code} Data`]),
    [C.carry, "Payable"],
    [C.check, "Check status"],
    [firstPay, "Payroll data"],
    [p1, "Payment Data"],
  ];
  groups.forEach(([c, t]) => (ws.getCell(2, c).value = t));

  const headers: [number, string][] = [
    [C.rssId, "RSS ID"],
    [C.essId, "ESS ID"],
    [C.ni, "NI"],
    [C.tag, "Tag"],
    [C.name, "Name"],
    [C.rssAmt, "Amount"],
    [C.rssHrs, "Hours"],
    [C.essAmt, "Amount"],
    [C.essHrs, "Hours"],
    ...extraCodes.flatMap((code, k): [number, string][] => [
      [idCol(k), `${code} ID`],
      [xAmt(k), "Amount"],
      [xHrs(k), "Hours"],
    ]),
    [C.carry, "-OverPaid/+Remaining"],
    [C.totHrs, "Total Hours"],
    [C.totAmt, "Total Amount"],
    [C.check, "Check status"],
    ...payrollCols.map((p, i): [number, string] => [firstPay + i, p.name]),
    [tax, "Tax Deduction"],
    [totPayroll, "Total Payroll"],
    ...Array.from({ length: nPay }, (_, i): [number, string] => [p1 + i, `P${i + 1}`]),
    [totCash, "Total Cash Paid"],
    [deduction, "Deduction"],
    [outstanding, "Outstanding"],
    [account, "Account Detail"],
    [status, "Pay status"],
    [flag, "Client"],
    [area, "area"],
  ];
  headers.forEach(([c, t]) => (ws.getCell(3, c).value = t));
  for (const r of [2, 3]) {
    const row = ws.getRow(r);
    row.font = { bold: true };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: r === 2 ? "FFE8EEF7" : "FFF1F3F6" },
      };
      cell.border = { bottom: { style: "thin", color: { argb: "FFB8C0CC" } } };
    });
  }

  const money = "#,##0.00;[Red]-#,##0.00";
  const first = 4;
  rows.forEach((r, i) => {
    const n = first + i;
    const e = r.entry;
    const L = (c: number) => `${col(c)}${n}`;
    const set = (c: number, v: ExcelJSValue) => (ws.getCell(n, c).value = v);

    set(C.rssId, r.staff.rssId ? Number(r.staff.rssId) || r.staff.rssId : null);
    set(C.essId, r.staff.essId ? Number(r.staff.essId) || r.staff.essId : null);
    set(C.ni, r.staff.ni);
    set(C.tag, r.staff.tag);
    set(C.name, r.staff.name);
    set(C.rssAmt, e.rssAmount);
    set(C.rssHrs, e.rssHours);
    set(C.essAmt, e.essAmount);
    set(C.essHrs, e.essHours);
    extraCodes.forEach((code, k) => {
      const id = r.staff.extIds?.[code];
      set(idCol(k), id ? Number(id) || id : null);
      set(xAmt(k), e.extra?.[code]?.amount || null);
      set(xHrs(k), e.extra?.[code]?.hours || null);
    });
    set(C.carry, e.carryForward);
    set(C.totHrs, {
      formula: [C.essHrs, C.rssHrs, ...extraCodes.map((_, k) => xHrs(k))].map(L).join("+"),
      result: r.computed.totalHours,
    });
    set(C.totAmt, {
      formula: `${[C.essAmt, C.rssAmt, ...extraCodes.map((_, k) => xAmt(k))].map(L).join("+")}+${L(C.carry)}`,
      result: r.computed.totalAmount,
    });
    set(C.check, e.checkStatus || null);

    let other = 0;
    for (const [id, v] of Object.entries(e.payroll)) if (!known.has(id)) other += v;
    payrollCols.forEach((p, k) => {
      const v = p.id ? (e.payroll[p.id] ?? 0) : other;
      set(firstPay + k, v || null);
    });
    set(tax, e.taxDeduction || null);
    set(totPayroll, {
      formula: `SUM(${L(firstPay)}:${L(lastPay)})-${L(tax)}`,
      result: r.computed.payrollTotal,
    });
    for (let k = 0; k < nPay; k++) set(p1 + k, r.payments[k]?.amount ?? null);
    set(totCash, { formula: `SUM(${L(p1)}:${L(p1 + nPay - 1)})`, result: r.computed.cashPaid });
    set(deduction, e.deduction || null);
    set(outstanding, {
      formula: `ROUND(${L(C.totAmt)}-${L(totPayroll)}-${L(totCash)}-${L(deduction)},2)`,
      result: r.computed.outstanding,
    });
    set(account, r.staff.accountDetail);
    const o = L(outstanding);
    set(status, {
      formula: `IF(${o}>0,"Current",IF(${o}<0,"OverPaid","Paid in Full"))`,
      result: r.computed.payStatus,
    });
    set(flag, e.flag || null);
    set(area, r.staff.area);
  });

  // totals row
  const last = first + rows.length - 1;
  const tr = last + 2;
  const totals = sumRows(rows);
  ws.getCell(tr, C.name).value = "TOTAL";
  const sumCell = (c: number, result: number) => {
    ws.getCell(tr, c).value = rows.length
      ? { formula: `SUM(${col(c)}${first}:${col(c)}${last})`, result }
      : 0;
  };
  sumCell(C.rssAmt, totals.rssAmount);
  sumCell(C.rssHrs, totals.rssHours);
  sumCell(C.essAmt, totals.essAmount);
  sumCell(C.essHrs, totals.essHours);
  extraCodes.forEach((code, k) => {
    sumCell(xAmt(k), totals.byShift[code]?.amount ?? 0);
    sumCell(xHrs(k), totals.byShift[code]?.hours ?? 0);
  });
  sumCell(C.carry, totals.carryForward);
  sumCell(C.totHrs, totals.totalHours);
  sumCell(C.totAmt, totals.totalAmount);
  payrollCols.forEach((p, k) => {
    const res = p.id
      ? (totals.byCompany[p.id] ?? 0)
      : Object.entries(totals.byCompany).reduce((s, [id, v]) => (known.has(id) ? s : s + v), 0);
    sumCell(firstPay + k, round2(res));
  });
  sumCell(tax, totals.taxDeduction);
  sumCell(totPayroll, totals.payrollTotal);
  for (let k = 0; k < nPay; k++) {
    sumCell(p1 + k, round2(rows.reduce((s, r) => s + (r.payments[k]?.amount ?? 0), 0)));
  }
  sumCell(totCash, totals.cashPaid);
  sumCell(deduction, totals.deduction);
  sumCell(outstanding, totals.outstanding);
  ws.getRow(tr).font = { bold: true };
  ws.getRow(tr).eachCell((cell) => {
    cell.border = { top: { style: "thin", color: { argb: "FF6B7280" } } };
  });

  // formats + widths
  const moneyCols = [
    C.rssAmt,
    C.essAmt,
    ...extraCodes.map((_, k) => xAmt(k)),
    C.carry,
    C.totAmt,
    ...payrollCols.map((_, i) => firstPay + i),
    tax,
    totPayroll,
    ...Array.from({ length: nPay }, (_, i) => p1 + i),
    totCash,
    deduction,
    outstanding,
  ];
  for (const c of moneyCols) ws.getColumn(c).numFmt = money;
  for (const c of [C.rssHrs, C.essHrs, C.totHrs, ...extraCodes.map((_, k) => xHrs(k))]) ws.getColumn(c).numFmt = "#,##0.00";
  ws.getColumn(1).width = 2;
  ws.getColumn(C.ni).width = 15;
  ws.getColumn(C.tag).width = 14;
  ws.getColumn(C.name).width = 28;
  ws.getColumn(account).width = 36;
  ws.getColumn(flag).width = 14;
  ws.getColumn(area).width = 16;
  ws.getColumn(status).width = 14;
  ws.getColumn(C.check).width = 12;
  for (const c of moneyCols) ws.getColumn(c).width = Math.max(ws.getColumn(c).width ?? 0, 13);
  ws.getRow(3).height = 32;
  ws.autoFilter = { from: { row: 3, column: 2 }, to: { row: 3, column: area } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Salary Sheet ${formatMonthLabel(month)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type ExcelJSValue = string | number | null | { formula: string; result: string | number };
