import assert from "node:assert/strict";
import { normalizeDob } from "../src/lib/timesheets/identity";
import { parseTimesheetMatrix } from "../src/lib/timesheets/parseMatrix";
import { linesToMatrix } from "../src/lib/timesheets/textRows";
assert.equal(normalizeDob("03/02/1990"), "1990-02-03");
assert.equal(normalizeDob("1990-02-31"), "");
assert.equal(normalizeDob("03/02/90"), "");
assert.equal(normalizeDob("2090-01-01"), "");
for (const date of ["03/02/1990", { clock: 0, date: "1990-02-03" }, 32907]) {
  const parsed = parseTimesheetMatrix(
    [
      ["Full Name", "Test Worker"],
      [],
      ["NI Number", "AB123456C"],
      [],
      ["DOB", date],
      [],
      ["Date", "Site", "Start time", "End time", "Hours"],
      ["2026-09-01", "Test Site", "08:00", "16:00", 8],
    ],
    "",
  );
  assert.equal(parsed?.personDob, "1990-02-03");
  assert.equal(parsed?.personName, "Test Worker");
  assert.equal(parsed?.rows[0]?.site, "Test Site");
  assert.equal(parsed?.rows[0]?.hours, 8);
}
const matrix = linesToMatrix([
  "Full Name: Test Worker NI Number: AB123456C DOB: 03/02/1990",
  "Date Site Start time End time Hours",
  "01/09/2026 Test Site 08:00 16:00 8",
]);
assert.ok(matrix);
const pdf = parseTimesheetMatrix(matrix, "");
assert.equal(pdf?.personDob, "1990-02-03");
assert.equal(pdf?.personName, "Test Worker");
console.log(
  "PASS: labelled DOB extraction for text and Excel dates; impossible/future/ambiguous dates rejected; site and hours unchanged.",
);
