import type { ParsedFile } from "@/lib/timesheets/parsed";
import { Input } from "@/components/ui/input";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { AiDocumentDialog } from "@/components/app/AiDocumentDialog";
import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, X } from "@/lib/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pill, SheetStatusBadge, type Tone } from "@/components/app/timesheets/badges";
import { uploadTimesheetFile } from "@/lib/actions/timesheets";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import { fileExtension, parseTimesheetFile } from "@/lib/timesheets/parseFile";
import type { UploadOutcome } from "@/lib/timesheets/listTypes";

/* ---------------------------------------------------------------- upload */

function readMode(name: string): { label: string; tone: Tone; supported: boolean } {
  const ext = fileExtension(name);
  if (ext === "xlsx" || ext === "csv")
    return { label: "Read exactly", tone: "good", supported: true };
  if (ext === "pdf") return { label: "Read from the typed text", tone: "good", supported: true };
  if (ext === "docx") return { label: "Read from the document", tone: "good", supported: true };
  if (ext === "xls") return { label: "Save as .xlsx first", tone: "bad", supported: false };
  if (ext === "doc") return { label: "Save as .docx first", tone: "bad", supported: false };
  if (["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) {
    return { label: "Use the AI reading button", tone: "bad", supported: false };
  }
  return { label: "Not supported", tone: "bad", supported: false };
}

interface FileRun {
  state: "waiting" | "reading" | "checking" | "done" | "failed";
  /** One line per timesheet found in the file. */
  outcomes: UploadOutcome[];
  draft?: ParsedFile;
  /** Why the file could not be used, or extra notes about it. */
  message: string;
}

const WAITING: FileRun = { state: "waiting", outcomes: [], message: "" };

function OutcomeLine({
  o,
  onOpenExisting,
}: {
  o: UploadOutcome;
  onOpenExisting?: ((id: string, month: string) => void) | undefined;
}) {
  if (o.outcome === "saved" && o.status) {
    return (
      <li className="flex flex-wrap items-center gap-2">
        <SheetStatusBadge status={o.status} />
        <span className="text-foreground">
          {o.staffName || o.label} · {formatMonthLabel(o.month)}
        </span>
        <span className="text-muted-foreground">
          {o.issues === 0 ? "everything matches" : `${o.issues} to look at`}
        </span>
        {o.matchedBy === "name" ? <Pill tone="warn">Name only: please confirm</Pill> : null}
        {o.message ? <span className="w-full text-muted-foreground">{o.message}</span> : null}
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Pill tone={o.outcome === "duplicate" ? "warn" : "bad"}>
        {o.outcome === "duplicate" ? "Already uploaded" : "Not saved"}
      </Pill>
      <span className="text-muted-foreground">{o.message}</span>
      {o.outcome === "duplicate" && o.sheetId && onOpenExisting ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenExisting(o.sheetId!, o.month)}
        >
          Open existing sheet
        </Button>
      ) : null}
    </li>
  );
}

export function UploadTimesheetDialog({
  open,
  onOpenChange,
  onSaved,
  onOpenExisting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the month (yyyy-mm) of the last sheet that was saved. */
  onSaved?: (month: string) => void;
  onOpenExisting?: ((id: string, month: string) => void) | undefined;
}) {
  const qc = useQueryClient();
  const [dateYear, setDateYear] = useState("");
  const [mixedReview, setMixedReview] = useState(false);
  const [allowMixedMonths, setAllowMixedMonths] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [runs, setRuns] = useState<FileRun[]>([]);
  const [over, setOver] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const lastMonth = useRef("");
  const active = useRef(false);
  const drafts = useRef(new Map<File, ParsedFile>());
  const completed = useRef(new Map<File, Map<number, UploadOutcome>>());
  const clearDrafts = () => {
    drafts.current.clear();
    completed.current.clear();
  };
  const editPerson = (
    file: File,
    index: number,
    sheetIndex: number,
    field: "personName" | "personNi" | "personDob",
    value: string,
  ) => {
    const draft = drafts.current.get(file);
    if (!draft || active.current) return;
    const next = {
      ...draft,
      sheets: draft.sheets.map((sheet, i) =>
        i === sheetIndex ? { ...sheet, [field]: value } : sheet,
      ),
    };
    drafts.current.set(file, next);
    setRun(index, { draft: next });
    setFinished(false);
  };

  const add = (list: FileList | null) => {
    setAllowMixedMonths(false);
    setMixedReview(false);
    if (!list || running) return;
    if (finished) {
      clearDrafts();
      setFiles([]);
      setRuns([]);
      setFinished(false);
      setDateYear("");
      setAllowMixedMonths(false);
      setMixedReview(false);
    }
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };
  const close = (next: boolean) => {
    if (running) return; // let the files finish first
    if (!next) {
      clearDrafts();
      setDateYear("");
      setMixedReview(false);
      setAllowMixedMonths(false);
      setFiles([]);
      setRuns([]);
      setFinished(false);
    }
    onOpenChange(next);
  };
  const supported = files.filter((f) => drafts.current.has(f) || readMode(f.name).supported);

  const setRun = (i: number, patch: Partial<FileRun>) =>
    setRuns((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function run() {
    if (active.current) return;
    active.current = true;
    const list = [...files];
    setRuns(list.map(() => ({ ...WAITING })));
    setRunning(true);
    setFinished(false);
    lastMonth.current = "";
    let saved = 0;
    let allSucceeded = true;
    for (let i = 0; i < list.length; i++) {
      const file = list[i]!;
      if (!drafts.current.has(file) && !readMode(file.name).supported) {
        allSucceeded = false;
        setRun(i, { state: "failed", message: readMode(file.name).label });
        continue;
      }
      try {
        setRun(i, { state: "reading" });
        const parsed =
          drafts.current.get(file) ??
          (await parseTimesheetFile(file, dateYear.trim() ? Number(dateYear) : undefined));
        if (parsed.sheets.length === 0) {
          allSucceeded = false;
          setRun(i, {
            state: "failed",
            message: parsed.problems.join(" ") || "Nothing could be read.",
          });
          continue;
        }
        drafts.current.set(file, parsed);
        setRun(i, { draft: parsed });
        const monthCounts = new Map<string, number>();
        for (const sheet of parsed.sheets)
          for (const row of sheet.rows) {
            if (row.date)
              monthCounts.set(
                row.date.slice(0, 7),
                (monthCounts.get(row.date.slice(0, 7)) ?? 0) + 1,
              );
          }
        if (
          parsed.sheets.some(
            (sheet) =>
              new Set(sheet.rows.filter((r) => r.date).map((r) => r.date.slice(0, 7))).size > 1,
          ) &&
          !allowMixedMonths
        ) {
          allSucceeded = false;
          setMixedReview(true);
          setRun(i, {
            state: "failed",
            message: `This sheet contains dates from ${[...monthCounts].map(([m, n]) => `${formatMonthLabel(m)} (${n} rows)`).join(", ")}. Check the source file. Confirm below only if these dates are intentional. Existing dates will not be changed.`,
          });
          continue;
        }
        setRun(i, { state: "checking" });
        const done = completed.current.get(file) ?? new Map<number, UploadOutcome>();
        completed.current.set(file, done);
        const pending = parsed.sheets
          .map((sheet, index) => ({ sheet, index }))
          .filter(({ index }) => !done.has(index));
        const newOutcomes = pending.length
          ? await unwrap(
              uploadTimesheetFile({
                data: {
                  fileName: file.name,
                  fileHash: parsed.fileHash,
                  sheets: pending.map(({ sheet }) => sheet),
                },
              }),
            )
          : [];
        const outcomes = parsed.sheets.map(
          (_, index) =>
            done.get(index) ?? newOutcomes[pending.findIndex((item) => item.index === index)]!,
        );
        for (const [index, outcome] of outcomes.entries()) {
          if (outcome.outcome !== "rejected") done.set(index, outcome);
        }
        if (parsed.problems.length || outcomes.some((o) => o.outcome !== "saved"))
          allSucceeded = false;
        for (const o of newOutcomes) {
          if (o.outcome === "saved") {
            saved++;
            lastMonth.current = o.month;
          }
        }
        setRun(i, {
          state: outcomes.some((o) => o.outcome === "rejected") ? "failed" : "done",
          outcomes,
          message: parsed.problems.join(" "),
        });
      } catch (err) {
        allSucceeded = false;
        setRun(i, {
          state: "failed",
          message: errorMessage(err, "This file could not be checked."),
        });
      }
    }
    active.current = false;
    setRunning(false);
    setFinished(true);
    await qc.invalidateQueries({ queryKey: ["timesheets"] });
    if (saved > 0) {
      toast.success(`${saved} timesheet${saved === 1 ? "" : "s"} saved and checked.`);
      if (lastMonth.current) onSaved?.(lastMonth.current);
      if (allSucceeded) {
        clearDrafts();
        setFiles([]);
        setRuns([]);
        setFinished(false);
        setDateYear("");
        setAllowMixedMonths(false);
        setMixedReview(false);
        onOpenChange(false);
      }
    } else {
      toast.info("No new timesheet was saved. See the list for why.");
    }
  }

  const doneCount = runs.filter((r) => r.state === "done" || r.state === "failed").length;

  return (
    <>
      <AiDocumentDialog
        kind="timesheet"
        open={aiOpen}
        onOpenChange={setAiOpen}
        onReviewed={async (doc) => {
          if (doc.kind !== "timesheet") return;
          const file = new File([], doc.parsed.fileName);
          clearDrafts();
          drafts.current.set(file, doc.parsed);
          setFiles([file]);
          setRuns([
            {
              ...WAITING,
              draft: doc.parsed,
              message:
                "Check staff name and NI number before importing (date of birth is optional).",
            },
          ]);
          setFinished(false);
          setMixedReview(false);
          setAllowMixedMonths(false);
          setAiOpen(false);
        }}
      />
      <Dialog open={open && !aiOpen} onOpenChange={close}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload timesheets</DialogTitle>
            <DialogDescription>
              Add Excel, CSV, typed PDF or Word. Use AI reading below for photos and scanned PDFs.
            </DialogDescription>
          </DialogHeader>

          <label className="space-y-1 text-sm">
            <span>Year for PDF dates without a year (optional)</span>
            <Input
              type="number"
              min={2000}
              max={2100}
              step={1}
              value={dateYear}
              disabled={running}
              onChange={(e) => {
                setDateYear(e.target.value);
                for (const file of files)
                  if (readMode(file.name).supported && !completed.current.get(file)?.size)
                    drafts.current.delete(file);
                setRuns([]);
                setFinished(false);
              }}
              placeholder="For example, 2026"
            />
            <span className="block text-xs text-muted-foreground">
              Only fills missing years. Dates already written in the file stay unchanged.
            </span>
          </label>
          {mixedReview ? (
            <label className="flex items-start gap-2 rounded-lg border border-warning/40 p-3 text-sm">
              <input
                type="checkbox"
                checked={allowMixedMonths}
                disabled={running}
                onChange={(e) => {
                  setAllowMixedMonths(e.target.checked);
                  setFinished(false);
                }}
              />
              <span>
                I reviewed the mixed-month dates in the listed files and want to keep them. Each
                sheet will be filed under the month containing most of its dated rows; other-month
                rows remain flagged for review.
              </span>
            </label>
          ) : null}
          <Button variant="outline" disabled={running} onClick={() => setAiOpen(true)}>
            Read photo / scanned PDF with AI
          </Button>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={
              over
                ? "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary bg-info-soft px-6 py-10 text-center"
                : "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border-strong bg-surface-muted/50 px-6 py-10 text-center hover:bg-accent/40"
            }
          >
            <Upload className="mb-2 size-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-[13px] font-semibold text-foreground">
              Drop files here or click to choose
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              You can add many files at once.
            </span>
            <input
              type="file"
              multiple
              className="sr-only"
              accept=".xlsx,.csv,.pdf,.docx"
              disabled={running}
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

          {files.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {files.map((f, i) => {
                const m = readMode(f.name);
                const r = runs[i];
                return (
                  <li key={`${f.name}-${i}`} className="px-3 py-2 text-[13px]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-medium text-foreground">{f.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {r ? (
                          <Pill
                            tone={
                              r.state === "failed" ? "bad" : r.state === "done" ? "good" : "mute"
                            }
                          >
                            {r.state === "waiting"
                              ? "Waiting"
                              : r.state === "reading"
                                ? "Reading…"
                                : r.state === "checking"
                                  ? "Checking…"
                                  : r.state === "done"
                                    ? "Done"
                                    : "Not used"}
                          </Pill>
                        ) : (
                          <Pill tone={m.tone}>{m.label}</Pill>
                        )}
                        {!running && !finished ? (
                          <button
                            type="button"
                            aria-label={`Remove ${f.name}`}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              drafts.current.delete(f);
                              completed.current.delete(f);
                              setFiles((prev) => prev.filter((_, idx) => idx !== i));
                              setRuns((prev) => prev.filter((_, idx) => idx !== i));
                            }}
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {r?.draft?.sheets.map((sheet, sheetIndex) =>
                      completed.current.get(f)?.has(sheetIndex) ? null : (
                        <fieldset
                          key={sheetIndex}
                          disabled={running}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              void run();
                            }
                          }}
                          className="mt-3 space-y-2 rounded-lg border p-3"
                        >
                          <legend className="px-1 font-medium">
                            Staff identity{sheet.sheetLabel ? ` · ${sheet.sheetLabel}` : ""}
                          </legend>
                          <p className="text-xs text-muted-foreground">
                            All three details must match one Staff record. A filename is never used
                            as the staff name. Correct missing or unreadable details here.
                          </p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1 sm:col-span-2">
                              <span>Staff name</span>
                              <Input
                                value={sheet.personName}
                                maxLength={120}
                                autoComplete="off"
                                onChange={(e) =>
                                  editPerson(f, i, sheetIndex, "personName", e.target.value)
                                }
                              />
                            </label>
                            <label className="space-y-1">
                              <span>NI number</span>
                              <Input
                                value={sheet.personNi}
                                maxLength={20}
                                autoComplete="off"
                                onChange={(e) =>
                                  editPerson(f, i, sheetIndex, "personNi", e.target.value)
                                }
                              />
                            </label>
                            <label className="space-y-1">
                              <span>Date of birth (optional)</span>
                              <Input
                                type="date"
                                value={sheet.personDob ?? ""}
                                onChange={(e) =>
                                  editPerson(f, i, sheetIndex, "personDob", e.target.value)
                                }
                              />
                            </label>
                          </div>
                        </fieldset>
                      ),
                    )}
                    {r && (r.outcomes.length > 0 || r.message) ? (
                      <ul className="mt-2 space-y-1.5 text-xs">
                        {r.outcomes.map((o, k) => (
                          <OutcomeLine
                            onOpenExisting={onOpenExisting}
                            key={`${o.label}-${k}`}
                            o={o}
                          />
                        ))}
                        {r.message ? <li className="text-muted-foreground">{r.message}</li> : null}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          <DialogFooter>
            {finished ? (
              <>
                <Button variant="outline" onClick={() => close(false)}>
                  Close
                </Button>
                {runs.some((r) => r.state === "failed") ? (
                  <Button onClick={() => void run()}>Validate and import</Button>
                ) : null}
              </>
            ) : (
              <>
                <Button variant="outline" disabled={running} onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button disabled={supported.length === 0 || running} onClick={() => void run()}>
                  {running
                    ? `Checking ${Math.min(doneCount + 1, files.length)} of ${files.length}…`
                    : `Check ${supported.length > 0 ? `${supported.length} sheet${supported.length > 1 ? "s" : ""}` : "sheets"}`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
