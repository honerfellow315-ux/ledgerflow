import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  HEADERS,
  reviewedDocument,
  type DocumentKind,
  type Extraction,
  type ReviewedDocument,
} from "@/lib/ai/document";
import { prepareDocument, type DocumentPage } from "@/lib/ai/prepare";
import { readAiDocument } from "@/lib/actions/aiDocuments";
import { unwrap } from "@/lib/unwrap";
import { errorMessage } from "@/lib/payroll/queries";
export function AiDocumentDialog({
  kind,
  open,
  onOpenChange,
  onReviewed,
}: {
  kind: DocumentKind;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onReviewed: (d: ReviewedDocument) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [hash, setHash] = useState("");
  const [draft, setDraft] = useState<Extraction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const [consent, setConsent] = useState(false);
  const [page, setPage] = useState(0);
  const close = (v: boolean) => {
    if (busy) return;
    if (!v) {
      setFile(null);
      setDraft(null);
      setPages([]);
      setChecked(false);
      setConsent(false);
      setError("");
      setHash("");
      setPage(0);
    }
    onOpenChange(v);
  };
  async function read() {
    if (!file || !consent) return;
    setBusy(true);
    setError("");
    setDraft(null);
    setChecked(false);
    try {
      const prepared = await prepareDocument(file);
      setPages(prepared.pages);
      setHash(prepared.fileHash);
      setPage(0);
      setDraft(
        await unwrap(readAiDocument({ data: { kind, pages: prepared.pages, consent: true } })),
      );
    } catch (e) {
      setError(errorMessage(e, "The document could not be read. Nothing was saved."));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || !file || !checked) return;
    setBusy(true);
    setError("");
    try {
      await onReviewed(reviewedDocument(kind, draft, file.name, hash));
      setBusy(false);
      setFile(null);
      setDraft(null);
      setPages([]);
      setChecked(false);
      setConsent(false);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, "The reviewed document could not be saved."));
    } finally {
      setBusy(false);
    }
  }
  const update = (next: Extraction) => {
    setDraft(next);
    setChecked(false);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Read {kind === "bank" ? "bank statement" : "timesheet"} with AI</DialogTitle>
          <DialogDescription>
            PDF, JPG, PNG or WebP. Up to 10 pages and 8 MB before processing. Review every row
            before saving.
          </DialogDescription>
        </DialogHeader>
        {!draft ? (
          <div className="space-y-3">
            <input
              aria-label="AI document"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPages([]);
                setError("");
                setChecked(false);
              }}
            />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I agree to send these pages to the configured paid Gemini service for reading.
            </label>
            <p className="text-xs text-muted-foreground">
              AI only extracts data. It does not approve staff, change salaries, or record payments
              automatically.
            </p>
          </div>
        ) : (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous page
                </Button>
                <span className="text-sm">
                  Page {page + 1} of {pages.length}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pages.length - 1}
                  onClick={() => setPage(page + 1)}
                >
                  Next page
                </Button>
              </div>
              <div className="max-h-[60vh] overflow-auto rounded border">
                <img
                  className="w-full"
                  alt={`Original document page ${page + 1}`}
                  src={`data:image/jpeg;base64,${pages[page]?.data ?? ""}`}
                />
              </div>
            </div>
            <div className="min-w-0 space-y-3">
              {draft.notes.length > 0 ? (
                <ul className="list-disc space-y-1 rounded border border-warning p-4 pl-7 text-sm">
                  {draft.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
              {kind === "timesheet" ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {(["personName", "personNi", "statedHours"] as const).map((key, i) => (
                    <label key={key} className="text-xs">
                      {["Staff name", "NI number", "Stated total hours"][i]}
                      <input
                        className="mt-1 h-9 w-full rounded border bg-surface px-2"
                        value={draft[key]}
                        disabled={busy}
                        onChange={(e) => update({ ...draft, [key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="max-h-[50vh] overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      {HEADERS[kind].map((h) => (
                        <th key={h} className="sticky top-0 bg-surface p-2 text-left">
                          {h}
                        </th>
                      ))}
                      <th className="bg-surface p-2">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((v, c) => (
                          <td key={c} className="p-1">
                            <input
                              aria-label={`Row ${r + 1} ${HEADERS[kind][c]}`}
                              className="h-9 w-28 rounded border bg-surface px-2"
                              value={v}
                              maxLength={300}
                              disabled={busy}
                              onChange={(e) =>
                                update({
                                  ...draft,
                                  rows: draft.rows.map((a, i) =>
                                    i === r ? a.map((b, j) => (j === c ? e.target.value : b)) : a,
                                  ),
                                })
                              }
                            />
                          </td>
                        ))}
                        <td className="p-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Remove row ${r + 1}`}
                            onClick={() =>
                              update({ ...draft, rows: draft.rows.filter((_, i) => i !== r) })
                            }
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || draft.rows.length >= 500}
                onClick={() =>
                  update({ ...draft, rows: [...draft.rows, HEADERS[kind].map(() => "")] })
                }
              >
                Add missing row
              </Button>
              <p className="text-xs text-muted-foreground">
                Dates: YYYY-MM-DD. Correct every ? or missing figure. Blank amount cells mean no
                amount in that column.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I checked every page, row, date and amount against the original, including any
                missing or repeated rows.
              </label>
            </div>
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => close(false)}>
            Cancel
          </Button>
          {draft ? (
            <Button disabled={busy || !checked} onClick={() => void save()}>
              {busy ? "Saving…" : "Save reviewed rows"}
            </Button>
          ) : (
            <Button disabled={!file || !consent || busy} onClick={() => void read()}>
              {busy ? "Reading pages…" : "Read with AI"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
