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
  if (ext === "xlsx" || ext === "csv") return { label: "Read exactly", tone: "good", supported: true };
  if (ext === "xls") return { label: "Save as .xlsx first", tone: "bad", supported: false };
  if (["pdf", "doc", "docx", "jpg", "jpeg", "png", "webp", "heic"].includes(ext)) {
    return { label: "Not supported yet", tone: "bad", supported: false };
  }
  return { label: "Not supported", tone: "bad", supported: false };
}

interface FileRun {
  state: "waiting" | "reading" | "checking" | "done" | "failed";
  /** One line per timesheet found in the file. */
  outcomes: UploadOutcome[];
  /** Why the file could not be used, or extra notes about it. */
  message: string;
}

const WAITING: FileRun = { state: "waiting", outcomes: [], message: "" };

function OutcomeLine({ o }: { o: UploadOutcome }) {
  if (o.outcome === "saved" && o.status) {
    return (
      <li className="flex flex-wrap items-center gap-2">
        <SheetStatusBadge status={o.status} />
        <span className="text-foreground">{o.staffName || o.label}</span>
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
    </li>
  );
}

export function UploadTimesheetDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the month (yyyy-mm) of the last sheet that was saved. */
  onSaved?: (month: string) => void;
}) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [runs, setRuns] = useState<FileRun[]>([]);
  const [over, setOver] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const lastMonth = useRef("");

  const add = (list: FileList | null) => {
    if (!list || running) return;
    if (finished) {
      setFiles([]);
      setRuns([]);
      setFinished(false);
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
      setFiles([]);
      setRuns([]);
      setFinished(false);
    }
    onOpenChange(next);
  };
  const supported = files.filter((f) => readMode(f.name).supported);

  const setRun = (i: number, patch: Partial<FileRun>) =>
    setRuns((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function run() {
    const list = [...files];
    setRuns(list.map(() => ({ ...WAITING })));
    setRunning(true);
    setFinished(false);
    lastMonth.current = "";
    let saved = 0;
    for (let i = 0; i < list.length; i++) {
      const file = list[i]!;
      if (!readMode(file.name).supported) {
        setRun(i, { state: "failed", message: readMode(file.name).label });
        continue;
      }
      try {
        setRun(i, { state: "reading" });
        const parsed = await parseTimesheetFile(file);
        if (parsed.sheets.length === 0) {
          setRun(i, { state: "failed", message: parsed.problems.join(" ") || "Nothing could be read." });
          continue;
        }
        setRun(i, { state: "checking" });
        const outcomes = await unwrap(
          uploadTimesheetFile({
            data: { fileName: file.name, fileHash: parsed.fileHash, sheets: parsed.sheets },
          }),
        );
        for (const o of outcomes) {
          if (o.outcome === "saved") {
            saved++;
            lastMonth.current = o.month;
          }
        }
        setRun(i, { state: "done", outcomes, message: parsed.problems.join(" ") });
      } catch (err) {
        setRun(i, { state: "failed", message: errorMessage(err, "This file could not be checked.") });
      }
    }
    setRunning(false);
    setFinished(true);
    await qc.invalidateQueries({ queryKey: ["timesheets"] });
    if (saved > 0) {
      toast.success(`${saved} timesheet${saved === 1 ? "" : "s"} saved and checked.`);
      if (lastMonth.current) onSaved?.(lastMonth.current);
    } else {
      toast.info("No new timesheet was saved. See the list for why.");
    }
  }

  const doneCount = runs.filter((r) => r.state === "done" || r.state === "failed").length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload timesheets</DialogTitle>
          <DialogDescription>
            Add the Excel or CSV timesheets your staff sent. PDF, Word and photos come in a later
            phase.
          </DialogDescription>
        </DialogHeader>

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
          <span className="mt-1 text-xs text-muted-foreground">You can add many files at once.</span>
          <input
            type="file"
            multiple
            className="sr-only"
            accept=".xlsx,.csv"
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
                            r.state === "failed"
                              ? "bad"
                              : r.state === "done"
                                ? "good"
                                : "mute"
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
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <X className="size-4" />
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {r && (r.outcomes.length > 0 || r.message) ? (
                    <ul className="mt-2 space-y-1.5 text-xs">
                      {r.outcomes.map((o, k) => (
                        <OutcomeLine key={`${o.label}-${k}`} o={o} />
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
            <Button onClick={() => close(false)}>Close</Button>
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
  );
}
