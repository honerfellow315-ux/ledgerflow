/**
 * Timesheet receipt / report (Excel).
 *  - "Summary": one line per sheet, either "All correct" or how many issues it has.
 *  - "Issues": only the rows that need a look, so a correct sheet never clutters it.
 */
import {
  fmtDate,
  fmtDiff,
  maskNi,
  sheetTotals,
  type RowResult,
  type TimesheetSheet,
} from "./data";

const ISSUE_LABEL: Record<RowResult, string> = {
  match: "Matches",
  hours_over: "Sheet is higher than our records",
  hours_under: "Sheet is lower than our records",
  not_in_records: "Not in our records",
  not_on_sheet: "In our records but missing from the sheet",
  check_reading: "Could not be read clearly, please check",
};

const GREEN = "FFDFF3E4";
const AMBER = "FFFCEFCB";
const RED = "FFF8DAD6";
const HEAD = "FFE8EEF1";

export async function downloadTimesheetReport(sheets: readonly TimesheetSheet[]): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  const headRow = (ws: import("exceljs").Worksheet) => {
    const r = ws.getRow(1);
    r.font = { bold: true };
    r.eachCell((c) => {
      c.fill = fill(HEAD);
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  const sum = wb.addWorksheet("Summary");
  sum.columns = [
    { header: "Staff", key: "name", width: 26 },
    { header: "NI", key: "ni", width: 16 },
    { header: "File", key: "file", width: 30 },
    { header: "Hours on sheet", key: "sheet", width: 16 },
    { header: "Hours in our records", key: "rec", width: 20 },
    { header: "Difference", key: "diff", width: 13 },
    { header: "Result", key: "result", width: 36 },
  ];
  headRow(sum);

  const issues = wb.addWorksheet("Issues");
  issues.columns = [
    { header: "Staff", key: "name", width: 26 },
    { header: "Date", key: "date", width: 14 },
    { header: "Site", key: "site", width: 26 },
    { header: "Time", key: "time", width: 14 },
    { header: "Sheet hours", key: "sheet", width: 13 },
    { header: "Our hours", key: "rec", width: 12 },
    { header: "Difference", key: "diff", width: 12 },
    { header: "Issue", key: "issue", width: 40 },
    { header: "Note", key: "note", width: 44 },
  ];
  headRow(issues);

  let issueRows = 0;
  for (const s of sheets) {
    const t = sheetTotals(s);
    const notFound = s.status === "staff_not_found";
    const problems = t.issues + (t.statedMismatch ? 1 : 0);
    const result = notFound
      ? "Staff not found"
      : problems === 0
        ? "All correct"
        : `${problems} ${problems === 1 ? "issue" : "issues"} to check`;
    const row = sum.addRow({
      name: s.staffName,
      ni: maskNi(s.ni),
      file: s.fileName,
      sheet: t.sheetHours,
      rec: notFound ? "" : t.recordHours,
      diff: notFound ? "" : t.diff,
      result,
    });
    row.getCell("result").fill = fill(notFound ? RED : problems === 0 ? GREEN : AMBER);

    if (problems === 0) continue;
    for (const r of s.rows) {
      if (r.result === "match") continue;
      issues.addRow({
        name: s.staffName,
        date: fmtDate(r.date),
        site: r.site,
        time: r.start === "—" ? "—" : `${r.start} to ${r.end}`,
        sheet: r.sheetHours,
        rec: r.recordHours ?? "",
        diff: r.recordHours === null ? "" : fmtDiff(r.sheetHours - r.recordHours),
        issue: ISSUE_LABEL[r.result],
        note: r.note ?? "",
      });
      issueRows += 1;
    }
    if (t.statedMismatch) {
      issues.addRow({
        name: s.staffName,
        issue: "Total on the sheet is wrong",
        note: `The sheet says ${s.statedHours} h, but its rows add up to ${t.sheetHours} h.`,
      });
      issueRows += 1;
    }
  }
  if (issueRows === 0) issues.addRow({ name: "No issues found. Every sheet is correct." });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const first = sheets[0];
  const name =
    sheets.length === 1 && first
      ? `Timesheet receipt - ${first.staffName} ${first.monthLabel}.xlsx`
      : `Timesheet report${first ? ` ${first.monthLabel}` : ""}.xlsx`;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
