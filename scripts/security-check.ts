import assert from "node:assert/strict";
import { validatePassword } from "../src/lib/passwordPolicy";
import { toCsv } from "../src/lib/ledger/csv";
import { compareRows } from "../src/lib/timesheets/compare";

// Password policy: the old weak examples must all be refused.
for (const p of ["password", "12345678", "admin123", "qwertyui", "letmein1", "Password123!!!"]) {
  assert.ok(validatePassword(p, "alice"), `should reject ${p}`);
}
assert.equal(validatePassword("Correct-Horse-Battery-9", "alice"), null);

// CSV: formulas are neutralised, plain money is untouched.
const csv = toCsv(["a"], [['=HYPERLINK("x")'], ["-£1,200.00"], [-12.5], ["@SUM(A1)"]]);
assert.ok(csv.includes("'=HYPERLINK"));
assert.ok(csv.includes("-£1,200.00") && !csv.includes("'-£"));
assert.ok(csv.includes("-12.5") && csv.includes("'@SUM"));

// Compare: split shifts agree on the day total; duplicates still do not.
const row = (k: number, h: number) => ({
  key: k,
  date: "2026-09-01",
  site: "Wickes",
  siteAlt: "",
  hours: h,
  uncertain: false,
  parseNote: "",
});
const rec = (id: string, h: number) => ({
  id,
  date: "2026-09-01",
  clientName: "Wickes",
  siteName: "Wickes",
  hours: h,
  rate: 12,
});
const run = (rows: ReturnType<typeof row>[], records: ReturnType<typeof rec>[]) =>
  compareRows({ staffFound: true, month: "2026-09", rows, records });
let r = run([row(0, 8)], [rec("a", 4), rec("b", 4)]);
assert.deepEqual(
  r.answers.map((a) => a.result),
  ["match"],
);
assert.equal(r.missing.length, 0);
r = run([row(0, 8), row(1, 8)], [rec("a", 8)]);
assert.deepEqual(
  r.answers.map((a) => a.result),
  ["match", "not_in_records"],
);
r = run([row(0, 8)], [rec("a", 4), rec("b", 3)]);
assert.equal(r.answers[0]!.result, "hours_over");

console.log("PASS: password policy, CSV formula safety, split-shift day totals.");
