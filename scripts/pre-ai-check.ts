import { SITE_DIFFERENCE_BLOCKS_MATCH_ON_SINGLE_SHIFT_DAY } from "../src/lib/timesheets/rules";
/** Fake fixtures only. Run: node --import tsx scripts/pre-ai-check.ts */
import assert from "node:assert/strict";
import { ukClock } from "../src/lib/dashboard/clock";
import { parseTimesheetMatrix } from "../src/lib/timesheets/parseMatrix";
import { parseBankMatrix } from "../src/lib/bankMatch/parse";
import { bankPageToMatrix } from "../src/lib/bankMatch/readDocuments";
import type { PdfPiece } from "../src/lib/timesheets/readPdf";

assert.match(ukClock(new Date("2026-01-15T11:59:00Z")).greeting, /morning/);
assert.match(ukClock(new Date("2026-07-15T11:00:00Z")).greeting, /afternoon/);
assert.match(ukClock(new Date("2026-07-15T17:00:00Z")).greeting, /evening/);
assert.match(ukClock(new Date("2026-07-15T23:30:00Z")).date, /16 Jul/);
assert.match(ukClock(new Date("2026-10-25T00:30:00Z")).time, /^01:30/);
assert.match(ukClock(new Date("2026-10-25T01:30:00Z")).time, /^01:30/);

const shifts = [
  ["Date", "Site", "Hours"],
  ["01/09/2026", "Fake Site", 8],
];
const combined = parseTimesheetMatrix(
  [["Name: Test Worker NI Number: AB123456C"], ...shifts],
  "Sample",
);
assert.equal(combined?.personName, "Test Worker");
assert.equal(combined?.personNi.replace(/\s/g, ""), "AB123456C");
const nin = parseTimesheetMatrix(
  [["Full Name", "Test Worker"], ["NIN Number", "AB123456C"], ...shifts],
  "Sample",
);
assert.equal(nin?.personNi.replace(/\s/g, ""), "AB123456C");
assert.equal(nin?.rows[0]?.hours, 8);

const header = ["Date", "Description", "Paid in", "Paid out", "Balance"];
const read = parseBankMatrix([
  header,
  ["01/09/2026", "Fake Client", "100.00", "", "100.00"],
  ["02/09/2026", "Fake expense", "", "25.00", "75.00"],
]);
assert.equal(read.lines.length, 1);
assert.equal(read.lines[0]?.amount, 100);
assert.equal(read.skippedOut, 1);
assert.equal(parseBankMatrix([header, ["bad date", "Fake Client", "100.00"]]).problems.length, 1);
assert.equal(
  parseBankMatrix([header, ["01/09/2026", "Fake Client", "unreadable"]]).problems.length,
  1,
);
const pieces: PdfPiece[] = [];
const xs = [30, 130, 330, 410, 500];
function addRow(values: string[], y: number) {
  values.forEach((str, i) => {
    if (str) pieces.push({ str, x: xs[i]!, y, w: str.length * 4, h: 10 });
  });
}
addRow(header, 700);
addRow(["01/09/2026", "Fake Client", "100.00", "", "100.00"], 680);
addRow(["02/09/2026", "Fake expense", "", "25.00", "75.00"], 660);
const pdf = parseBankMatrix(bankPageToMatrix(pieces));
assert.equal(pdf.lines[0]?.amount, 100);
assert.equal(pdf.skippedOut, 1);
assert.throws(() => bankPageToMatrix([]), /No supported bank table/);
console.log(
  "PASS: UK GMT/BST clock, timesheet identity labels, bank amounts/dates and PDF debit/credit columns.",
);

// Only explicit timesheet filenames may suggest identity; staff still confirms it.
import { filenameStaffName } from "../src/lib/timesheets/fileIdentity";
assert.equal(
  filenameStaffName("September 2026 Monthly Time Sheet Format - Test Worker Example.xlsx"),
  "Test Worker Example",
);
assert.equal(filenameStaffName("random-export.xlsx"), "");
assert.equal(filenameStaffName("Timesheet - Staff 123.xlsx"), "");
console.log("PASS: conservative filename identity hints.");

// An accessible PDF can repeat headers at 0.05pt and wrap descriptions above/below dates.
const visibleBank: PdfPiece[] = [
  { str: "Date", x: 30, y: 700, w: 20, h: 9 },
  { str: "Description", x: 100, y: 700, w: 50, h: 9 },
  { str: "Money In (£)", x: 300, y: 700, w: 60, h: 9 },
  { str: "Money Out (£)", x: 400, y: 700, w: 60, h: 9 },
  { str: "Date", x: 30, y: 689, w: 0.1, h: 0.05 },
  { str: "Description", x: 100, y: 689, w: 0.1, h: 0.05 },
  { str: "Fake Customer", x: 100, y: 684, w: 70, h: 9 },
  { str: "01 Sep 26", x: 30, y: 680, w: 40, h: 9 },
  { str: "100.00", x: 330, y: 680, w: 30, h: 9 },
  { str: "Fake Reference", x: 100, y: 676, w: 65, h: 9 },
  { str: "Transaction types", x: 30, y: 620, w: 80, h: 9 },
  { str: "Charge", x: 300, y: 600, w: 30, h: 9 },
];
const accessible = parseBankMatrix(bankPageToMatrix(visibleBank));
assert.equal(accessible.problems.length, 0);
assert.equal(accessible.lines.length, 1);
assert.equal(accessible.lines[0]?.description, "Fake Customer Fake Reference");
assert.equal(accessible.lines[0]?.amount, 100);

import { compareRows, type SheetRowInput, type RecordShift } from "../src/lib/timesheets/compare";
const sr: SheetRowInput = {
  key: 0,
  date: "2026-09-01",
  site: "Fake site",
  siteAlt: "",
  hours: 8,
  uncertain: false,
  parseNote: "",
};
const rr: RecordShift = {
  id: "one",
  date: sr.date,
  siteName: sr.site,
  clientName: "Fake client",
  hours: 8,
  rate: 10,
};
const match = compareRows({ staffFound: true, month: "2026-09", rows: [sr], records: [rr] });
assert.equal(match.answers[0]?.result, "match");
const duplicate = compareRows({
  staffFound: true,
  month: "2026-09",
  rows: [sr],
  records: [rr, { ...rr, id: "two" }],
});
assert.equal(duplicate.answers[0]?.result, "check_reading");
assert.match(duplicate.answers[0]?.note ?? "", /Possible duplicate/);
assert.equal(duplicate.missing.length, 1);
const wrongSite = compareRows({
  staffFound: true,
  month: "2026-09",
  rows: [{ ...sr, site: "Different venue" }],
  records: [rr],
});
assert.equal(
  wrongSite.answers[0]?.result,
  SITE_DIFFERENCE_BLOCKS_MATCH_ON_SINGLE_SHIFT_DAY ? "check_reading" : "match",
);
assert.match(wrongSite.answers[0]?.note ?? "", /site on the sheet differs/);
const unreadable = compareRows({
  staffFound: true,
  month: "2026-09",
  rows: [{ ...sr, hours: null }],
  records: [rr],
});
assert.equal(unreadable.missing[0]?.recordHours, 8);
const otherStaffDay = compareRows({
  staffFound: true,
  month: "2026-09",
  rows: [sr],
  records: [rr, { ...rr, id: "two", hours: 18 }],
});
assert.match(otherStaffDay.answers[0]?.note ?? "", /more than 24 hours/);
const otherMonth = compareRows({
  staffFound: true,
  month: "2026-09",
  rows: [sr],
  records: [rr, { ...rr, id: "oct", date: "2026-10-01" }],
});
assert.equal(otherMonth.missing.length, 0);
console.log(
  "PASS: hidden PDF labels, wrapped bank descriptions, duplicate shifts, site mismatch, unreadable hours and month boundaries.",
);
