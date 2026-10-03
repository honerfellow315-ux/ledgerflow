import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  payrollCompanies,
  payrollCompanyStaff,
  payrollLines,
  payrollSheets,
  payrollStaff,
  salaryEntries,
  salaryPayments,
  salaryPeriods,
  salaryShifts,
  staffTrash,
} from "../../../drizzle/schema";
import { uid } from "./id";
import { normNi } from "../payroll/calc";

/**
 * Staff recycle bin.
 *
 * Deleting a payroll_staff row cascades (database level) to that person's
 * company links, payroll lines, salary lines and cash payments, and un-links
 * their imported shifts. So instead of marking the row "deleted" (which every
 * existing salary / payroll query would then have to learn to ignore), the
 * whole person is written to `staff_trash` first and only then removed. All
 * existing salary / payroll code therefore keeps working exactly as before,
 * and restoring just writes the snapshot back.
 */

type StaffRow = typeof payrollStaff.$inferSelect;
type LinkRow = typeof payrollCompanyStaff.$inferSelect;
type LineRow = typeof payrollLines.$inferSelect;
type EntryRow = typeof salaryEntries.$inferSelect;
type PaymentRow = typeof salaryPayments.$inferSelect;

/** What is stored in staff_trash.snapshot (dates become ISO strings in JSON). */
export interface StaffTrashSnapshot {
  staff: StaffRow;
  companyLinks: Array<Omit<LinkRow, "createdAt"> & { createdAt: string }>;
  payrollLines: LineRow[];
  salaryEntries: EntryRow[];
  salaryPayments: PaymentRow[];
  shiftIds: string[];
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

interface Bundle {
  staff: StaffRow[];
  links: LinkRow[];
  lines: LineRow[];
  entries: EntryRow[];
  payments: PaymentRow[];
  shiftsByStaff: Map<string, string[]>;
  /** Staff who have a line in a CLOSED salary month / payroll sheet — never deleted. */
  blocked: Map<string, string>;
}

/** Loads one person-group's profile and everything the database would cascade away. */
async function collect(ids: string[]): Promise<Bundle> {
  const staff = await db.select().from(payrollStaff).where(inArray(payrollStaff.id, ids));
  const staffIds = staff.map((s) => s.id);
  const empty: Bundle = {
    staff,
    links: [],
    lines: [],
    entries: [],
    payments: [],
    shiftsByStaff: new Map(),
    blocked: new Map(),
  };
  if (staffIds.length === 0) return empty;

  const [links, lines, entries, shiftRows] = await Promise.all([
    db.select().from(payrollCompanyStaff).where(inArray(payrollCompanyStaff.staffId, staffIds)),
    db.select().from(payrollLines).where(inArray(payrollLines.staffId, staffIds)),
    db.select().from(salaryEntries).where(inArray(salaryEntries.staffId, staffIds)),
    db
      .select({ id: salaryShifts.id, staffId: salaryShifts.staffId })
      .from(salaryShifts)
      .where(inArray(salaryShifts.staffId, staffIds)),
  ]);

  const payments: PaymentRow[] = [];
  for (const part of chunk(
    entries.map((e) => e.id),
    500,
  )) {
    payments.push(...(await db.select().from(salaryPayments).where(inArray(salaryPayments.entryId, part))));
  }

  const shiftsByStaff = new Map<string, string[]>();
  for (const r of shiftRows) {
    if (!r.staffId) continue;
    const list = shiftsByStaff.get(r.staffId) ?? [];
    list.push(r.id);
    shiftsByStaff.set(r.staffId, list);
  }

  // Closed months / sheets are locked everywhere else in the app — don't let a
  // staff delete quietly rewrite them.
  const blocked = new Map<string, string>();
  const periodIds = [...new Set(entries.map((e) => e.periodId))];
  const sheetIds = [...new Set(lines.map((l) => l.sheetId))];
  const closedPeriods = new Map<string, string>();
  const closedSheets = new Map<string, string>();
  for (const part of chunk(periodIds, 500)) {
    const rows = await db
      .select({ id: salaryPeriods.id, month: salaryPeriods.month, status: salaryPeriods.status })
      .from(salaryPeriods)
      .where(inArray(salaryPeriods.id, part));
    for (const r of rows) if (r.status === "closed") closedPeriods.set(r.id, r.month);
  }
  for (const part of chunk(sheetIds, 500)) {
    const rows = await db
      .select({ id: payrollSheets.id, month: payrollSheets.month, status: payrollSheets.status })
      .from(payrollSheets)
      .where(inArray(payrollSheets.id, part));
    for (const r of rows) if (r.status === "closed") closedSheets.set(r.id, r.month);
  }
  for (const e of entries) {
    const month = closedPeriods.get(e.periodId);
    if (month && !blocked.has(e.staffId)) blocked.set(e.staffId, `closed salary month ${month}`);
  }
  for (const l of lines) {
    const month = closedSheets.get(l.sheetId);
    if (month && !blocked.has(l.staffId)) blocked.set(l.staffId, `closed payroll sheet ${month}`);
  }

  return { staff, links, lines, entries, payments, shiftsByStaff, blocked };
}

export interface StaffDeleteImpact {
  staff: number;
  salaryLines: number;
  payrollLines: number;
  payments: number;
  shifts: number;
  /** How many of the chosen staff can't be deleted (they sit in a closed month). */
  blocked: number;
  blockedNames: string[];
}

/** Read-only: what deleting these staff would take with it. Writes nothing. */
export async function staffDeleteImpact(ids: string[]): Promise<StaffDeleteImpact> {
  const out: StaffDeleteImpact = {
    staff: 0,
    salaryLines: 0,
    payrollLines: 0,
    payments: 0,
    shifts: 0,
    blocked: 0,
    blockedNames: [],
  };
  for (const part of chunk([...new Set(ids)], 100)) {
    const b = await collect(part);
    for (const s of b.staff) {
      if (b.blocked.has(s.id)) {
        out.blocked += 1;
        if (out.blockedNames.length < 5) out.blockedNames.push(`${s.name} (${b.blocked.get(s.id)})`);
        continue;
      }
      out.staff += 1;
      out.shifts += b.shiftsByStaff.get(s.id)?.length ?? 0;
    }
    const ok = new Set(b.staff.filter((s) => !b.blocked.has(s.id)).map((s) => s.id));
    out.salaryLines += b.entries.filter((e) => ok.has(e.staffId)).length;
    out.payrollLines += b.lines.filter((l) => ok.has(l.staffId)).length;
    const okEntries = new Set(b.entries.filter((e) => ok.has(e.staffId)).map((e) => e.id));
    out.payments += b.payments.filter((p) => okEntries.has(p.entryId)).length;
  }
  return out;
}

export interface MoveToTrashResult {
  deleted: number;
  skipped: number;
  skippedNames: string[];
}

/**
 * Snapshot first, delete second. If the delete fails the snapshot is removed
 * again, so a failure never leaves a ghost entry behind.
 */
export async function moveStaffToTrash(ids: string[], deletedBy: string): Promise<MoveToTrashResult> {
  const result: MoveToTrashResult = { deleted: 0, skipped: 0, skippedNames: [] };
  for (const part of chunk([...new Set(ids)], 20)) {
    const b = await collect(part);
    const deletable = b.staff.filter((s) => !b.blocked.has(s.id));
    for (const s of b.staff) {
      if (b.blocked.has(s.id)) {
        result.skipped += 1;
        if (result.skippedNames.length < 5) result.skippedNames.push(s.name);
      }
    }
    if (deletable.length === 0) continue;

    const rows = deletable.map((s) => {
      const entries = b.entries.filter((e) => e.staffId === s.id);
      const entryIds = new Set(entries.map((e) => e.id));
      const snapshot: StaffTrashSnapshot = {
        staff: s,
        companyLinks: b.links
          .filter((l) => l.staffId === s.id)
          .map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
        payrollLines: b.lines.filter((l) => l.staffId === s.id),
        salaryEntries: entries,
        salaryPayments: b.payments.filter((p) => entryIds.has(p.entryId)),
        shiftIds: b.shiftsByStaff.get(s.id) ?? [],
      };
      return { id: uid("stt"), staffId: s.id, name: s.name, deletedBy, snapshot };
    });

    await db.insert(staffTrash).values(rows);
    try {
      await db.delete(payrollStaff).where(
        inArray(
          payrollStaff.id,
          deletable.map((s) => s.id),
        ),
      );
    } catch (err) {
      await db.delete(staffTrash).where(
        inArray(
          staffTrash.id,
          rows.map((r) => r.id),
        ),
      );
      throw err;
    }
    result.deleted += deletable.length;
  }
  return result;
}

/** Puts a deleted person (and whatever of their history still has a home) back. */
export async function restoreStaffFromTrash(trashId: string): Promise<{ name: string; note: string }> {
  const [row] = await db.select().from(staffTrash).where(eq(staffTrash.id, trashId)).limit(1);
  if (!row) throw new Error("This item is no longer in the recycle bin.");
  const snap = row.snapshot as unknown as StaffTrashSnapshot;
  const s = snap.staff;

  const current = await db.select().from(payrollStaff);
  if (current.some((c) => c.id === s.id)) {
    await db.delete(staffTrash).where(eq(staffTrash.id, row.id));
    throw new Error(`${s.name} is already back in the staff list.`);
  }
  // Same rule as adding a person by hand: one RSS ID / ESS ID / NI per person.
  for (const c of current) {
    if (s.rssId && c.rssId === s.rssId) throw new Error(`RSS ID ${s.rssId} now belongs to ${c.name}. Fix or remove that profile first.`);
    if (s.essId && c.essId === s.essId) throw new Error(`ESS ID ${s.essId} now belongs to ${c.name}. Fix or remove that profile first.`);
    if (s.ni && normNi(c.ni) === normNi(s.ni)) throw new Error(`The NI number now belongs to ${c.name}. Fix or remove that profile first.`);
  }

  await db.insert(payrollStaff).values(s);
  try {
    const [companies, sheets, periods] = await Promise.all([
      db.select({ id: payrollCompanies.id }).from(payrollCompanies),
      db.select({ id: payrollSheets.id }).from(payrollSheets),
      db.select({ id: salaryPeriods.id }).from(salaryPeriods),
    ]);
    const companyIds = new Set(companies.map((x) => x.id));
    const sheetIds = new Set(sheets.map((x) => x.id));
    const periodIds = new Set(periods.map((x) => x.id));

    const links = snap.companyLinks
      .filter((l) => companyIds.has(l.companyId))
      .map((l) => ({ ...l, createdAt: new Date(l.createdAt) }));
    const lines = snap.payrollLines.filter((l) => sheetIds.has(l.sheetId));
    const entries = snap.salaryEntries.filter((e) => periodIds.has(e.periodId));
    const entryIds = new Set(entries.map((e) => e.id));
    const payments = snap.salaryPayments.filter((p) => entryIds.has(p.entryId));

    for (const part of chunk(links, 200)) await db.insert(payrollCompanyStaff).values(part).onConflictDoNothing();
    for (const part of chunk(lines, 200)) await db.insert(payrollLines).values(part).onConflictDoNothing();
    for (const part of chunk(entries, 200)) await db.insert(salaryEntries).values(part).onConflictDoNothing();
    for (const part of chunk(payments, 200)) await db.insert(salaryPayments).values(part).onConflictDoNothing();

    // Re-link their imported shifts (only ones nobody else has claimed meanwhile).
    for (const part of chunk(snap.shiftIds, 500)) {
      await db
        .update(salaryShifts)
        .set({ staffId: s.id })
        .where(and(inArray(salaryShifts.id, part), isNull(salaryShifts.staffId)));
    }

    await db.delete(staffTrash).where(eq(staffTrash.id, row.id));

    const lostLines = snap.salaryEntries.length - entries.length + (snap.payrollLines.length - lines.length);
    const note =
      lostLines > 0
        ? `${lostLines} sheet line${lostLines === 1 ? "" : "s"} could not be restored because that month / sheet no longer exists.`
        : "";
    return { name: s.name, note };
  } catch (err) {
    // Undo the partial restore (cascades away anything inserted above); the
    // recycle-bin entry is still there to try again.
    await db.delete(payrollStaff).where(eq(payrollStaff.id, s.id));
    throw err;
  }
}

/** Removes a recycle-bin entry for good. */
export async function purgeStaffTrash(trashId: string): Promise<string> {
  const [row] = await db.select({ name: staffTrash.name }).from(staffTrash).where(eq(staffTrash.id, trashId)).limit(1);
  await db.delete(staffTrash).where(eq(staffTrash.id, trashId));
  return row?.name ?? "";
}
