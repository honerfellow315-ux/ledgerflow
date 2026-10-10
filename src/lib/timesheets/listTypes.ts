/** What the Timesheet Check list screen gets from the server (no shift rows, just totals). */
import type { SheetFormat, SheetStatus } from "./data";

export interface SheetListItem {
  id: string;
  staffName: string;
  ni: string;
  matchedBy: "ni" | "name" | "none";
  staffConfirmed: boolean;
  fileName: string;
  sheetLabel: string;
  format: SheetFormat;
  uploadedAt: string;
  uploadedByName: string;
  month: string;
  monthLabel: string;
  sheetHours: number;
  recordHours: number;
  diff: number;
  issues: number;
  statedMismatch: boolean;
  status: SheetStatus;
}

export interface SheetListSummary {
  total: number;
  ready: number;
  needsReview: number;
  notFound: number;
}

export interface SheetListPage {
  items: SheetListItem[];
  /** Rows matching the search / status filter (for the pager). */
  total: number;
  page: number;
  pageSize: number;
  /** Counts for the whole month, whatever the search or status filter says. */
  summary: SheetListSummary;
}

export interface UploadOutcome {
  label: string;
  outcome: "saved" | "duplicate" | "rejected";
  message: string;
  sheetId: string | null;
  status: SheetStatus | null;
  issues: number;
  staffName: string;
  matchedBy: "ni" | "name" | "none";
  month: string;
}
