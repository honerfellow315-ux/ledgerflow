/**
 * Excel export of one salary month in the same column layout as the original
 * "Salary Sheet" workbook, with live formulas (and cached values so it also
 * reads correctly in viewers that don't recalculate).
 */
import {
  EXPENSES_EFFECT,
  expensesTotal,
  formatMonthLabel,
  round2,
  sumRows,
  type SheetRow,
} from "./calc";
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
    // Expenses sit right after the carry-forward column and feed Total Amount.
    exp: base + 8 + nx * 2,
    totHrs: base + 9 + nx * 2,
    totAmt: base + 10 + nx * 2,
    check: base + 11 + nx * 2,
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
  // Bank details (only filled for users who may see Staff details), kept as text.
  const holder = area + 1;
  const accNo = area + 2;
  const sortCodeCol = area + 3;
  // Free-text descriptions of the expenses ("Taxi: 12.5 | Parking: 4"), so the file can be re-imported.
  const expNote = area + 4;

  const groups: [number, string][] = [
    [C.rssId, "Profile of Staff"],
    [C.rssAmt, "RSS Data"],
    [C.essAmt, "ESS Data"],
    ...extraCodes.map((code, k): [number, string] => [xAmt(k), `${code} Data`]),
    [C.carry, "Payable"],
    [C.check, "Check status"],
    [firstPay, "Payroll data"],
    [p1, "Payment Data"],
    [holder, "Bank details"],
    [expNote, "Expenses"],
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
    [C.exp, "Expenses"],
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
    [holder, "Account Holder Name"],
    [accNo, "Account Number"],
    [sortCodeCol, "Sort Code"],
    [expNote, "Expenses Note"],
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
    set(C.exp, expensesTotal(e) || null);
    set(C.totHrs, {
      formula: [C.essHrs, C.rssHrs, ...extraCodes.map((_, k) => xHrs(k))].map(L).join("+"),
      result: r.computed.totalHours,
    });
    set(C.totAmt, {
      formula: `${[C.essAmt, C.rssAmt, ...extraCodes.map((_, k) => xAmt(k))].map(L).join("+")}+${L(C.carry)}${
        EXPENSES_EFFECT === "add"
          ? `+${L(C.exp)}`
          : EXPENSES_EFFECT === "subtract"
            ? `-${L(C.exp)}`
            : ""
      }`,
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
    // Old free-text detail first; otherwise build it from the structured bank fields.
    const bank = [r.staff.accountHolderName, r.staff.accountNumber, r.staff.sortCode]
      .map((v) => (v ?? "").trim())
      .filter(Boolean);
    set(account, r.staff.accountDetail || (bank.length ? bank.join(" | ") : null));
    const o = L(outstanding);
    set(status, {
      formula: `IF(${o}>0,"Current",IF(${o}<0,"OverPaid","Paid in Full"))`,
      result: r.computed.payStatus,
    });
    set(flag, e.flag || null);
    set(area, r.staff.area);
    set(holder, r.staff.accountHolderName || null);
    set(accNo, r.staff.accountNumber || null);
    set(sortCodeCol, r.staff.sortCode || null);
    set(
      expNote,
      (e.expenses ?? [])
        .filter((x) => x.amount || x.note)
        .map((x) => (x.note ? `${x.note}: ${x.amount}` : String(x.amount)))
        .join(" | ") || null,
    );
    ws.getCell(n, accNo).numFmt = "@";
    ws.getCell(n, sortCodeCol).numFmt = "@";
  });

  // formats + widths
  const moneyCols = [
    C.rssAmt,
    C.essAmt,
    ...extraCodes.map((_, k) => xAmt(k)),
    C.carry,
    C.exp,
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

  // Totals row: ONE rule for every column, the same as the dashboard: SUMIF(range, ">0").
  // A new column only needs adding to totalCols.
  const last = first + rows.length - 1;
  const tr = last + 2;
  ws.getCell(tr, C.name).value = "TOTAL (SUMIF > 0)";
  const cellNum = (r: number, c: number): number => {
    const v = ws.getCell(r, c).value as unknown;
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && "result" in v)
      return Number((v as { result?: unknown }).result) || 0;
    return 0;
  };
  const totalCols = [
    C.rssAmt,
    C.rssHrs,
    C.essAmt,
    C.essHrs,
    ...extraCodes.flatMap((_, k) => [xAmt(k), xHrs(k)]),
    C.carry,
    C.exp,
    C.totHrs,
    ...moneyCols.filter((c) => c !== C.rssAmt && c !== C.essAmt && c !== C.carry && c !== C.exp),
  ];
  for (const c of new Set(totalCols)) {
    let res = 0;
    for (let r = first; r <= last; r++) {
      const v = cellNum(r, c);
      if (v > 0) res += v;
    }
    ws.getCell(tr, c).value = rows.length
      ? { formula: `SUMIF(${col(c)}${first}:${col(c)}${last},">0")`, result: round2(res) }
      : 0;
  }
  ws.getRow(tr).font = { bold: true };
  ws.getRow(tr).eachCell((cell) => {
    cell.border = { top: { style: "thin", color: { argb: "FF6B7280" } } };
  });
  // Definition of the calculation, as a footnote under the totals.
  const noteRow = tr + 2;
  ws.getCell(noteRow, C.name).value =
    'Totals: SUMIF(column range, ">0") — the sum of positive line amounts only. Overpaid (negative) lines are not netted off.';
  ws.getCell(noteRow + 1, C.name).value =
    "Outstanding (per line) = Total Amount − Total Payroll − Total Cash Paid − Deduction.";
  for (const nr of [noteRow, noteRow + 1]) {
    ws.getCell(nr, C.name).font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
  }

  for (const c of [C.rssHrs, C.essHrs, C.totHrs, ...extraCodes.map((_, k) => xHrs(k))])
    ws.getColumn(c).numFmt = "#,##0.00";
  ws.getColumn(1).width = 2;
  ws.getColumn(C.ni).width = 15;
  ws.getColumn(C.tag).width = 14;
  ws.getColumn(C.name).width = 28;
  ws.getColumn(account).width = 36;
  ws.getColumn(flag).width = 14;
  ws.getColumn(area).width = 16;
  ws.getColumn(holder).width = 26;
  ws.getColumn(accNo).width = 16;
  ws.getColumn(sortCodeCol).width = 12;
  ws.getColumn(expNote).width = 34;
  ws.getColumn(status).width = 14;
  ws.getColumn(C.check).width = 12;
  for (const c of moneyCols) ws.getColumn(c).width = Math.max(ws.getColumn(c).width ?? 0, 13);
  ws.getRow(3).height = 32;
  ws.autoFilter = { from: { row: 3, column: 2 }, to: { row: 3, column: expNote } };

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
