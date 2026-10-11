/** A filename supplies a reviewable name hint only, never a trusted identity or NI number. */
export function filenameStaffName(fileName: string): string {
  const stem = fileName.replace(/^.*[\\/]/, "").replace(/\.(xlsx?|csv|pdf|docx?)$/i, "");
  // Require an explicit timesheet/template prefix and a separated name suffix.
  const match =
    /(?:time\s*sheet|timesheet)(?:\s+(?:format|template|monthly))*\s*[-–—:]\s*(.+)$/i.exec(stem);
  if (!match) return "";
  const candidate = (match[1] ?? "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    candidate.length > 120 ||
    !/^[\p{L}][\p{L}\s.'’-]+$/u.test(candidate) ||
    candidate.split(/\s+/).length < 2
  )
    return "";
  return candidate;
}
export const FILE_NAME_NOTICE =
  "Name suggested from the filename. Confirm the matching staff member before accepting this sheet.";
