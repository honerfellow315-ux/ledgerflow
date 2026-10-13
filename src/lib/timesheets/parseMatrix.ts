import { normalizeDob } from "./identity";
/**
 * Reads ONE worksheet (a grid of cells) of the standard timesheet template:
 *
 *   [Name / NI number boxes somewhere above the table]
 *   site Name | Date | Site | Start time | End time | Duration | rate per hour | Amount | Expense (only fill if approved)
 *
 * It is tolerant on purpose: the header row is found by its labels (not by a fixed row
 * number), Name and NI are looked for above the table, empty and zero rows are ignored,
 * and the sheet's own "Total" line is read when there is one.
 *
 * Nothing here touches the browser or the server, so it can be tested on its own, and the
 * Phase C / D readers only have to produce the same ParsedSheet.
 *
 * Rules worth knowing:
 *  - A shift that crosses midnight (20:00 to 07:00) is 11 hours: when the end is earlier
 *    than the start, 24 hours are added to the end. Start equal to end is 0 hours.
 *  - Hours = the Duration cell when it is readable, otherwise end minus start. When both
 *    exist and disagree, the Duration is used and the row is marked "uncertain" so it is
 *    never shown as a clean match.
 *  - A cell that has something in it but cannot be read is NEVER turned into 0. The row is
 *    kept with hours = null and shown as "Check the reading".
 */
import { formatNi, isValidNi, normNi, round2 } from "../payroll/calc";
import type { ParsedRow, ParsedSheet } from "./parsed";

/** A cell as the reader hands it over. `clock` = minutes, from a time-formatted cell. */
export type TsCell = string | number | null | { clock: number; date?: string };
export type TsMatrix = TsCell[][];

/* ------------------------------ small readers ------------------------------ */

type Read<T> = { kind: "ok"; value: T } | { kind: "empty" } | { kind: "bad" };
const OK = <T>(value: T): Read<T> => ({ kind: "ok", value });
const EMPTY: Read<never> = { kind: "empty" };
const BAD: Read<never> = { kind: "bad" };

function textOf(c: TsCell | undefined): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "number") return String(c);
  if (typeof c === "string") return c.trim();
  return c.date ?? "";
}

const pad = (n: number) => String(n).padStart(2, "0");

function isoIfReal(y: number, m: number, d: number): string {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return "";
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return "";
  return `${y}-${pad(m)}-${pad(d)}`;
}

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function dateFromText(t: string): string {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(t);
  if (m) return isoIfReal(Number(m[1]), Number(m[2]), Number(m[3]));
  // UK order: day first.
  m = /^(?:[a-z]{3,9}\.?,?\s+)?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:$|\s)/i.exec(t);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoIfReal(y, Number(m[2]), Number(m[1]));
  }
  // "Mon 1 Sep 2026", "1st September 2026"
  m =
    /^(?:[a-z]{3,9}\.?,?\s+)?(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{2,4})$/i.exec(
      t,
    );
  if (m) {
    const mon = MONTH_NAMES.indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (mon < 0) return "";
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoIfReal(y, mon + 1, Number(m[1]));
  }
  // "Tuesday, September 1, 2026", "September 1st 2026" (month name first, as typed PDFs and Word often print it).
  m = /^(?:[a-z]{3,9}\.?,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(t);
  if (m) {
    const mon = MONTH_NAMES.indexOf(m[1]!.slice(0, 3).toLowerCase());
    if (mon < 0) return "";
    return isoIfReal(Number(m[3]), mon + 1, Number(m[2]));
  }
  return "";
}

export function readDate(c: TsCell | undefined): Read<string> {
  if (c === null || c === undefined) return EMPTY;
  if (typeof c === "object") {
    return c.date ? OK(c.date) : BAD;
  }
  if (typeof c === "number") {
    if (c < 20000 || c > 80000) return BAD;
    const d = new Date(Math.round((c - 25569) * 86400 * 1000));
    const iso = isoIfReal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    return iso ? OK(iso) : BAD;
  }
  const t = c.trim();
  if (!t) return EMPTY;
  const iso = dateFromText(t);
  return iso ? OK(iso) : BAD;
}

/** Time of day as minutes after midnight (0 to 1439). */
export function readClock(c: TsCell | undefined): Read<number> {
  if (c === null || c === undefined) return EMPTY;
  if (typeof c === "object") return OK(((Math.round(c.clock) % 1440) + 1440) % 1440);
  if (typeof c === "number") {
    if (c >= 0 && c < 1) return OK(Math.round(c * 1440) % 1440);
    if (Number.isInteger(c) && c >= 100 && c <= 2359 && c % 100 < 60) {
      return OK(Math.floor(c / 100) * 60 + (c % 100));
    }
    return BAD;
  }
  const t = c.trim().toLowerCase();
  if (!t) return EMPTY;
  let m = /^(\d{1,2})\s*[:.h]\s*(\d{2})(?::\d{2})?\s*(am|pm)?$/.exec(t);
  if (m) return clockFrom(Number(m[1]), Number(m[2]), m[3]);
  m = /^(\d{1,2})\s*(am|pm)$/.exec(t);
  if (m) return clockFrom(Number(m[1]), 0, m[2]);
  m = /^(\d{1,2})(\d{2})$/.exec(t);
  if (m) return clockFrom(Number(m[1]), Number(m[2]), undefined);
  return BAD;
}

function clockFrom(h: number, min: number, ampm: string | undefined): Read<number> {
  let hour = h;
  if (min > 59) return BAD;
  if (ampm) {
    if (hour < 1 || hour > 12) return BAD;
    if (ampm === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 24 || (hour === 24 && min !== 0)) return BAD;
  return OK((hour * 60 + min) % 1440);
}

/** A length of time in minutes ("12", "12.5", "12:30", "12h 30m", or a [h]:mm cell). */
function readLength(c: TsCell | undefined, maxHours: number): Read<number> {
  if (c === null || c === undefined) return EMPTY;
  if (typeof c === "object") {
    return c.clock >= 0 && c.clock <= maxHours * 60 ? OK(Math.round(c.clock)) : BAD;
  }
  if (typeof c === "number") {
    if (!Number.isFinite(c) || c < 0 || c > maxHours) return BAD;
    return OK(Math.round(c * 60));
  }
  const t = c.trim().toLowerCase();
  if (!t) return EMPTY;
  let m = /^(\d{1,3}):(\d{2})(?::\d{2})?$/.exec(t);
  if (m) {
    const min = Number(m[1]) * 60 + Number(m[2]);
    return Number(m[2]) < 60 && min <= maxHours * 60 ? OK(min) : BAD;
  }
  m = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    return h <= maxHours ? OK(Math.round(h * 60)) : BAD;
  }
  m = /^(\d+)\s*h(?:rs?|ours?)?\s*(\d+)\s*m(?:ins?|inutes?)?$/.exec(t);
  if (m) {
    const min = Number(m[1]) * 60 + Number(m[2]);
    return Number(m[2]) < 60 && min <= maxHours * 60 ? OK(min) : BAD;
  }
  return BAD;
}

/** Money / rate: a real number or text like "£10.50". Anything else is BAD, never 0. */
export function readMoney(c: TsCell | undefined): Read<number> {
  if (c === null || c === undefined) return EMPTY;
  if (typeof c === "object") return BAD;
  if (typeof c === "number") {
    return Number.isFinite(c) && c >= 0 && c <= 1_000_000 ? OK(round2(c)) : BAD;
  }
  const t = c
    .trim()
    .replace(/[£\s]/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
  if (!t) return EMPTY;
  if (!/^\d+(?:\.\d+)?$/.test(t)) return BAD;
  const n = Number(t);
  return n <= 1_000_000 ? OK(round2(n)) : BAD;
}

const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const hoursOf = (min: number) => round2(min / 60);

/* ------------------------------ header detection ------------------------------ */

type Col =
  "date" | "start" | "end" | "duration" | "rate" | "amount" | "expense" | "siteName" | "site";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function classify(label: string): Col | null {
  const h = squash(label);
  if (!h) return null;
  if (h === "date") return "date";
  if (h.startsWith("start") || h === "timein" || h === "in") return "start";
  if (h.startsWith("end") || h.startsWith("finish") || h === "timeout" || h === "out") return "end";
  if (
    h.startsWith("duration") ||
    [
      "hours",
      "hrs",
      "totalhours",
      "hoursworked",
      "workedhours",
      "totalhrs",
      "hoursworked",
    ].includes(h)
  ) {
    return "duration";
  }
  if (h.startsWith("rate")) return "rate";
  if (h === "amount" || h === "totalamount" || h === "pay") return "amount";
  if (h.startsWith("expense")) return "expense";
  if (h === "sitename") return "siteName";
  if (["site", "location", "venue", "siteaddress"].includes(h)) return "site";
  return null;
}

function findHeader(m: TsMatrix): { row: number; cols: Partial<Record<Col, number>> } | null {
  for (let i = 0; i < Math.min(m.length, 60); i++) {
    const cols: Partial<Record<Col, number>> = {};
    (m[i] ?? []).forEach((c, idx) => {
      const k = classify(textOf(c));
      if (k && cols[k] === undefined) cols[k] = idx;
    });
    if (
      cols.date !== undefined &&
      (cols.start !== undefined || cols.end !== undefined || cols.duration !== undefined)
    ) {
      return { row: i, cols };
    }
  }
  return null;
}

/* ------------------------------ name / NI above the table ------------------------------ */

const NAME_LABEL = /^(?:(?:staff|employee|guard|officer|full|your|sia)\s+)?name\b\s*[:-]?\s*(.*)$/i;
const NI_LABEL =
  /^(?:n\.?\s?i\.?n?\.?(?:\s*(?:number|no\.?|num))?|national\s+insurance(?:\s*(?:number|no\.?))?)(?=$|[\s:#\-.])\s*[:#\-.]?\s*(.*)$/i;

function valueNear(top: TsMatrix, r: number, c: number, inline: string): string {
  if (inline) return inline;
  const row = top[r] ?? [];
  for (let k = c + 1; k <= c + 6 && k < row.length; k++) {
    const t = textOf(row[k]);
    if (t) return t;
  }
  const below = textOf((top[r + 1] ?? [])[c]);
  return below;
}

function readPerson(top: TsMatrix): { name: string; ni: string; dob: string } {
  let name = "";
  let ni = "";
  let dob = "";
  for (let r = 0; r < top.length; r++) {
    const row = top[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const t = textOf(row[c]);
      if (!t || t.length > 80) continue;
      const birth = /^(?:date\s+of\s+birth|d\.?o\.?b\.?)\s*[:#-]?\s*(.*)$/i.exec(t);
      if (birth) {
        const raw = valueNear(top, r, c, (birth[1] ?? "").trim());
        // Unformatted Excel dates are serial days, only interpreted in a labelled DOB cell.
        const date = /^\d{4,5}$/.test(raw)
          ? new Date((Number(raw) - 25569) * 86400000).toISOString().slice(0, 10)
          : raw;
        dob = normalizeDob(date);
        continue;
      }
      if (!ni) {
        const m = NI_LABEL.exec(t);
        if (m) {
          const v = valueNear(top, r, c, (m[1] ?? "").trim());
          if (v && !NAME_LABEL.test(v) && !NI_LABEL.test(v)) ni = v;
          continue;
        }
      }
      if (!name) {
        const m = NAME_LABEL.exec(t);
        if (m) {
          const v = valueNear(top, r, c, (m[1] ?? "").trim());
          if (v && !NAME_LABEL.test(v) && !NI_LABEL.test(v) && !/^\d+(\.\d+)?$/.test(v)) {
            const split =
              /\s+(?:n\.?\s?i\.?n?\.?(?:\s*(?:number|no\.?|num))?|national\s+insurance(?:\s+number)?)\s*[:#]\s*(.*)$/i.exec(
                v,
              );
            name = split ? v.slice(0, split.index).trim() : v;
            if (split && !ni) ni = (split[1] ?? "").trim();
          }
        }
      }
    }
  }
  if (!ni) {
    // No "NI" label: accept a cell that is itself a valid NI number.
    for (const row of top) {
      for (const c of row) {
        const t = textOf(c);
        if (t && t.length <= 20 && isValidNi(t)) {
          ni = t;
          break;
        }
      }
      if (ni) break;
    }
  }
  return {
    name: name.replace(/\s+/g, " ").trim().slice(0, 120),
    ni: ni ? formatNi(ni).slice(0, 20) : "",
    dob,
  };
}

/* ------------------------------ the sheet's own total ------------------------------ */

const TOTAL_LABEL = /^(?:grand\s+|sub\s*)?total\b(.*)$/i;

function totalHoursFrom(
  row: TsCell[],
  labelAt: number,
  inline: string,
  durCol: number | undefined,
): number | null {
  const toHours = (c: TsCell | undefined): number | null => {
    const r = readLength(c, 2000);
    return r.kind === "ok" ? hoursOf(r.value) : null;
  };
  if (inline) {
    const m = /(\d+(?:[.:]\d+)?)/.exec(inline.replace(/,/g, ""));
    if (m) return toHours(m[1]);
  }
  if (durCol !== undefined && durCol !== labelAt) {
    const v = toHours(row[durCol]);
    if (v !== null) return v;
  }
  for (let i = labelAt + 1; i < row.length; i++) {
    const v = toHours(row[i]);
    if (v !== null) return v;
  }
  return null;
}

/* ------------------------------ the parser ------------------------------ */

/** Returns null when this worksheet has no timesheet table (no header row found). */
export function parseTimesheetMatrix(matrix: TsMatrix, sheetLabel: string): ParsedSheet | null {
  const head = findHeader(matrix);
  if (!head) return null;
  const { cols } = head;
  const warnings: string[] = [];
  const person = readPerson(matrix.slice(0, head.row));

  const rows: ParsedRow[] = [];
  let labelledTotal: number | null = null;
  let unlabelledTotal: number | null = null;
  let zeroRows = 0;
  let ignoredRows = 0;

  for (const raw of matrix.slice(head.row + 1)) {
    const row = raw ?? [];
    const filled = row.filter((c) => textOf(c) !== "" || (typeof c === "object" && c !== null));
    if (filled.length === 0) continue;

    const cell = (k: Col): TsCell | undefined =>
      cols[k] === undefined ? undefined : row[cols[k]!];
    const dateR = readDate(cell("date"));

    // A "Total" line: the sheet's own total, never a shift. A row with a real date is always
    // a shift, even when its site is called "Total Security Ltd".
    const firstText = row.map((c) => textOf(c)).find((t) => t !== "") ?? "";
    const labelAt = row.findIndex((c) => textOf(c) !== "");
    const tl = dateR.kind === "ok" ? null : TOTAL_LABEL.exec(firstText);
    if (tl) {
      const rest = (tl[1] ?? "").trim().replace(/^[:-]\s*/, "");
      const moneyLabel = /amount|pay|£|expense/i.test(rest);
      if (!moneyLabel && labelledTotal === null) {
        labelledTotal = totalHoursFrom(row, labelAt, /^\d/.test(rest) ? rest : "", cols.duration);
      }
      continue;
    }

    const startR = readClock(cell("start"));
    const endR = readClock(cell("end"));
    const durR = readLength(cell("duration"), 48);
    const rateR = readMoney(cell("rate"));
    const amountR = readMoney(cell("amount"));
    const expenseR = readMoney(cell("expense"));
    const site = textOf(cell("site"));
    const siteName = textOf(cell("siteName"));

    // A line with only a number under Duration (and nothing else) is the sheet's total.
    const onlyNumbers =
      dateR.kind === "empty" &&
      startR.kind === "empty" &&
      endR.kind === "empty" &&
      !site &&
      !siteName;
    if (onlyNumbers) {
      const probe = readLength(cell("duration"), 2000);
      if (probe.kind === "ok") {
        if (unlabelledTotal === null) unlabelledTotal = hoursOf(probe.value);
        continue;
      }
    }

    const minutesFromTimes =
      startR.kind === "ok" && endR.kind === "ok"
        ? endR.value >= startR.value
          ? endR.value - startR.value
          : endR.value + 1440 - startR.value
        : null;

    let hoursMin: number | null = null;
    if (durR.kind === "ok") hoursMin = durR.value;
    else if (minutesFromTimes !== null) hoursMin = minutesFromTimes;

    const money = (r: Read<number>) => (r.kind === "ok" ? r.value : null);
    const amount = money(amountR);
    const expense = money(expenseR);

    const unreadableHours =
      hoursMin === null && (durR.kind === "bad" || startR.kind === "bad" || endR.kind === "bad");
    const hasMoney = (amount ?? 0) > 0 || (expense ?? 0) > 0;

    // Keep a row only when it has a real date, or real hours: otherwise it is a hint line,
    // a signature line or an empty template row.
    if (dateR.kind !== "ok" && !(hoursMin !== null && hoursMin > 0)) {
      if (dateR.kind === "bad" || unreadableHours) ignoredRows++;
      continue;
    }
    // Zero rows (a date with no hours and no money) are ignored.
    if (!unreadableHours && (hoursMin === null || hoursMin === 0) && !hasMoney) {
      zeroRows++;
      continue;
    }

    const notes: string[] = [];
    let uncertain = false;
    if (dateR.kind !== "ok") {
      notes.push("The date could not be read.");
      uncertain = true;
    }
    if (hoursMin === null) {
      notes.push("The hours could not be read.");
      uncertain = true;
    } else if (durR.kind === "bad" && minutesFromTimes !== null) {
      notes.push(
        `The Duration cell could not be read, so ${hoursOf(minutesFromTimes)} h was worked out from start and end.`,
      );
      uncertain = true;
    } else if (
      durR.kind === "ok" &&
      minutesFromTimes !== null &&
      hoursOf(durR.value) !== hoursOf(minutesFromTimes)
    ) {
      notes.push(
        `Duration says ${hoursOf(durR.value)} h but start and end give ${hoursOf(minutesFromTimes)} h.`,
      );
      uncertain = true;
    }
    if (rateR.kind === "bad") notes.push("The rate could not be read.");
    if (amountR.kind === "bad") notes.push("The amount could not be read.");
    if (expenseR.kind === "bad") notes.push("The expense could not be read.");

    rows.push({
      date: dateR.kind === "ok" ? dateR.value : "",
      site: (site || siteName).slice(0, 200),
      siteAlt: (site && siteName && siteName !== site ? siteName : "").slice(0, 200),
      start: startR.kind === "ok" ? hhmm(startR.value) : "",
      end: endR.kind === "ok" ? hhmm(endR.value) : "",
      hours: hoursMin === null ? null : hoursOf(hoursMin),
      rate: money(rateR),
      amount,
      expense,
      uncertain,
      note: notes.join(" "),
    });
  }

  if (zeroRows > 0)
    warnings.push(
      `${zeroRows} row${zeroRows === 1 ? "" : "s"} with no hours ${zeroRows === 1 ? "was" : "were"} ignored.`,
    );
  if (ignoredRows > 0)
    warnings.push(
      `${ignoredRows} row${ignoredRows === 1 ? "" : "s"} with no usable date or hours ${ignoredRows === 1 ? "was" : "were"} ignored.`,
    );
  if (!person.name && !person.ni) {
    warnings.push(
      "No name or NI number was found above the table, so this person cannot be matched yet.",
    );
  } else if (person.ni && !isValidNi(person.ni)) {
    warnings.push(
      "The NI number on the sheet does not look valid (2 letters, 6 digits, then A to D). Check for typos.",
    );
  }
  if (normNi(person.ni).length === 0 && person.name) {
    warnings.push(
      "The sheet has no NI number. Use Correct identity to add it so the person can be matched.",
    );
  }

  return {
    format: "excel",
    sheetLabel,
    personName: person.name,
    personNi: person.ni,
    personDob: person.dob,
    statedHours: labelledTotal ?? unlabelledTotal,
    rows,
    warnings,
  };
}
