import { z } from "zod";
import { parseBankMatrix, parseMoney, parseUkDate, type ParsedStatement } from "../bankMatch/parse";
import { parseTimesheetMatrix } from "../timesheets/parseMatrix";
import type { ParsedFile } from "../timesheets/parsed";
export type DocumentKind = "timesheet" | "bank";
export const HEADERS = {
  timesheet: ["Date", "Site", "Start time", "End time", "Hours", "Rate", "Amount", "Expense"],
  bank: ["Date", "Description", "Paid in", "Paid out"],
};
export const extractionSchema = z
  .object({
    complete: z.boolean(),
    personName: z.string().max(120),
    personNi: z.string().max(20),
    statedHours: z.string().max(20),
    rows: z
      .array(z.array(z.string().max(300)).min(4).max(8))
      .min(1)
      .max(500),
    notes: z.array(z.string().max(300)).max(20),
  })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;
export const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["complete", "personName", "personNi", "statedHours", "rows", "notes"],
  properties: {
    complete: { type: "boolean" },
    personName: { type: "string" },
    personNi: { type: "string" },
    statedHours: { type: "string" },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    notes: { type: "array", items: { type: "string" } },
  },
};
export function validateExtraction(value: unknown, kind: DocumentKind): Extraction {
  const result = extractionSchema.safeParse(value);
  if (!result.success) throw new Error("AI returned an invalid document. Nothing was saved.");
  const d = result.data;
  if (!d.complete)
    throw new Error(
      "AI could not read the entire document. Use a clearer file or split it. Nothing was saved.",
    );
  if (d.rows.some((r) => r.length !== HEADERS[kind].length))
    throw new Error("AI returned inconsistent columns. Nothing was saved.");
  return d;
}
export type ReviewedDocument =
  { kind: "bank"; parsed: ParsedStatement } | { kind: "timesheet"; parsed: ParsedFile };
export function reviewedDocument(
  kind: DocumentKind,
  raw: Extraction,
  fileName: string,
  fileHash: string,
): ReviewedDocument {
  const d = validateExtraction(raw, kind);
  if (kind === "bank") {
    for (const [index, row] of d.rows.entries()) {
      const credit = parseMoney(row[2] ?? null),
        debit = parseMoney(row[3] ?? null);
      if (
        !parseUkDate(row[0] ?? null) ||
        !row[1]?.trim() ||
        [credit, debit].some((v) => v !== null && (!Number.isFinite(v) || v < 0)) ||
        ((credit ?? 0) > 0 && (debit ?? 0) > 0)
      )
        throw new Error(
          `Row ${index + 1}: check the date, description and separate money-in / money-out amounts.`,
        );
    }
    const p = parseBankMatrix([HEADERS.bank, ...d.rows]);
    if (p.problems.length) throw new Error(p.problems.slice(0, 3).join(" "));
    if (!p.lines.length) throw new Error("No incoming transactions were found.");
    if (p.lines.length + p.skippedOut !== d.rows.length)
      throw new Error("Every bank row needs an amount. Correct or remove blank rows.");
    return { kind, parsed: { ...p, fileName, fileHash } };
  }
  if (
    d.statedHours.trim() &&
    (!/^\d+(?:\.\d+)?$/.test(d.statedHours.trim()) || Number(d.statedHours) > 5000)
  )
    throw new Error("Correct the stated hours total or leave it blank if none is printed.");
  const matrix = [
    ["Full Name", d.personName],
    [],
    ["NI Number", d.personNi],
    [],
    HEADERS.timesheet,
    ...d.rows,
  ];
  if (d.statedHours.trim()) matrix.push(["Total Hours", d.statedHours]);
  const s = parseTimesheetMatrix(matrix, "");
  if (!s || s.rows.length !== d.rows.length || s.rows.some((r) => !r.date || r.hours === null))
    throw new Error(
      "Each timesheet row needs a readable date and hours. Correct or remove incomplete rows.",
    );
  s.format = /\.pdf$/i.test(fileName) ? "pdf" : "photo";
  s.warnings = [
    ...s.warnings,
    "AI extracted; the uploader reviewed the rows against the original document.",
    ...d.notes,
  ].slice(0, 20);
  return { kind, parsed: { fileName, fileHash, sheets: [s], problems: [] } };
}
