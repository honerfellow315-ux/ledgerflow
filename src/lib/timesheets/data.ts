/**
 * Timesheet Check — Phase A (UI only).
 * Types and helpers for the screens (Phase B: the real data comes from the server).
 * The sample data of Phase A has been removed.
 */
export type SheetFormat = "excel" | "pdf" | "word" | "photo";
export type SheetStatus = "ready" | "needs_review" | "staff_not_found";
export type RowResult =
  "match" | "hours_over" | "hours_under" | "not_in_records" | "not_on_sheet" | "check_reading";

export interface SheetRow {
  id: string;
  date: string; // yyyy-mm-dd
  site: string;
  start: string;
  end: string;
  sheetHours: number;
  recordHours: number | null;
  rate: number;
  /** Rate used for pay (our record's rate), hours paid and the amount. null = not calculated yet. */
  payRate?: number | null;
  payHours?: number | null;
  payAmount?: number | null;
  result: RowResult;
  note?: string;
  /** A person edited this row by hand (hours and rate). The same figures were written to the Salary Sheet. */
  edited?: { hours: number; rate: number; note: string; by: string; at: string };
  /** An approver accepted this difference; actualHours = the hours they said were worked. */
  accepted?: { note: string; by: string; at: string; actualHours?: number | null };
}

export interface TimesheetSheet {
  id: string;
  staffName: string;
  sourceName?: string;
  sourceNi?: string;
  sourceDob?: string;
  email: string;
  ni: string;
  matchedBy: "ni" | "name" | "none";
  fileName: string;
  format: SheetFormat;
  uploadedAt: string;
  monthLabel: string;
  month?: string;
  /** The total the sheet itself claims. */
  statedHours: number;
  status: SheetStatus;
  readNote?: string;
  /** A person confirmed a name-only match. */
  staffConfirmed?: boolean;
  /** The month is locked (nothing can be accepted or changed). */
  monthLocked?: boolean;
  /** An approver accepted that the sheet's own total differs from its rows. */
  statedAccepted?: { note: string; by: string; at: string };
  rows: SheetRow[];
}

export const FORMAT_LABEL: Record<SheetFormat, string> = {
  excel: "Excel",
  pdf: "PDF",
  word: "Word",
  photo: "Photo",
};

const round = (n: number) => Math.round(n * 100) / 100;

export function sheetTotals(s: TimesheetSheet) {
  const sheetHours = round(s.rows.reduce((a, r) => a + r.sheetHours, 0));
  const recordHours = round(s.rows.reduce((a, r) => a + (r.recordHours ?? 0), 0));
  // An accepted difference is settled: it no longer counts in the difference.
  const settled = s.rows
    .filter((r) => r.accepted || r.edited)
    .reduce((a, r) => a + (r.sheetHours - (r.recordHours ?? 0)), 0);
  const payHours = round(s.rows.reduce((a, r) => a + (r.payHours ?? 0), 0));
  const payAmount = round(s.rows.reduce((a, r) => a + (r.payAmount ?? 0), 0));
  return {
    sheetHours,
    recordHours,
    diff: round(sheetHours - recordHours - settled),
    payHours,
    payAmount,
    payCalculated: s.rows.every((r) => r.payAmount !== null && r.payAmount !== undefined),
    issues: s.rows.filter((r) => r.result !== "match" && !r.accepted && !r.edited).length,
    statedMismatch: Math.abs(s.statedHours - sheetHours) > 0.001 && !s.statedAccepted,
  };
}

export const fmtHours = (n: number) => `${Number(n.toFixed(2))} h`;
export const fmtDiff = (n: number) =>
  n === 0 ? "0 h" : `${n > 0 ? "+" : ""}${Number(n.toFixed(2))} h`;

/** NI numbers are sensitive: show only the edges. */
export function maskNi(ni: string): string {
  const v = ni.replace(/\s+/g, "").toUpperCase();
  if (v.length < 9) return "—";
  return `${v.slice(0, 2)} ${v.slice(2, 4)}** **${v.slice(-1)}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
