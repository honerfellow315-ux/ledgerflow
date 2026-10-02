/**
 * Works out what an uploaded workbook is, so a file dropped into the wrong tab
 * of the import screen is moved to the right one instead of being rejected.
 */
import { parseStaffDetails } from "./detailsImport";
import { looksLikeMasterSheet, looksLikeShiftSheet, type SheetMatrix } from "./excel";

export type FileKind = "shifts" | "master" | "details" | "unknown";

/** Order matters: a shift export is checked first (its headers are the most specific). */
export function detectFileKind(sheets: readonly SheetMatrix[]): FileKind {
  if (sheets.some((s) => looksLikeShiftSheet(s.matrix))) return "shifts";
  if (sheets.some((s) => looksLikeMasterSheet(s.matrix))) return "master";
  if (sheets.some((s) => parseStaffDetails(s.matrix).found)) return "details";
  return "unknown";
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Picks the shift company a file belongs to from its file name (a whole-word
 * match on the code or the name) and, failing that, a sheet named exactly
 * after one company. Returns null when nothing matches or when more than one
 * company matches (a file with both an RSS and an ESS tab), so the person chooses.
 */
export function guessShiftCompany(
  fileName: string,
  sheets: readonly SheetMatrix[],
  companies: readonly { code: string; name: string }[],
): string | null {
  const hit = (text: string, c: { code: string; name: string }) =>
    [c.code, c.name].some(
      (t) => t.trim() && new RegExp(`(^|[^A-Za-z0-9])${escapeRe(t.trim())}([^A-Za-z0-9]|$)`, "i").test(text),
    );
  const base = fileName.replace(/\.[^.]+$/, "");
  const byName = companies.filter((c) => hit(base, c));
  if (byName.length === 1) return byName[0]!.code;
  if (byName.length > 1) return null;
  const bySheet = companies.filter((c) =>
    sheets.some((s) => s.name.trim().toLowerCase() === c.code.toLowerCase()),
  );
  return bySheet.length === 1 ? bySheet[0]!.code : null;
}
