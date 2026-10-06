import { useState, type DragEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Pill, type Tone } from "@/components/app/timesheets/badges";
import { fmtDate, fmtHours, sheetTotals, type TimesheetSheet } from "@/lib/timesheets/data";

/* ---------------------------------------------------------------- upload */

function readMode(name: string): { label: string; tone: Tone } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xls", "csv"].includes(ext)) return { label: "Read exactly", tone: "good" };
  if (["doc", "docx"].includes(ext)) return { label: "Read exactly", tone: "good" };
  if (ext === "pdf") return { label: "Typed PDF read exactly, scans by AI", tone: "good" };
  if (["jpg", "jpeg", "png", "webp", "heic"].includes(ext))
    return { label: "Read by AI, you review it", tone: "warn" };
  return { label: "Not supported", tone: "bad" };
}

export function UploadTimesheetDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);

  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };
  const close = (next: boolean) => {
    if (!next) setFiles([]);
    onOpenChange(next);
  };
  const supported = files.filter((f) => readMode(f.name).tone !== "bad");

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload timesheets</DialogTitle>
          <DialogDescription>
            Add the sheets your staff sent. Excel, PDF, Word and photos all work.
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
            accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic"
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
              return (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]"
                >
                  <span className="min-w-0 truncate font-medium text-foreground">{f.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Pill tone={m.tone}>{m.label}</Pill>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <X className="size-4" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            disabled={supported.length === 0}
            onClick={() => {
              toast.info("Preview only: checking uploaded files is connected in the next phase.");
              close(false);
            }}
          >
            Check {supported.length > 0 ? `${supported.length} sheet${supported.length > 1 ? "s" : ""}` : "sheets"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- email */

function buildEmail(sheet: TimesheetSheet, kind: "confirm" | "query") {
  const first = sheet.staffName.split(" ")[0];
  const t = sheetTotals(sheet);
  if (kind === "confirm") {
    return {
      subject: `Your ${sheet.monthLabel} timesheet is confirmed`,
      body: `Hi ${first},\n\nWe checked your ${sheet.monthLabel} timesheet (${fmtHours(t.sheetHours)}) against our records and everything matches.\n\nYou don't need to do anything else.\n\nThank you.`,
    };
  }
  const lines = sheet.rows
    .filter((row) => row.result !== "match")
    .map((row) => {
      const when = `${fmtDate(row.date)}, ${row.site}`;
      switch (row.result) {
        case "hours_over":
        case "hours_under":
          return `- ${when}: you wrote ${fmtHours(row.sheetHours)}, our record shows ${fmtHours(row.recordHours ?? 0)}.`;
        case "not_in_records":
          return `- ${when}: we have no shift in our records on this date.`;
        case "not_on_sheet":
          return `- ${when}: this shift is in our records but not on your sheet.`;
        default:
          return `- ${when}: we couldn't read this row clearly. Please confirm the hours.`;
      }
    });
  if (t.statedMismatch) {
    lines.push(
      `- Total: your sheet says ${fmtHours(sheet.statedHours)}, but the rows add up to ${fmtHours(t.sheetHours)}.`,
    );
  }
  return {
    subject: `Please check your ${sheet.monthLabel} timesheet`,
    body: `Hi ${first},\n\nWe checked your ${sheet.monthLabel} timesheet and need you to look at these entries:\n\n${lines.join("\n")}\n\nPlease reply with the correct details.\n\nThank you.`,
  };
}

function EmailForm({
  sheet,
  kind,
  onClose,
  onSent,
}: {
  sheet: TimesheetSheet;
  kind: "confirm" | "query";
  onClose: () => void;
  onSent: (kind: "confirm" | "query") => void;
}) {
  const draft = buildEmail(sheet, kind);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{kind === "confirm" ? "Confirm this sheet" : "Query these rows"}</DialogTitle>
        <DialogDescription>
          Check the email below. You can change the wording before it goes out.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ts-mail-to">To</Label>
          <Input id="ts-mail-to" value={sheet.email || "No email address on file"} readOnly />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ts-mail-subject">Subject</Label>
          <Input id="ts-mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ts-mail-body">Message</Label>
          <Textarea
            id="ts-mail-body"
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!sheet.email} onClick={() => onSent(kind)}>
          {kind === "confirm" ? "Send confirmation" : "Send query"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function EmailPreviewDialog({
  sheet,
  kind,
  onClose,
  onSent,
}: {
  sheet: TimesheetSheet | null;
  kind: "confirm" | "query" | null;
  onClose: () => void;
  onSent: (kind: "confirm" | "query") => void;
}) {
  return (
    <Dialog open={Boolean(sheet && kind)} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {sheet && kind ? (
          <EmailForm key={`${sheet.id}-${kind}`} sheet={sheet} kind={kind} onClose={onClose} onSent={onSent} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
