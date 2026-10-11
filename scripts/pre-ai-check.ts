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
