import assert from "node:assert/strict";
import { lineTotals, sumLines, salaryPasteSnippet } from "../src/lib/payroll/sheetCalc";
import { payslipTotals, earningLines, type PayslipRow } from "../src/lib/payslips/data";
import type { PayrollLine, PayrollSheetStaff } from "../src/lib/payroll/sheetTypes";
const line: PayrollLine = {
  id: "test",
  sheetId: "test",
  staffId: "test",
  unitsHours: 100,
  bankHolidayHours: 0,
  holidayEntitlement: 0,
  comment: "",
  rate: 10,
  fixedAmount: null,
  holidayRate: null,
  uniformCost: 25,
};
assert.equal(lineTotals(line).amount, 1025);
assert.equal(lineTotals({ ...line, uniformCost: 0 }).amount, 1000);
const { uniformCost, ...legacyLine } = line;
assert.equal(lineTotals(legacyLine).amount, 1000);
assert.equal(lineTotals({ ...line, fixedAmount: 500 }).amount, 525);
assert.equal(lineTotals({ ...line, holidayEntitlement: 2, holidayRate: 12.5 }).amount, 1050);
assert.equal(sumLines([line, { ...line, uniformCost: 0 }]).amount, 2025);
assert.match(
  salaryPasteSnippet([{ line, staff: { name: "Test Staff", ni: "TEST" } as PayrollSheetStaff }]),
  /1025\.00/,
);
for (const fixedAmount of [null, 500]) {
  const p: PayslipRow = {
    ...line,
    fixedAmount,
    holidayEntitlement: 2,
    holidayRate: 12.5,
    name: "Test",
    ni: "TEST",
    company: "Test",
    companyAddress: "",
    month: "2026-10",
  };
  assert.equal(
    earningLines(p).reduce((s, r) => s + r.amount, 0),
    payslipTotals(p).amount,
  );
  assert.equal(earningLines(p).find((r) => r.label === "Uniform cost")?.amount, 25);
}
console.log(
  "PASS: uniform added once to hourly/fixed/holiday pay, totals, salary copy and payslip breakdown.",
);
