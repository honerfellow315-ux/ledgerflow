/**
 * Timesheet Check — Phase A (UI only).
 * Everything here is demo data with fictional people. Phase B replaces
 * MOCK_SHEETS with real data; the types and helpers stay.
 */
export type SheetFormat = "excel" | "pdf" | "photo";
export type SheetStatus = "ready" | "needs_review" | "staff_not_found";
export type RowResult =
  | "match"
  | "hours_over"
  | "hours_under"
  | "not_in_records"
  | "not_on_sheet"
  | "check_reading";

export interface SheetRow {
  id: string;
  date: string; // yyyy-mm-dd
  site: string;
  start: string;
  end: string;
  sheetHours: number;
  recordHours: number | null;
  rate: number;
  result: RowResult;
  note?: string;
}

export interface TimesheetSheet {
  id: string;
  staffName: string;
  email: string;
  ni: string;
  matchedBy: "ni" | "name" | "none";
  fileName: string;
  format: SheetFormat;
  uploadedAt: string;
  monthLabel: string;
  /** The total the sheet itself claims. */
  statedHours: number;
  status: SheetStatus;
  readNote?: string;
  rows: SheetRow[];
}

export const FORMAT_LABEL: Record<SheetFormat, string> = {
  excel: "Excel",
  pdf: "PDF",
  photo: "Photo",
};

const round = (n: number) => Math.round(n * 100) / 100;

export function sheetTotals(s: TimesheetSheet) {
  const sheetHours = round(s.rows.reduce((a, r) => a + r.sheetHours, 0));
  const recordHours = round(s.rows.reduce((a, r) => a + (r.recordHours ?? 0), 0));
  return {
    sheetHours,
    recordHours,
    diff: round(sheetHours - recordHours),
    issues: s.rows.filter((r) => r.result !== "match").length,
    statedMismatch: Math.abs(s.statedHours - sheetHours) > 0.001,
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

const r = (
  id: string,
  date: string,
  site: string,
  start: string,
  end: string,
  sheetHours: number,
  recordHours: number | null,
  rate: number,
  result: RowResult,
  note?: string,
): SheetRow => ({ id, date, site, start, end, sheetHours, recordHours, rate, result, note });

const M = "September 2026";

export const MOCK_SHEETS: TimesheetSheet[] = [
  {
    id: "ts-1",
    staffName: "Daniel Okafor",
    email: "daniel.okafor@example.com",
    ni: "QQ123456A",
    matchedBy: "ni",
    fileName: "Okafor_Sept_Timesheet.xlsx",
    format: "excel",
    uploadedAt: "2026-10-02T09:14:00",
    monthLabel: M,
    statedHours: 138,
    status: "needs_review",
    rows: [
      r("a1", "2026-09-01", "Northgate Retail Park", "07:00", "19:00", 12, 12, 10.5, "match"),
      r("a2", "2026-09-02", "Northgate Retail Park", "07:00", "19:00", 12, 12, 10.5, "match"),
      r("a3", "2026-09-04", "Canal Street Depot", "18:00", "06:00", 12, 12, 10.5, "match"),
      r("a4", "2026-09-05", "Canal Street Depot", "18:00", "08:00", 14, 12, 10.5, "hours_over", "Sheet ends 08:00, our record ends 06:00."),
      r("a5", "2026-09-08", "Riverside Offices", "08:45", "17:15", 8.5, 8.5, 10.5, "match"),
      r("a6", "2026-09-09", "Riverside Offices", "08:45", "17:15", 8.5, 8.5, 10.5, "match"),
      r("a7", "2026-09-11", "Riverside Offices", "08:45", "17:15", 8.5, 8.5, 10.5, "match"),
      r("a8", "2026-09-12", "Harbour Warehouse", "22:00", "06:00", 8, 8, 10.5, "match"),
      r("a9", "2026-09-15", "Harbour Warehouse", "22:00", "06:00", 8, 8, 10.5, "match"),
      r("a10", "2026-09-18", "Riverside Offices", "08:45", "17:15", 8.5, 8.5, 10.5, "match"),
      r("a11", "2026-09-20", "Canal Street Depot", "07:00", "17:00", 10, null, 10.5, "not_in_records", "No shift on this date in our records."),
      r("a12", "2026-09-22", "Harbour Warehouse", "22:00", "06:00", 8, 8, 10.5, "match"),
      r("a13", "2026-09-26", "Northgate Retail Park", "07:00", "19:00", 12, 12, 10.5, "match"),
      r("a14", "2026-09-29", "Riverside Offices", "—", "—", 0, 8.5, 10.5, "not_on_sheet", "Worked per our records, but not listed on the sheet."),
    ],
  },
  {
    id: "ts-2",
    staffName: "Priya Nair",
    email: "priya.nair@example.com",
    ni: "QQ234567B",
    matchedBy: "ni",
    fileName: "Nair_Timesheet_Sept.pdf",
    format: "pdf",
    uploadedAt: "2026-10-02T10:41:00",
    monthLabel: M,
    statedHours: 56,
    status: "ready",
    rows: [
      r("b1", "2026-09-03", "Marsh Lane Store", "09:00", "17:00", 8, 8, 10, "match"),
      r("b2", "2026-09-04", "Marsh Lane Store", "09:00", "17:00", 8, 8, 10, "match"),
      r("b3", "2026-09-10", "Marsh Lane Store", "09:00", "17:00", 8, 8, 10, "match"),
      r("b4", "2026-09-11", "Marsh Lane Store", "09:00", "17:00", 8, 8, 10, "match"),
      r("b5", "2026-09-17", "Marsh Lane Store", "09:00", "21:00", 12, 12, 10, "match"),
      r("b6", "2026-09-24", "Marsh Lane Store", "09:00", "21:00", 12, 12, 10, "match"),
    ],
  },
  {
    id: "ts-3",
    staffName: "Marcus Bell",
    email: "marcus.bell@example.com",
    ni: "QQ345678C",
    matchedBy: "name",
    fileName: "IMG_4471.jpg",
    format: "photo",
    uploadedAt: "2026-10-03T08:05:00",
    monthLabel: M,
    statedHours: 84,
    status: "needs_review",
    readNote: "Handwritten photo, read by AI. Compare every figure with the picture before confirming.",
    rows: [
      r("c1", "2026-09-01", "Orchard Centre", "06:00", "18:00", 12, 12, 10.5, "match"),
      r("c2", "2026-09-02", "Orchard Centre", "06:00", "18:00", 12, 12, 10.5, "match"),
      r("c3", "2026-09-06", "Quay Retail", "14:00", "20:00", 6, 6, 10, "check_reading", "Start time is hard to read."),
      r("c4", "2026-09-09", "Quay Retail", "08:00", "20:00", 12, 12, 10, "match"),
      r("c5", "2026-09-13", "Orchard Centre", "18:00", "06:00", 12, 12, 10.5, "match"),
      r("c6", "2026-09-14", "Orchard Centre", "10:00", "20:00", 10, 9.5, 10.5, "hours_over", "Sheet is 30 minutes higher."),
      r("c7", "2026-09-19", "Quay Retail", "07:00", "15:00", 8, 8, 10, "check_reading", "Handwriting unclear: 8 or 9 hours?"),
      r("c8", "2026-09-27", "Orchard Centre", "06:00", "18:00", 12, null, 10.5, "not_in_records", "No shift on this date in our records."),
    ],
  },
  {
    id: "ts-4",
    staffName: "N. Hughes",
    email: "",
    ni: "",
    matchedBy: "none",
    fileName: "hughes_hours.xlsx",
    format: "excel",
    uploadedAt: "2026-10-03T13:22:00",
    monthLabel: M,
    statedHours: 40,
    status: "staff_not_found",
    rows: [
      r("d1", "2026-09-05", "Station Yard", "08:00", "18:00", 10, null, 10, "not_in_records", "Staff member not found."),
      r("d2", "2026-09-12", "Station Yard", "08:00", "18:00", 10, null, 10, "not_in_records", "Staff member not found."),
      r("d3", "2026-09-19", "Station Yard", "08:00", "18:00", 10, null, 10, "not_in_records", "Staff member not found."),
      r("d4", "2026-09-26", "Station Yard", "08:00", "18:00", 10, null, 10, "not_in_records", "Staff member not found."),
    ],
  },
  {
    id: "ts-5",
    staffName: "Hannah Clarke",
    email: "hannah.clarke@example.com",
    ni: "QQ456789D",
    matchedBy: "ni",
    fileName: "Clarke_Sept.xlsx",
    format: "excel",
    uploadedAt: "2026-10-01T16:30:00",
    monthLabel: M,
    statedHours: 40,
    status: "ready",
    rows: [
      r("e1", "2026-09-07", "Mill Road Depot", "08:00", "16:00", 8, 8, 10.5, "match"),
      r("e2", "2026-09-08", "Mill Road Depot", "08:00", "16:00", 8, 8, 10.5, "match"),
      r("e3", "2026-09-14", "Mill Road Depot", "08:00", "16:00", 8, 8, 10.5, "match"),
      r("e4", "2026-09-15", "Mill Road Depot", "08:00", "16:00", 8, 8, 10.5, "match"),
      r("e5", "2026-09-21", "Mill Road Depot", "08:00", "16:00", 8, 8, 10.5, "match"),
    ],
  },
  {
    id: "ts-6",
    staffName: "Tom Reilly",
    email: "tom.reilly@example.com",
    ni: "QQ567890A",
    matchedBy: "ni",
    fileName: "Reilly_September.xlsx",
    format: "excel",
    uploadedAt: "2026-10-01T11:08:00",
    monthLabel: M,
    statedHours: 66,
    status: "needs_review",
    rows: [
      r("f1", "2026-09-02", "Docklands Site", "07:00", "19:00", 12, 12, 10.5, "match"),
      r("f2", "2026-09-03", "Docklands Site", "07:00", "19:00", 12, 12, 10.5, "match"),
      r("f3", "2026-09-09", "Docklands Site", "07:00", "19:00", 12, 10, 10.5, "hours_over", "Our record shows a 2 hour shorter shift."),
      r("f4", "2026-09-16", "Docklands Site", "08:00", "18:00", 10, 10, 10.5, "match"),
      r("f5", "2026-09-23", "Docklands Site", "07:00", "19:00", 12, 12, 10.5, "match"),
      r("f6", "2026-09-30", "Docklands Site", "09:00", "17:00", 8, 6.5, 10.5, "hours_over", "Our record shows 6.5 hours."),
    ],
  },
];