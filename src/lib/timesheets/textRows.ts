/**
 * Typed PDF and Word timesheets: lines of text -> the same grid (TsMatrix) the Excel reader
 * makes, so parseTimesheetMatrix still does the real work (dates, hours, shifts that cross
 * midnight, and "an unreadable cell is never turned into 0").
 *
 * Pure functions only: no browser, no library, so they can be tested on their own.
 *
 * What it expects is the standard template printed to PDF or written in Word:
 *
 *   Full Name / NI Number somewhere above the table
 *   Sr No | Date | Site | Start time | End time | Hours | Rate | Amount | Expense
 *   1 Tuesday, September 1, 2026 SITE NAME 20:00 7:00 11 £10.00 £110.00
 *
 * A row is found by its DATE (after an optional serial number) and its two times. Money in
 * the standard template carries a "£"; that is how Hours, Rate, Amount and Expense are told
 * apart when a cell is empty. Anything that cannot be told apart is handed over as "?" so the
 * parser marks it "Check the reading" instead of guessing.
 */
import type { TsCell, TsMatrix } from "./parseMatrix";

const C = {
  serial: 0,
  date: 1,
  site: 2,
  start: 3,
  end: 4,
  hours: 5,
  rate: 6,
  amount: 7,
  expense: 8,
} as const;
const HEADER: TsCell[] = [
  "Sr No",
  "Date",
  "Site",
  "Start time",
  "End time",
  "Hours",
  "Rate",
  "Amount",
  "Expense",
];
const WIDTH = HEADER.length;

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+";
const DATE_RE = new RegExp(
  `^(?:${WEEKDAY})?(?:` +
    `${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}` + // September 1, 2026
    `|\\d{1,2}(?:st|nd|rd|th)?[\\s-]+${MONTH}\\.?,?[\\s-]+\\d{2,4}` + // 1 September 2026
    `|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}` + // 01/09/2026
    `|\\d{4}-\\d{2}-\\d{2}` + // 2026-09-01
    `)(?![\\d:;])`,
  "i",
);
const TIME_PAIR = /(\d{1,2}[:;]\d{2})\s*(?:-|–|to)?\s*(\d{1,2}[:;]\d{2})/i;
const DATE_ANY_RE = new RegExp(DATE_RE.source.replace(/^\^/, ""), "i");
const YEARLESS_DATE_RE = new RegExp(
  `(?<!\\d)\\d{1,2}(?:st|nd|rd|th)?[\\s-]+${MONTH}(?![a-z])`,
  "i",
);
export function needsDateYear(lines: string[]): boolean {
  return lines.some(
    (line) => TIME_PAIR.test(line) && !DATE_ANY_RE.test(line) && YEARLESS_DATE_RE.test(line),
  );
}

const isPound = (t: string) => /^£\d[\d,]*(?:\.\d+)?$/.test(t);
const isNumberish = (t: string) =>
  /^\d[\d,]*(?:\.\d+)?$/.test(t) || /^\d{1,3}:\d{2}$/.test(t) || /^\d+(?:\.\d+)?h$/i.test(t);

const tidy = (s: string) => s.replace(/£\s+/g, "£").replace(/\s+/g, " ").trim();

/* ------------------------------ one shift line ------------------------------ */

/** The order Hours / Rate / Amount / Expense appear in the sheet's own header line. */
function columnOrder(header: string): number[] {
  const at = (re: RegExp) => {
    const m = re.exec(header);
    return m ? m.index : -1;
  };
  const found = [
    { col: C.hours, pos: at(/\b(?:hours?|hrs|duration)\b/i) },
    { col: C.rate, pos: at(/\brate\b/i) },
    { col: C.amount, pos: at(/\bamount\b/i) },
    { col: C.expense, pos: at(/\bexpenses?\b/i) },
  ]
    .filter((f) => f.pos >= 0)
    .sort((a, b) => a.pos - b.pos)
    .map((f) => f.col as number);
  return found.length > 0 ? found : [C.hours, C.rate, C.amount, C.expense];
}

export function parseShiftLine(
  raw: string,
  order: number[] = [C.hours, C.rate, C.amount, C.expense],
  confirmedYear?: number,
): TsCell[] | null {
  const s = tidy(raw);
  const serial = /^(\d{1,3})\s+(?=\S)/.exec(s);
  let serialText = "";
  let rest = s;
  let dm: RegExpExecArray | null = null;
  if (serial) {
    dm = DATE_RE.exec(s.slice(serial[0].length));
    if (dm) {
      serialText = serial[1]!;
      rest = s.slice(serial[0].length);
    }
  }
  if (!dm) dm = DATE_RE.exec(s);
  let sitePrefix = "";
  let yearless = false;
  if (!dm) {
    // Site-first rows need a time pair to distinguish them from dated footer notes.
    if (!TIME_PAIR.test(s)) return null;
    dm = DATE_ANY_RE.exec(s);
    if (!dm) {
      dm = YEARLESS_DATE_RE.exec(s);
      yearless = !!dm;
    }
    if (dm) {
      sitePrefix = s.slice(0, dm.index).trim();
      rest = s.slice(dm.index);
    }
  }
  if (!dm) return null;

  const row: TsCell[] = new Array<TsCell>(WIDTH).fill(null);
  if (serialText) row[C.serial] = serialText;
  row[C.date] = dm[0].trim() + (yearless && confirmedYear ? ` ${confirmedYear}` : "");
  const after = rest.slice(dm[0].length).trim();

  const tm = TIME_PAIR.exec(after);
  if (!tm) {
    // A dated line with no readable times: keep it, flagged, never dropped.
    row[C.site] = after.slice(0, 200) || null;
    row[C.hours] = "?";
    return row;
  }
  row[C.site] =
    [sitePrefix, after.slice(0, tm.index).trim()].filter(Boolean).join(" / ").slice(0, 200) || null;
  row[C.start] = tm[1]!.replace(";", ":");
  row[C.end] = tm[2]!.replace(";", ":");

  const tokens = after
    .slice(tm.index + tm[0].length)
    .trim()
    .split(" ")
    .filter(Boolean);
  const firstPound = tokens.findIndex(isPound);
  if (firstPound >= 0) {
    if (firstPound > 0) row[C.hours] = tokens[0]!;
    let i = firstPound;
    const pounds: string[] = [];
    while (i < tokens.length && isPound(tokens[i]!)) pounds.push(tokens[i++]!);
    if (pounds.length === 1) {
      // One "£" figure alone: Rate or Amount? Do not guess.
      row[C.rate] = "?";
      row[C.amount] = "?";
    } else {
      row[C.rate] = pounds[0]!;
      row[C.amount] = pounds[1]!;
      if (pounds.length >= 3) row[C.expense] = pounds[2]!;
    }
    const post = tokens.slice(i);
    if (row[C.expense] === null && post.length > 0 && isNumberish(post[0]!))
      row[C.expense] = post[0]!;
  } else {
    tokens.slice(0, order.length).forEach((t, k) => {
      row[order[k]!] = t;
    });
  }
  return row;
}

/* ------------------------------ name / NI above the table ------------------------------ */

const LABELS =
  "full name|staff name|employee name|guard name|your name|site name|company name|client name|business name|account name|account title|account number|account no\\.?|name|" +
  "date of birth|d\\.?o\\.?b\\.?|national insurance(?: number| no\\.?)?|n\\.?\\s?i\\.?(?: number| no\\.?| num)?|" +
  "sia badge(?: no\\.?| number)?|sia licen[cs]e(?: no\\.?| number)?|sort code|expiry date|address|phone|mobile|email|note";
const NAME_LABELS = /^(?:full name|staff name|employee name|guard name|your name|name)$/i;
const NI_LABELS =
  /^(?:national insurance(?: number| no\.?)?|n\.?\s?i\.?(?: number| no\.?| num)?)$/i;
const NI_TOKEN = /\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/i;

export function topRows(lines: string[]): TsMatrix {
  let name = "";
  let ni = "";
  let dob = "";
  const labelRe = new RegExp(`\\b(${LABELS})\\b[\\s:#.\\-]*`, "gi");
  for (const line of lines) {
    const text = tidy(line);
    const hits = [...text.matchAll(labelRe)];
    hits.forEach((h, k) => {
      const label = h[1]!.trim();
      const from = h.index! + h[0].length;
      const to = k + 1 < hits.length ? hits[k + 1]!.index! : text.length;
      const value = text.slice(from, to).trim();
      if (!value) return;
      if (!dob && /^(?:date of birth|d\.?o\.?b\.?)$/i.test(label)) dob = value;
      if (!name && NAME_LABELS.test(label)) name = value;
      else if (!ni && NI_LABELS.test(label)) ni = NI_TOKEN.exec(value)?.[0] ?? value.slice(0, 20);
    });
    if (!ni) ni = NI_TOKEN.exec(text)?.[0] ?? "";
  }
  // A blank row after each pair stops the parser reading the next line as a missing value.
  const out: TsMatrix = [
    ["Full Name:", name || null],
    [],
    ["NI Number:", ni || null],
    [],
    ["Date of birth:", dob || null],
    [],
  ];
  return out;
}

/* ------------------------------ the sheet's own total ------------------------------ */

export function totalRows(lines: string[]): TsMatrix {
  for (const l of lines) {
    const m =
      /total\s+(?:hours?|hrs?)(?:\s+worked)?\s*[:-]?\s*(\d[\d,]*(?:\.\d+)?(?::\d{2})?)/i.exec(
        tidy(l),
      );
    if (m) return [["Total Hours", m[1]!.replace(/,/g, "")]];
  }
  return [];
}

/* ------------------------------ whole document ------------------------------ */

const isHeaderLine = (l: string) =>
  /\bdate\b/i.test(l) && /\bstart\b/i.test(l) && /\b(?:end|finish)\b/i.test(l);

/** Returns null when no timesheet header line is found. */
export function linesToMatrix(all: string[], confirmedYear?: number): TsMatrix | null {
  const lines = all.map(tidy).filter(Boolean);
  const h = lines.findIndex(isHeaderLine);
  if (h < 0) return null;
  const order = columnOrder(lines[h]!);
  const below = lines.slice(h + 1);
  const rows: TsMatrix = [];
  for (const l of below) {
    const r = parseShiftLine(l, order, confirmedYear);
    if (r) rows.push(r);
  }
  return [...topRows(lines.slice(0, h)), HEADER, ...rows, ...totalRows(below)];
}
