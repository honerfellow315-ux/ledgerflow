import assert from "node:assert/strict";
import { linesToMatrix, needsDateYear, parseShiftLine } from "../src/lib/timesheets/textRows";
import { parseTimesheetMatrix } from "../src/lib/timesheets/parseMatrix";
const lines = [
  "Site Name Date Site Start time End time Duration rate per hour",
  "Test Site 1st sep AB1 2CD 17:00 22:00 5 10",
  "Test Site 2nd sep AB1 2CD 14:00 22;00 8 10",
  "Total Hours 13",
  "A note about travel on 4th September, not a shift.",
];
assert.equal(needsDateYear(lines), true);
const parsed = parseTimesheetMatrix(linesToMatrix(lines, 2026)!, "")!;
assert.equal(parsed.rows.length, 2);
assert.deepEqual(
  parsed.rows.map((r) => r.date),
  ["2026-09-01", "2026-09-02"],
);
assert.equal(
  parsed.rows.reduce((sum, r) => sum + (r.hours ?? 0), 0),
  13,
);
assert.equal(parsed.rows[1]!.end, "22:00");
assert.ok(parsed.rows[0]!.site.includes("Test Site"));
const dated = "Test Site 02/08/2025 08:00 16:00 8 10";
assert.equal(needsDateYear([dated]), false);
assert.equal(parseShiftLine(dated, undefined, 2026)![1], "02/08/2025");
assert.equal(
  parseShiftLine("Test Site 31st sep 08:00 16:00 8 10", undefined, 2026)![1],
  "31st sep 2026",
);
const bad = parseTimesheetMatrix(
  linesToMatrix([lines[0]!, "Test Site 31st sep 08:00 16:00 8 10"], 2026)!,
  "",
)!;
assert.equal(bad.rows[0]!.date, "");
assert.equal(bad.rows[0]!.uncertain, true);
console.log(
  "PASS: missing year, site-first PDF rows, semicolon times, explicit years preserved, footer notes excluded and invalid dates flagged.",
);
