/**
 * parseTimesheetFile(file) -> ParsedFile
 *
 * The one entry point for reading a timesheet. Phase B handles Excel (.xlsx) and CSV.
 * Phase C (typed PDF / Word) and Phase D (photos, AI) add their own branch below and
 * return the same ParsedFile, so nothing else in the app has to change.
 *
 * Runs in the browser (like the shift import), so a big file never has to travel to the
 * server: only the small, already-read result does. exceljs is loaded on demand.
 */
import {
  MAX_FILE_BYTES,
  MAX_ROWS_PER_SHEET,
  MAX_SHEETS_PER_FILE,
  type ParsedFile,
  type ParsedSheet,
} from "./parsed";
import { parseTimesheetMatrix, type TsCell, type TsMatrix } from "./parseMatrix";
import type { SheetFormat } from "./data";
import { pdfToLines } from "./readPdf";
import { wordToMatrix } from "./readWord";
import { linesToMatrix, needsDateYear } from "./textRows";

const NO_TABLE =
  "No timesheet table found. The sheet needs a header row with Date, Start time, End time and Duration.";

export const TIMESHEET_EXTENSIONS = ["xlsx", "csv", "pdf", "docx"] as const;

export function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------ CSV ------------------------------ */

function csvToMatrix(text: string): TsMatrix {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim =
    count("\t") > count(",") && count("\t") > count(";")
      ? "\t"
      : count(";") > count(",")
        ? ";"
        : ",";
  const rows: TsMatrix = [];
  let row: TsCell[] = [];
  let field = "";
  let quoted = false;
  const push = () => {
    row.push(field === "" ? null : field);
    field = "";
  };
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) push();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      push();
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    push();
    rows.push(row);
  }
  return rows;
}

/* ------------------------------ Excel ------------------------------ */

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * exceljs cell value -> TsCell. Unlike the shift import, time-of-day cells are KEPT here
 * (as minutes), because start / end / duration are exactly what a timesheet is about.
 * Formulas give their last calculated value.
 */
function plainCell(v: unknown, numFmt: string | undefined): TsCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    // A plain number that the sheet shows as a time (h:mm, [h]:mm) is a fraction of a day.
    const fmt = (numFmt ?? "").replace(/"[^"]*"/g, "");
    if (/h/i.test(fmt) && !/[dy]/i.test(fmt)) return { clock: Math.round(v * 1440) };
    return v;
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) {
    const serial = v.getTime() / 86400000 + 25569; // Excel serial day number
    if (Number.isNaN(serial)) return null;
    if (v.getUTCFullYear() < 1901) return { clock: Math.round(serial * 1440) };
    const clock = v.getUTCHours() * 60 + v.getUTCMinutes();
    return {
      clock,
      date: `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`,
    };
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return plainCell(o["result"], numFmt);
    if (Array.isArray(o["richText"])) {
      return (o["richText"] as { text?: string }[]).map((t) => t.text ?? "").join("");
    }
    if (typeof o["text"] === "string") return o["text"];
  }
  return null;
}

async function excelSheets(buf: ArrayBuffer): Promise<{ name: string; matrix: TsMatrix }[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out: { name: string; matrix: TsMatrix }[] = [];
  wb.eachSheet((ws) => {
    const matrix: TsMatrix = [];
    const cols = ws.columnCount;
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const cells: TsCell[] = [];
      for (let c = 1; c <= cols; c++) {
        const cell = row.getCell(c);
        cells.push(plainCell(cell.value, cell.numFmt));
      }
      matrix[r - 1] = cells;
    });
    for (let i = 0; i < matrix.length; i++) if (!matrix[i]) matrix[i] = [];
    out.push({ name: ws.name, matrix });
  });
  return out;
}

/* ------------------------------ entry point ------------------------------ */

export async function parseTimesheetFile(file: File, confirmedYear?: number): Promise<ParsedFile> {
  const result: ParsedFile = { fileName: file.name, fileHash: "", sheets: [], problems: [] };
  const ext = fileExtension(file.name);
  if (
    confirmedYear !== undefined &&
    (!Number.isInteger(confirmedYear) || confirmedYear < 2000 || confirmedYear > 2100)
  ) {
    result.problems.push("Enter a year between 2000 and 2100 for dates without a year.");
    return result;
  }
  let yearAdded = false;

  if (file.size === 0) {
    result.problems.push("The file is empty.");
    return result;
  }
  if (file.size > MAX_FILE_BYTES) {
    result.problems.push(`The file is bigger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`);
    return result;
  }

  const buf = await file.arrayBuffer();
  result.fileHash = await sha256Hex(buf);

  let grids: { name: string; matrix: TsMatrix; single: boolean }[];
  let format: SheetFormat = "excel";
  if (ext === "csv") {
    grids = [{ name: "", matrix: csvToMatrix(new TextDecoder("utf-8").decode(buf)), single: true }];
  } else if (ext === "xlsx") {
    try {
      const sheets = await excelSheets(buf);
      const isReceipt = sheets.some(
        (s) =>
          s.name === "Summary" &&
          (s.matrix[0] ?? []).includes("Hours on sheet") &&
          (s.matrix[0] ?? []).includes("Hours in our records"),
      );
      if (isReceipt) {
        result.problems.push(
          "This is a Timesheet Check report, not the original timesheet. Upload the staff member's original Excel or PDF timesheet instead.",
        );
        return result;
      }
      grids = sheets.map((s) => ({ ...s, single: sheets.length === 1 }));
    } catch {
      result.problems.push(
        "This file could not be opened. Is it a damaged or password protected Excel file?",
      );
      return result;
    }
  } else if (ext === "pdf") {
    format = "pdf";
    let text: { lines: string[]; chars: number };
    try {
      text = await pdfToLines(buf);
    } catch (e) {
      const why = e instanceof Error ? `${e.name} ${e.message}` : "";
      result.problems.push(
        /password/i.test(why)
          ? "This PDF is password protected."
          : "This PDF could not be opened. Is the file damaged?",
      );
      return result;
    }
    if (text.chars < 20) {
      result.problems.push(
        "This PDF has no typed text. It looks like a scan or a photo. Use the Read photo / scanned PDF with AI button.",
      );
      return result;
    }
    yearAdded = needsDateYear(text.lines);
    if (yearAdded && confirmedYear === undefined) {
      result.problems.push(
        "This PDF has dates without a year. Enter the correct year in the upload dialog, then check it again. Dates already containing a year will stay unchanged.",
      );
      return result;
    }
    const matrix = linesToMatrix(text.lines, confirmedYear);
    if (!matrix) {
      result.problems.push(NO_TABLE);
      return result;
    }
    grids = [{ name: "", matrix, single: true }];
  } else if (ext === "docx") {
    format = "word";
    let matrix: TsMatrix | null;
    try {
      matrix = await wordToMatrix(buf);
    } catch {
      result.problems.push("This Word file could not be opened. Is the file damaged?");
      return result;
    }
    if (!matrix) {
      result.problems.push(NO_TABLE);
      return result;
    }
    grids = [{ name: "", matrix, single: true }];
  } else if (ext === "xls") {
    result.problems.push(
      "Old .xls files are not supported. Open it in Excel and save it as .xlsx.",
    );
    return result;
  } else if (ext === "doc") {
    result.problems.push("Old .doc files are not supported. Open it in Word and save it as .docx.");
    return result;
  } else {
    // Phase D (photos, scans) plugs in here.
    result.problems.push(
      "This file type is not supported yet. Use Excel (.xlsx), CSV, a typed PDF or Word (.docx). Use the AI reading button for photos.",
    );
    return result;
  }

  const found: ParsedSheet[] = [];
  const skipped: string[] = [];
  for (const g of grids) {
    const parsed = parseTimesheetMatrix(g.matrix, g.single ? "" : g.name);
    if (!parsed) {
      if (!g.single) skipped.push(g.name);
      continue;
    }
    if (parsed.rows.length === 0) {
      skipped.push(g.name || "the sheet");
      continue;
    }
    if (parsed.rows.length > MAX_ROWS_PER_SHEET) {
      result.problems.push(
        `${g.name || "The sheet"} has more than ${MAX_ROWS_PER_SHEET} shifts, which is not a normal timesheet. It was not read.`,
      );
      continue;
    }
    parsed.format = format;
    if (yearAdded)
      parsed.warnings.unshift(
        `Year ${confirmedYear} was supplied by the uploader for PDF dates without a year.`,
      );
    if (format !== "excel") {
      parsed.warnings.unshift(
        `Read from the ${format === "pdf" ? "PDF" : "Word file"} text. The rows are rebuilt from the text, so check the figures against the original file.`,
      );
    }
    found.push(parsed);
  }

  if (found.length > MAX_SHEETS_PER_FILE) {
    result.problems.push(
      `The file has more than ${MAX_SHEETS_PER_FILE} timesheets. Only the first ${MAX_SHEETS_PER_FILE} were read.`,
    );
    found.length = MAX_SHEETS_PER_FILE;
  }
  result.sheets = found;
  if (found.length === 0 && result.problems.length === 0) {
    result.problems.push(
      skipped.length > 0 ? "The timesheet table has no shifts with hours in it." : NO_TABLE,
    );
  } else if (skipped.length > 0 && found.length > 0) {
    result.problems.push(`Skipped (no shifts found): ${skipped.join(", ")}.`);
  }
  return result;
}
