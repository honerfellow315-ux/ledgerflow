/** Client-side CSV export helper used by the list views. */

/** Plain signed amounts such as "-12.50", "-£1,200.00" or "+5%" stay as they
 * are, so exported money columns read exactly as before. */
const SIGNED_NUMBER = /^[+-]\s*[£$€]?\s*\d[\d.,]*\s*%?$/;

/**
 * Stops spreadsheet apps running text that starts with = + - @ (or a tab /
 * carriage return) as a formula, e.g. a client named `=HYPERLINK(...)`.
 * Real numbers are never touched, and neither are plain signed amounts.
 */
export function neutralizeFormula(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const text = String(value);
  const risky = /^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !SIGNED_NUMBER.test(text));
  return risky ? `'${text}` : text;
}

function escapeCell(value: unknown): string {
  const text = neutralizeFormula(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
): void {
  if (typeof window === "undefined") return;
  const blob = new Blob(["\uFEFF" + toCsv(headers, rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
