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
  /** Sheet hours minus record hours, NOT counting differences that were accepted. */
  diff: number;
  /** What is paid for this sheet (null = not calculated yet: use "Check again"). */
  payHours: number | null;
  payAmount: number | null;
  issues: number;
  statedMismatch: boolean;
  status: SheetStatus;
}

export interface SheetListSummary {
  total: number;
  ready: number;
  needsReview: number;
  notFound: number;
  /** Total pay of the sheets in the month (accepted differences use their actual hours). */
  payHours: number;
  payAmount: number;
  /** Matched sheets whose pay has not been calculated yet (uploaded before this update). */
  payMissing: number;
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
