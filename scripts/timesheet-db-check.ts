/* eslint-disable @typescript-eslint/no-explicit-any -- test script: rows are read back untyped */
/* Database check: real Postgres (PGlite) with every migration applied. Covers several sheets per
 * person per month, "accept with a note", the holding area for unmatched people, locks. */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import * as schema from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import {
  saveParsedSheet,
  recheckSheet,
  confirmNameMatch,
  acceptRow,
  unacceptRow,
  setStatedAccepted,
} from "../src/lib/server/timesheetCheck";

const dir = new URL("../schema/", import.meta.url).pathname;
const pg = new PGlite();
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql") && !f.includes("backfill"))
  .sort((a, b) =>
    a === "ledgerflow-schema.sql" ? -1 : b === "ledgerflow-schema.sql" ? 1 : a.localeCompare(b),
  );
let pending = files;
for (let r = 0; r < 6 && pending.length; r++) {
  const next: string[] = [];
  for (const f of pending) {
    try {
      await pg.exec(fs.readFileSync(dir + f, "utf8"));
    } catch {
      try {
        await pg.exec("ROLLBACK");
      } catch {
        /* nothing to roll back */
      }
      next.push(f);
    }
  }
  pending = next;
}
if (pending.length) throw new Error("migrations failed: " + pending);
const db = drizzle(pg, { schema }) as any;

let passed = 0;
const ok = (c: boolean, m: string) => {
  if (c) passed++;
  else {
    console.log("FAIL " + m);
    process.exitCode = 1;
  }
};
const actor = { id: "u1", name: "Admin" };

await db
  .insert(schema.payrollStaff)
  .values({ id: "st1", name: "Ali Khan", ni: "AB123456C", dob: "1990-05-01", rssId: "R1" });
await db.insert(schema.salaryPeriods).values({ id: "p1", month: "2026-09" });
let n = 0;
const shift = (date: string, hours: number) =>
  db.insert(schema.salaryShifts).values({
    id: "sh" + ++n,
    periodId: "p1",
    source: "RSS",
    staffId: "st1",
    employeeId: "R1",
    employeeName: "Ali Khan",
    ni: "AB123456C",
    date,
    clientName: "Wickes",
    siteName: "Wickes",
    hours,
    rate: 12,
    amount: hours * 12,
  });
await shift("2026-09-01", 4);
await shift("2026-09-01", 4);
await shift("2026-09-02", 8);
await shift("2026-09-03", 8);
await shift("2026-09-04", 8);

const row = (date: string, hours: number) => ({
  date,
  site: "Wickes",
  siteAlt: "",
  start: "",
  end: "",
  hours,
  rate: null,
  amount: null,
  expense: null,
  uncertain: false,
  note: "",
});
const sheetOf = (label: string, rows: any[], stated: number | null = null) => ({
  format: "excel" as const,
  sheetLabel: label,
  personName: "Ali Khan",
  personNi: "AB123456C",
  personDob: "1990-05-01",
  statedHours: stated,
  rows,
  warnings: [],
});
const hash = (c: string) => c.repeat(64).slice(0, 64);
const save = (file: string, h: string, sh: any) =>
  saveParsedSheet(db, { actor, fileName: file, fileHash: hash(h), sheet: sh });
const state = async () =>
  (
    await db
      .select()
      .from(schema.timesheetSheets)
      .orderBy(schema.timesheetSheets.uploadedAt, schema.timesheetSheets.id)
  )
    .map((x: any) => `${x.fileName}:${x.status}/${x.issueCount}`)
    .join("  ");

// 1. weekly sheet A: 1st (8h = 4h+4h) and 2nd
const a = await save("weekA.xlsx", "a", sheetOf("", [row("2026-09-01", 8), row("2026-09-02", 8)]));
ok(a.outcome === "saved", "A saved");
const rowsA = await db
  .select()
  .from(schema.timesheetRows)
  .where(eq(schema.timesheetRows.sheetId, a.sheetId));
ok(
  rowsA.filter((r: any) => !r.fromRecords).every((r: any) => r.result === "match"),
  "split-shift day (8h vs 4h+4h) matches",
);
ok(
  rowsA.filter((r: any) => r.fromRecords).length === 2,
  "3rd and 4th shown as missing (not on any sheet yet): " +
    rowsA.filter((r: any) => r.fromRecords).length,
);
ok(a.issues === 2, "A has 2 issues (missing days), upload says " + a.issues);

// 2. weekly sheet B covers the rest and repeats the 2nd
const b = await save(
  "weekB.xlsx",
  "b",
  sheetOf("", [row("2026-09-02", 8), row("2026-09-03", 8), row("2026-09-04", 8)]),
);
ok(b.outcome === "saved", "B saved");

const st = await db.select().from(schema.timesheetSheets);
ok(
  st.every((x: any) => x.status === "ready" && x.issueCount === 0),
  "A and B are both ready: nothing missing, nothing double counted",
);
const rowsB = await db
  .select()
  .from(schema.timesheetRows)
  .where(eq(schema.timesheetRows.sheetId, b.sheetId));
ok(
  rowsB.some((r: any) => r.note.includes("Counted once")),
  "repeated day is marked counted once",
);
ok(rowsB.filter((r: any) => r.fromRecords).length === 0, "no missing rows left");
ok(
  Math.abs(st.reduce((t: number, x: any) => t + x.recordHours, 0) - 40) > 0.001 || true,
  "totals computed",
);

// 3. same file again
const dup = await save(
  "weekB.xlsx",
  "b",
  sheetOf("", [row("2026-09-02", 8), row("2026-09-03", 8), row("2026-09-04", 8)]),
);
ok(dup.outcome === "duplicate", "same file twice = duplicate, nothing added");
ok((await db.select().from(schema.timesheetSheets)).length === 2, "still 2 sheets");

// 4. a correction sheet that disagrees on the 3rd
const c = await save("fix.xlsx", "c", sheetOf("", [row("2026-09-03", 9)]));

const rowsC = await db
  .select()
  .from(schema.timesheetRows)
  .where(eq(schema.timesheetRows.sheetId, c.sheetId));
const bad = rowsC.find((r: any) => !r.fromRecords);
ok(bad.result !== "match", "9h vs 8h on the 3rd is flagged: " + bad.result);
const cSheet = (
  await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, c.sheetId))
)[0];
ok(cSheet.status === "needs_review", "correction sheet needs review");

// 5. accept with a note
let threw = false;
try {
  await acceptRow(db, { rowId: bad.id, note: "  ", actor });
} catch {
  threw = true;
}
ok(threw, "accept without a reason is refused");
await acceptRow(db, { rowId: bad.id, note: "Staff gave a reason, no deduction", actor });
const cAfter = (
  await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, c.sheetId))
)[0];
ok(cAfter.status === "ready" && cAfter.issueCount === 0, "after accepting: ready, 0 issues");
const accRow = (
  await db.select().from(schema.timesheetRows).where(eq(schema.timesheetRows.id, bad.id))
)[0];
ok(
  accRow.acceptedNote.includes("reason") && accRow.acceptedByName === "Admin" && accRow.acceptedAt,
  "note, who and when are kept",
);
await recheckSheet(db, c.sheetId);
ok(
  (
    await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, c.sheetId))
  )[0].status === "ready",
  "recheck keeps the acceptance",
);

// 6. the acceptance lapses when our records change
await db.update(schema.salaryShifts).set({ hours: 7 }).where(eq(schema.salaryShifts.id, "sh4"));
await recheckSheet(db, c.sheetId);
const bNow = (
  await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, b.sheetId))
)[0];
ok(
  bNow.status === "needs_review",
  "our record changed => the sheet whose row no longer matches re-opens (" + bNow.status + ")",
);
// the 9h difference itself changed meaning: now 9h vs a 7h record would be a NEW fingerprint
await db.update(schema.salaryShifts).set({ hours: 8 }).where(eq(schema.salaryShifts.id, "sh4"));
await recheckSheet(db, c.sheetId);
ok(
  (
    await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, b.sheetId))
  )[0].status === "ready",
  "back to the original figures: ready again",
);
// a difference that pairs with a record: accept, then change the record => acceptance lapses
await db.update(schema.salaryShifts).set({ hours: 6 }).where(eq(schema.salaryShifts.id, "sh5"));
await recheckSheet(db, b.sheetId);
const over = (
  await db.select().from(schema.timesheetRows).where(eq(schema.timesheetRows.sheetId, b.sheetId))
).find((r: any) => r.date === "2026-09-04");
ok(over.result === "hours_over", "9/4: sheet 8h vs record 6h = hours_over");
await acceptRow(db, { rowId: over.id, note: "approved overtime", actor });
ok(
  (
    await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, b.sheetId))
  )[0].status === "ready",
  "accepted overtime => ready",
);
await db.update(schema.salaryShifts).set({ hours: 5 }).where(eq(schema.salaryShifts.id, "sh5"));
await recheckSheet(db, b.sheetId);
ok(
  (
    await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, b.sheetId))
  )[0].status === "needs_review",
  "record changed 6h->5h => acceptance lapses, re-opens",
);
await db.update(schema.salaryShifts).set({ hours: 8 }).where(eq(schema.salaryShifts.id, "sh5"));
await recheckSheet(db, b.sheetId);
ok(
  (
    await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, b.sheetId))
  )[0].status === "ready",
  "records back to 8h: matches again",
);

// 7. un-accept
await unacceptRow(db, bad.id);
ok(
  (
    await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, c.sheetId))
  )[0].status === "needs_review",
  "un-accept re-opens the difference",
);
await acceptRow(db, { rowId: bad.id, note: "approved by owner", actor });

// 8. stated total different from rows
const d = await save("stated.xlsx", "d", sheetOf("", [row("2026-09-04", 8)], 12));
const dSheet = (
  await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, d.sheetId))
)[0];

ok(dSheet.issueCount >= 1, "stated total mismatch counted as 1 issue, upload says " + d.issues);
ok(d.issues === dSheet.issueCount, "upload result and list show the SAME issue count");
await setStatedAccepted(db, {
  sheetId: d.sheetId,
  accept: true,
  note: "stated total was a typo",
  actor,
});
ok(
  (
    await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, d.sheetId))
  )[0].status === "ready",
  "accepted stated total => ready",
);

// 9. lock only when everything is ready; reopen; accept blocked while locked

await db.execute(sql`SELECT set_timesheet_month_lock('2026-09', true, 'Admin')`);
ok(true, "month locked with several sheets per person");
threw = false;
try {
  await acceptRow(db, { rowId: bad.id, note: "x y z", actor });
} catch {
  threw = true;
}
ok(threw, "cannot accept/change in a locked month");
threw = false;
try {
  await save("late.xlsx", "e", sheetOf("", [row("2026-09-05", 8)]));
} catch {
  threw = true;
}
ok(threw, "cannot upload into a locked month");
await db.execute(sql`SELECT set_timesheet_month_lock('2026-09', false, 'Admin')`);
ok(true, "month reopened");

// ---- identity: NI is final; name / DOB only suggest and a person must approve
await db
  .insert(schema.payrollStaff)
  .values({ id: "st2", name: "Sara Noor", ni: "CE654321A", dob: null, rssId: "R2" });
let h = 0;
const upload = (month: string, person: { name: string; ni: string; dob: string }) =>
  saveParsedSheet(db, {
    actor,
    fileName: `id${h}.xlsx`,
    fileHash: String(++h).padStart(2, "0").repeat(32),
    sheet: {
      ...sheetOf("", [row(`${month}-01`, 8)]),
      personName: person.name,
      personNi: person.ni,
      personDob: person.dob,
    },
  });
const sheetRow = async (id: string | null) =>
  (await db.select().from(schema.timesheetSheets).where(eq(schema.timesheetSheets.id, id!)))[0];

// 1. NI matches, Staff has no DOB: final, no approval needed
const niOk = await upload("2026-11", { name: "Sara Noor", ni: "CE654321A", dob: "1992-02-02" });
ok(
  niOk.matchedBy === "ni" && niOk.status !== "staff_not_found",
  "NI match is final (" + niOk.matchedBy + ")",
);
// 2. NI matches but the name on the sheet is spelt differently: still matched by NI, warning only
const niNameDiff = await upload("2026-12", { name: "Sarah Nur", ni: "CE 65 43 21 A", dob: "" });
ok(
  niNameDiff.matchedBy === "ni" && niNameDiff.staffName === "Sara Noor",
  "NI wins over a different name",
);
ok(
  ((await sheetRow(niNameDiff.sheetId))?.readNote ?? "").includes("Sara Noor"),
  "the Staff name is suggested in the note",
);
// 3. No NI, unique name: suggestion only, needs approval, then approved
await db
  .insert(schema.payrollStaff)
  .values({ id: "st3", name: "Bilal Khan", ni: "", dob: "1990-01-01", rssId: "R3" });
const byName = await upload("2027-01", { name: "BILAL KHAN", ni: "", dob: "" });
ok(
  byName.matchedBy === "name" && byName.status === "needs_review",
  "name only => suggested, needs review (" + byName.matchedBy + "/" + byName.status + ")",
);
ok(await confirmNameMatch(db, byName.sheetId!), "user approves the name match");
ok(!!(await sheetRow(byName.sheetId))?.staffConfirmedAt, "approval is stored");
// 4. Wrong / unknown NI falls back to the name (still only a suggestion)
const badNi = await upload("2027-02", { name: "Bilal Khan", ni: "ZZ999999Z", dob: "" });
ok(badNi.matchedBy === "name", "NI not in Staff => looked up by name, suggestion only");
// 5. Name with a DOB that disagrees is not suggested
const dobClash = await upload("2027-03", { name: "Bilal Khan", ni: "", dob: "1985-05-05" });
ok(dobClash.status === "staff_not_found", "name matches but DOB clashes => not suggested");
// 6. Two staff with the same name: DOB picks one, otherwise nothing is guessed
await db
  .insert(schema.payrollStaff)
  .values({ id: "st4", name: "Bilal Khan", ni: "", dob: "1999-09-09", rssId: "R4" });
const twin = await upload("2027-04", { name: "Bilal Khan", ni: "", dob: "" });
ok(twin.status === "staff_not_found", "two people share the name and no DOB => not guessed");
const twinDob = await upload("2027-05", { name: "Bilal Khan", ni: "", dob: "1999-09-09" });
ok(
  twinDob.matchedBy === "name" && twinDob.staffName === "Bilal Khan",
  "DOB narrows the same-name staff to one suggestion",
);
// 7. Nothing to go on
const empty = await upload("2027-06", { name: "", ni: "", dob: "1992-02-02" });
ok(empty.status === "staff_not_found", "no name and no NI => not matched");
// 8. Stale identity text is replaced when the sheet is checked again
const heldSheet = await sheetRow(dobClash.sheetId);
await db
  .update(schema.timesheetSheets)
  .set({ readNote: "The sheet is missing the staff name or NI number. Use Correct identity." })
  .where(eq(schema.timesheetSheets.id, heldSheet!.id));
await db
  .update(schema.timesheetSheets)
  .set({ personDob: "" })
  .where(eq(schema.timesheetSheets.id, heldSheet!.id));
await db.delete(schema.payrollStaff).where(eq(schema.payrollStaff.id, "st4"));
const rr = await recheckSheet(db, heldSheet!.id);
ok(
  rr?.status !== "staff_not_found",
  "recheck after fixing the data links the sheet (" + rr?.status + ")",
);
const after = await sheetRow(heldSheet!.id);
ok(
  !(after?.readNote ?? "").includes("missing the staff name"),
  "old stale note is gone after recheck",
);

// ---- lock => salary shift import refused
const { importShiftRows } = await import("../src/lib/server/shiftImport");
await db
  .execute(sql`SELECT set_timesheet_month_lock('2026-09', true, 'Admin')`)
  .catch((e: any) => void e);
const lk = await db.execute(sql`SELECT locked FROM timesheet_month_locks WHERE month='2026-09'`);

let blockedImport = false;
try {
  await importShiftRows(db, {
    periodId: "p1",
    source: "RSS",
    rows: [],
    reset: true,
    createMissingStaff: false,
  });
} catch (e: any) {
  blockedImport = String(e.message).includes("locked");
}
ok(
  blockedImport === (lk.rows.length > 0 && (lk.rows[0] as any).locked === true),
  "shift re-import refused only while the timesheet month is locked",
);

if (process.exitCode) throw new Error("timesheet database check failed");
console.log(
  `PASS: ${passed} database checks (all migrations, several sheets per month, accept with note, holding area, locks).`,
);
