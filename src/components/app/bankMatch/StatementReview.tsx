import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/ledger/calc";
import type { ParsedStatement } from "@/lib/bankMatch/parse";

export function StatementReview({
  statement,
  busy,
  onCancel,
  onConfirm,
}: {
  statement: ParsedStatement;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const total = statement.lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review the statement reading</DialogTitle>
          <DialogDescription>
            {statement.fileName}: {statement.lines.length} money-in rows, total {formatMoney(total)}
            . {statement.skippedOut} money-out rows excluded. Nothing has been uploaded yet.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
          PDF/Word table extraction can miss or misplace text. Compare every date, description and
          amount, the row count and total against the original file before continuing. If anything
          differs, cancel and upload CSV/Excel instead.
        </p>
        <div className="max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-right">Money in</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <tr key={line.lineNo} className="border-t">
                  <td className="whitespace-nowrap p-2">{line.date}</td>
                  <td className="p-2">{line.description}</td>
                  <td className="whitespace-nowrap p-2 text-right">{formatMoney(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            disabled={busy}
          />
          I compared this reading with the original statement.
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy || !checked} onClick={onConfirm}>
            {busy ? "Uploading…" : "Upload reviewed statement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
