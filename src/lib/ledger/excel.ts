/** Client-side Excel (.xlsx) export helper used by the list views. */

export type ExcelCell = string | number | null | undefined;

export interface ExcelColumn {
  header: string;
  /** Column width in characters. */
  width?: number;
  /** Right-align + 2-decimal number format (for money columns). */
  money?: boolean;
}

/** Stops spreadsheet apps treating text starting with = + - @ as a formula. */
function safeText(v: string): string {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

export async function downloadXlsx(
  filename: string,
  sheetName: string,
  columns: ExcelColumn[],
  rows: ExcelCell[][],
): Promise<void> {
  if (typeof window === "undefined") return;
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));

  ws.columns = columns.map((c) => ({ header: c.header, width: c.width ?? 16 }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle" };
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF3" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF9AA5B1" } } };
  });

  for (const r of rows) {
    ws.addRow(r.map((v) => (typeof v === "string" ? safeText(v) : (v ?? ""))));
  }
  columns.forEach((c, i) => {
    if (!c.money) return;
    const col = ws.getColumn(i + 1);
    col.numFmt = "#,##0.00";
    col.alignment = { horizontal: "right" };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
