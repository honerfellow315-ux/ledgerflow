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
import { Pill, type Tone } from "@/components/app/timesheets/badges";

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