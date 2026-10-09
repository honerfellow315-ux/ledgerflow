/**
 * Statement of account as an Excel (.xlsx) file.
 * Used by the Statements page ("Export Excel"). Rebuilt from how that page calls it.
 */
import { formatDate } from "./calc";

export interface StatementXlsxInput {
  filename: string;
  business: {
    name: string | undefined;
    address: string | undefined;
    email: string | undefined;
    phone: string | undefined;
    vatNumber: string | undefined;
    companyNumber: string | undefined;
  };
  client: {
    company: string;
    name: string;
    address: string;
    vatNumber: string;
    accountReference: string;
  };
  endClientLabel?: string | undefined;
  periodLabel?: string | undefined;
  statementDate: string;
  outstandingTotals: { total: number; overdue: number; due: number };
  outstandingInvoices: {
    invoiceDate: string;
    number: string;
    outstanding: number;
    dueDate: string;
    status: "Due" | "Overdue";
    ageing: number | null;
    description: string;
    poReference: string;
    note: string;
  }[];
  openingBalance?: number | undefined;
  ledger: {
    date: string;
    type: string;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  summary: { invoiced: number; paid: number; creditNotesNet: number; balanceDue: number };
}

/** Stops spreadsheet apps treating text starting with = + - @ as a formula. */
const safe = (v: string | undefined): string => {
  const t = v ?? "";
  return /^[=+\-@]/.test(t) ? `'${t}` : t;
};

const MONEY = "#,##0.00";

export async function downloadStatementXlsx(input: StatementXlsxInput): Promise<void> {
  if (typeof window === "undefined") return;
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Statement");
  ws.columns = [
    { width: 14 },
    { width: 18 },
    { width: 14 },
    { width: 46 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 38 },
  ];

  const head = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE8EDF3" } };
  const headerRow = (labels: string[]) => {
    const row = ws.addRow(labels);
    row.font = { bold: true };
    row.eachCell((c) => {
      c.fill = head;
      c.border = { bottom: { style: "thin", color: { argb: "FF9AA5B1" } } };
    });
  };
  const money = (cell: { numFmt?: string; alignment?: unknown }) => {
    cell.numFmt = MONEY;
    cell.alignment = { horizontal: "right" };
  };
  const section = (title: string) => {
    ws.addRow([]);
    const r = ws.addRow([title]);
    r.font = { bold: true, size: 12 };
  };

  // Business
  const b = input.business;
  ws.addRow([safe(b.name)]).font = { bold: true, size: 14 };
  for (const line of [
    b.address,
    b.email,
    b.phone,
    b.vatNumber ? `VAT no: ${b.vatNumber}` : "",
    b.companyNumber ? `Company no: ${b.companyNumber}` : "",
  ]) {
    if (line) ws.addRow([safe(line)]);
  }

  // Title and account
  section("STATEMENT OF ACCOUNT");
  ws.addRow(["Statement date", formatDate(input.statementDate)]);
  if (input.periodLabel) ws.addRow(["Period", input.periodLabel]);
  const c = input.client;
  ws.addRow(["Client", safe(c.company)]);
  if (c.name) ws.addRow(["Contact", safe(c.name)]);
  if (c.address) ws.addRow(["Address", safe(c.address)]);
  if (c.vatNumber) ws.addRow(["VAT number", safe(c.vatNumber)]);
  if (c.accountReference) ws.addRow(["Account ref", safe(c.accountReference)]);
  if (input.endClientLabel) ws.addRow(["End client", safe(input.endClientLabel)]);

  // Summary
  section("Summary");
  const s = input.summary;
  for (const [label, value] of [
    ["Invoiced", s.invoiced],
    ["Paid", s.paid],
    ["Credit notes (net)", s.creditNotesNet],
    ["Balance due", s.balanceDue],
  ] as const) {
    const row = ws.addRow([label, "", value]);
    ws.mergeCells(row.number, 1, row.number, 2);
    money(row.getCell(3));
    if (label === "Balance due") row.font = { bold: true };
  }

  // Outstanding invoices
  if (input.outstandingInvoices.length > 0) {
    section("Outstanding invoices");
    headerRow(["Invoice date", "Invoice", "Status", "Description", "Due date", "Days overdue", "PO reference", "Outstanding", "Note"]);
    for (const o of input.outstandingInvoices) {
      const row = ws.addRow([
        formatDate(o.invoiceDate),
        safe(o.number),
        o.status,
        safe(o.description),
        formatDate(o.dueDate),
        o.ageing ?? "",
        safe(o.poReference),
        o.outstanding,
        safe(o.note),
      ]);
      money(row.getCell(8));
    }
    const t = input.outstandingTotals;
    for (const [label, value] of [
      ["Total outstanding", t.total],
      ["Overdue", t.overdue],
      ["Due", t.due],
    ] as const) {
      const row = ws.addRow(["", "", "", "", "", "", label, value]);
      row.font = { bold: label === "Total outstanding" };
      money(row.getCell(8));
    }
  }

  // Account activity
  section("Account activity");
  headerRow(["Date", "Reference", "Type", "Description", "", "Debit", "Credit", "Balance"]);
  if (input.openingBalance !== undefined) {
    const row = ws.addRow(["", "", "", "Opening balance (balance brought forward)", "", "", "", input.openingBalance]);
    row.font = { italic: true };
    money(row.getCell(8));
  }
  for (const l of input.ledger) {
    const row = ws.addRow([
      formatDate(l.date),
      safe(l.reference),
      l.type,
      safe(l.description),
      "",
      l.debit || "",
      l.credit || "",
      l.balance,
    ]);
    for (const col of [6, 7, 8]) money(row.getCell(col));
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = input.filename.endsWith(".xlsx") ? input.filename : `${input.filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}