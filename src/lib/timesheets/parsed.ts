/**
 * What a timesheet reader hands over, whatever the file type. The Excel / CSV reader
 * (Phase B) produces it today; the PDF / Word reader (Phase C) and the photo reader
 * (Phase D) only have to produce the same shape, so nothing else changes.
 */
import type { SheetFormat } from "./data";

export interface ParsedRow {
  /** yyyy-mm-dd, or "" when the date could not be read. */
  date: string;
  site: string;
  /** The second site column of the template, when it differs. */
  siteAlt: string;
  /** hh:mm or "". */
  start: string;
  end: string;
  /** null = the hours could not be read (never turned into 0). */
  hours: number | null;
  rate: number | null;
  amount: number | null;
  expense: number | null;
  /** The sheet contradicts itself or a cell was unreadable: never shown as a clean match. */
  uncertain: boolean;
  note: string;
}

export interface ParsedSheet {
  format: SheetFormat;
  /** Worksheet name when the file has several, otherwise "". */
  sheetLabel: string;
  personName: string;
  personNi: string;
  /** ISO date of birth, or empty when the source does not provide one. */
  personDob?: string;
  /** The total the sheet states for itself, or null when it has none. */
  statedHours: number | null;
  rows: ParsedRow[];
  warnings: string[];
}

export interface ParsedFile {
  fileName: string;
  /** SHA-256 of the file content (hex), used to catch the same file uploaded twice. */
  fileHash: string;
  sheets: ParsedSheet[];
  /** Why nothing (or only part) of the file could be used, in plain words. */
  problems: string[];
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS_PER_SHEET = 400;
export const MAX_SHEETS_PER_FILE = 40;
