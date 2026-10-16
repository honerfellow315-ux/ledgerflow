/**
 * Compares the rows of one timesheet with that person's own shift records.
 * Pure logic (no database), so the rules can be tested on their own.
 *
 * HOW SEVERAL SHIFTS ON ONE DATE ARE HANDLED
 * Rows are never added together. For every date, the sheet's rows are paired one-to-one
 * with that date's shifts in our records, so each row gets its own answer:
 *   1. same site and the same hours (inside the tolerance)  -> paired first
 *   2. same site, different hours                           -> paired next, closest hours first
 *   3. whatever is left on both sides, any site             -> paired by closest hours
 *      (the note says when the site names differ)
 * A sheet row with nobody to pair with is "not_in_records". A record shift nobody on the
 * sheet claimed is "not_on_sheet" (only for dates inside the sheet's own month).
 * Two identical rows on one date against a single record therefore give: one match and one
 * "not_in_records", never a silent double count.
 *
 * "Same site" compares the sheet's site columns with the record's site AND client name,
 * ignoring case and punctuation; one name inside the other (4+ letters) also counts.
 */
import { normName, round2 } from "../payroll/calc";
import { HOURS_TOLERANCE_MINUTES, SITE_DIFFERENCE_BLOCKS_MATCH_ON_SINGLE_SHIFT_DAY } from "./rules";
import type { RowResult } from "./data";

export interface SheetRowInput {
  /** Position in the sheet, used to give the answer back. */
  key: number;
  date: string;
  site: string;
  siteAlt: string;
  hours: number | null;
  /** The reader or the sheet itself is unsure about this row. */
  uncertain: boolean;
  parseNote: string;
}

export interface RecordShift {
  id: string;
  date: string;
  clientName: string;
  siteName: string;
  hours: number;
  rate: number;
  /** The shift is in our records but not linked to this staff member (found by NI, company ID or name). */
  unlinked?: boolean;
}

export interface RowAnswer {
  key: number;
  result: RowResult;
  recordHours: number | null;
  /** Rate of the record shift this row was paired with (null = no record shift). */
  recordRate?: number | null;
  /** The record shift (salary_shifts.id) this row was paired with, if any. */
  recordId?: string | null;
  note: string;
}

export interface MissingFromSheet {
  /** The record shift (salary_shifts.id) that is missing from the sheet. */
  recordId?: string;
  date: string;
  site: string;
  recordHours: number;
  rate: number;
  note: string;
}

const minutes = (h: number) => Math.round(h * 60);
const fmt = (h: number) => `${Number(round2(h).toFixed(2))} h`;

const within = (a: number, b: number) =>
  Math.abs(minutes(a) - minutes(b)) <= HOURS_TOLERANCE_MINUTES;

function siteKeys(...names: string[]): string[] {
  return names.map((n) => normName(n)).filter((n) => n.length > 0);
}

function sameSite(a: string[], b: string[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      if (short.length >= 4 && long.includes(short)) return true;
    }
  }
  return false;
}

export function compareRows(args: {
  staffFound: boolean;
  /** yyyy-mm: "missing from the sheet" is only reported for this month. */
  month: string;
  rows: SheetRowInput[];
  records: RecordShift[];
  /** Dates on which our records hold a shift with 0 hours (such shifts are not paired). */
  zeroHourDates?: ReadonlySet<string>;
}): { answers: RowAnswer[]; missing: MissingFromSheet[] } {
  const answers = new Map<number, RowAnswer>();
  const missing: MissingFromSheet[] = [];

  if (!args.staffFound) {
    for (const r of args.rows) {
      answers.set(r.key, {
        key: r.key,
        result: r.hours === null || r.date === "" ? "check_reading" : "not_in_records",
        recordHours: null,
        note:
          r.hours === null || r.date === ""
            ? withParse(r, "")
            : withParse(r, "Staff member not found."),
      });
    }
    return { answers: args.rows.map((r) => answers.get(r.key)!), missing };
  }

  const recordCounts = new Map<string, number>();
  const dayMinutes = new Map<string, number>();
  const recordKey = (r: RecordShift) =>
    JSON.stringify([
      r.date,
      normName(r.clientName),
      normName(r.siteName),
      minutes(r.hours),
      r.rate,
    ]);
  for (const rec of args.records) {
    const key = recordKey(rec);
    recordCounts.set(key, (recordCounts.get(key) ?? 0) + 1);
    dayMinutes.set(rec.date, (dayMinutes.get(rec.date) ?? 0) + minutes(rec.hours));
  }
  const recordNote = (rec: RecordShift) =>
    [
      (recordCounts.get(recordKey(rec)) ?? 0) > 1
        ? "Possible duplicate in our records: same date, site, client, hours and rate. Review the imported shifts; both records are included."
        : "",
      (dayMinutes.get(rec.date) ?? 0) > 1440
        ? "Our records total more than 24 hours for this person on this date. Review the imported shifts."
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  const linkNote = (rec: RecordShift) =>
    rec.unlinked
      ? "This shift in our records is not linked to the staff member (found by NI, company ID or name). Link it in the Salary Sheet."
      : "";
  const recordsByDate = new Map<string, RecordShift[]>();
  for (const rec of args.records) {
    const list = recordsByDate.get(rec.date);
    if (list) list.push(rec);
    else recordsByDate.set(rec.date, [rec]);
  }
  const rowsByDate = new Map<string, SheetRowInput[]>();
  const unreadableDates = new Set<string>();
  for (const r of args.rows) {
    if (r.date === "" || r.hours === null) {
      if (r.date !== "") unreadableDates.add(r.date);
      answers.set(r.key, {
        key: r.key,
        result: "check_reading",
        recordHours: null,
        note: withParse(
          r,
          r.date === "" ? "The date could not be read." : "The hours could not be read.",
        ),
      });
      continue;
    }
    const list = rowsByDate.get(r.date);
    if (list) list.push(r);
    else rowsByDate.set(r.date, [r]);
  }

  for (const [date, sheetRows] of rowsByDate) {
    const recs = [...(recordsByDate.get(date) ?? [])];
    const pairs = new Map<number, RecordShift>();
    const takenRec = new Set<string>();
    const free = () => sheetRows.filter((r) => !pairs.has(r.key));
    const freeRecs = () => recs.filter((x) => !takenRec.has(x.id));
    const pair = (r: SheetRowInput, rec: RecordShift) => {
      pairs.set(r.key, rec);
      takenRec.add(rec.id);
    };
    const closest = (r: SheetRowInput, list: RecordShift[]): RecordShift | undefined => {
      let best: RecordShift | undefined;
      let bestDiff = Infinity;
      for (const rec of list) {
        const d = Math.abs(minutes(r.hours ?? 0) - minutes(rec.hours));
        if (d < bestDiff) {
          best = rec;
          bestDiff = d;
        }
      }
      return best;
    };
    const siteOk = (r: SheetRowInput, rec: RecordShift) =>
      sameSite(siteKeys(r.site, r.siteAlt), siteKeys(rec.siteName, rec.clientName));

    // 1. same site, same hours
    for (const r of free()) {
      const hit = freeRecs().find((rec) => siteOk(r, rec) && within(r.hours ?? 0, rec.hours));
      if (hit) pair(r, hit);
    }
    // 2. same site, closest hours
    for (const r of free()) {
      const hit = closest(
        r,
        freeRecs().filter((rec) => siteOk(r, rec)),
      );
      if (hit) pair(r, hit);
    }
    // 3. anything left, closest hours
    for (const r of free()) {
      const hit = closest(r, freeRecs());
      if (hit) pair(r, hit);
    }

    for (const r of sheetRows) {
      const rec = pairs.get(r.key);
      const sheetHours = r.hours ?? 0;
      if (!rec) {
        answers.set(r.key, {
          key: r.key,
          result: "not_in_records",
          recordHours: null,
          note: withParse(
            r,
            recs.length > 0
              ? "Our records have fewer shifts on this date than the sheet."
              : args.zeroHourDates?.has(date)
                ? "Our records have a shift on this date, but with 0 hours."
                : "No shift on this date in our records.",
          ),
        });
        continue;
      }
      const diff = round2(sheetHours - rec.hours);
      let result: RowResult;
      let note: string;
      if (within(sheetHours, rec.hours)) {
        result = "match";
        note = "";
      } else if (diff > 0) {
        result = "hours_over";
        note = `Sheet is ${fmt(diff)} higher than our record (${fmt(rec.hours)}).`;
      } else {
        result = "hours_under";
        note = `Sheet is ${fmt(-diff)} lower than our record (${fmt(rec.hours)}).`;
      }
      const sheetSite = siteKeys(r.site, r.siteAlt);
      if (sheetSite.length > 0 && !siteOk(r, rec)) {
        const where = rec.siteName || rec.clientName;
        if (where)
          note = `${note} The site on the sheet differs from our record (${where}).`.trim();
        const singleShiftDay = recs.length === 1 && sheetRows.length === 1;
        if (
          result === "match" &&
          (!singleShiftDay || SITE_DIFFERENCE_BLOCKS_MATCH_ON_SINGLE_SHIFT_DAY)
        ) {
          result = "check_reading";
        }
      }
      const linked = linkNote(rec);
      if (linked) note = `${note} ${linked}`.trim();
      const diagnostic = recordNote(rec);
      if (diagnostic) {
        note = [note, diagnostic].filter(Boolean).join(" ");
        if (result === "match") result = "check_reading";
      }
      // The sheet contradicts itself: never show a clean "match".
      if (r.uncertain && result === "match") result = "check_reading";
      answers.set(r.key, {
        key: r.key,
        result,
        recordHours: rec.hours,
        recordRate: rec.rate,
        recordId: rec.id,
        note: withParse(r, note),
      });
    }

    // Split shifts: the sheet may show one 8 h row where our records hold 4 h + 4 h
    // (or the other way round). When the number of rows differs and the day's TOTAL
    // agrees, the day is fine: each row gets its own hours back and nothing is
    // reported as missing. Duplicates never qualify (their totals differ), and any
    // row that is uncertain or unlinked is left alone. (Identical 4 h + 4 h records are normal here, so the "possible duplicate" note does not block it.)
    if (sheetRows.length !== recs.length && recs.length > 0) {
      const answered = sheetRows.map((r) => answers.get(r.key)!);
      const sheetTotal = sheetRows.reduce((t, r) => t + minutes(r.hours ?? 0), 0);
      const recTotal = recs.reduce((t, x) => t + minutes(x.hours), 0);
      const hasIssue =
        answered.some((a) => a.result !== "match") || recs.some((x) => !takenRec.has(x.id));
      const onlySizeIssues = answered.every(
        (a) =>
          a.result === "match" ||
          a.result === "hours_over" ||
          a.result === "hours_under" ||
          a.result === "not_in_records",
      );
      const clean =
        sheetRows.every((r) => !r.uncertain && !r.parseNote) && recs.every((x) => !x.unlinked);
      if (
        hasIssue &&
        onlySizeIssues &&
        clean &&
        sheetTotal > 0 &&
        Math.abs(sheetTotal - recTotal) <= HOURS_TOLERANCE_MINUTES
      ) {
        for (const r of sheetRows) {
          answers.set(r.key, {
            key: r.key,
            result: "match",
            recordHours: r.hours ?? 0,
            recordRate: pairs.get(r.key)?.rate ?? recs[0]?.rate ?? null,
            recordId: pairs.get(r.key)?.id ?? null,
            note: `Day total matches: ${sheetRows.length} sheet row(s), ${fmt(sheetTotal / 60)}, against ${recs.length} shift(s) in our records, ${fmt(recTotal / 60)}.`,
          });
        }
        for (const rec of recs) takenRec.add(rec.id);
      }
    }

    if (date.startsWith(args.month)) {
      for (const rec of recs) {
        if (takenRec.has(rec.id)) continue;
        missing.push({
          recordId: rec.id,
          date,
          site: rec.siteName || rec.clientName,
          recordHours: rec.hours,
          rate: rec.rate,
          note: [
            "Worked per our records, but not listed on the sheet.",
            recordNote(rec),
            linkNote(rec),
          ]
            .filter(Boolean)
            .join(" "),
        });
      }
    }
  }

  // Record dates the sheet has no row for at all.
  for (const [date, recs] of recordsByDate) {
    if (rowsByDate.has(date) || !date.startsWith(args.month)) continue;
    for (const rec of recs) {
      missing.push({
        recordId: rec.id,
        date,
        site: rec.siteName || rec.clientName,
        recordHours: rec.hours,
        rate: rec.rate,
        note: [
          unreadableDates.has(date)
            ? "Recorded shift could not be compared because the sheet hours are unreadable."
            : "Worked per our records, but not listed on the sheet.",
          recordNote(rec),
          linkNote(rec),
        ]
          .filter(Boolean)
          .join(" "),
      });
    }
  }
  missing.sort((a, b) => a.date.localeCompare(b.date));

  return { answers: args.rows.map((r) => answers.get(r.key)!), missing };
}

function withParse(r: SheetRowInput, note: string): string {
  return [note, r.parseNote].filter((x) => x.length > 0).join(" ");
}
