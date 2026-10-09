import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/app/timesheets/badges";
import { formatMoney } from "@/lib/ledger/calc";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { draftState, draftTotals, type Draft } from "@/lib/invoiceDrafts/data";

const h = (n: number) => `${Number(n.toFixed(2))} h`;

export function DraftPreviewDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  return (
    <Dialog open={draft !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        {draft ? <Body draft={draft} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const t = draftTotals(draft);
  const s = draftState(draft);
  const month = formatMonthLabel(draft.month);
  const canCreate = s.state !== "done" && draft.rate !== null && draft.rate > 0;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Invoice draft</DialogTitle>
        <DialogDescription>
          Built from this month's shifts. Check it, then create the invoice.
        </DialogDescription>
      </DialogHeader>

      {s.state === "check" ? (
        <div role="note" className="rounded-lg border border-warning/25 bg-warning-soft px-4 py-2.5 text-[13px] text-foreground">
          {s.text}
        </div>
      ) : null}

      <article
        aria-label={`Invoice draft for ${draft.client}`}
        className="rounded-lg border border-border-strong bg-white p-6 text-[13px] text-slate-900 shadow-sm"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-slate-500">Invoice to</p>
            <h2 className="text-lg font-semibold">{draft.client}</h2>
          </div>
          <div className="text-right">
            <p className="text-slate-500">Billing month</p>
            <p className="font-semibold">{month}</p>
          </div>
        </header>

        <table className="mt-4 w-full">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 font-medium">Description</th>
              <th className="pb-2 text-right font-medium">Hours</th>
              <th className="pb-2 text-right font-medium">Rate</th>
              <th className="pb-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2">Security services, {month}</td>
              <td className="num py-2 text-right">{Number(t.normalHours.toFixed(2))}</td>
              <td className="num py-2 text-right">{draft.rate ? formatMoney(draft.rate) : "Not set"}</td>
              <td className="num py-2 text-right">{formatMoney(t.normalHours * (draft.rate ?? 0))}</td>
            </tr>
            {t.payrollHours > 0 && draft.payrollRate ? (
              <tr className="border-b border-slate-100">
                <td className="py-2">Hours paid through payroll</td>
                <td className="num py-2 text-right">{Number(t.payrollHours.toFixed(2))}</td>
                <td className="num py-2 text-right">{formatMoney(draft.payrollRate)}</td>
                <td className="num py-2 text-right">{formatMoney(t.payrollHours * draft.payrollRate)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <dl className="ml-auto mt-4 w-64 space-y-1.5">
          <div className="flex justify-between">
            <dt className="text-slate-500">Total ex VAT</dt>
            <dd className="num">{formatMoney(t.exVat)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">VAT ({draft.vatRate}%)</dt>
            <dd className="num">{formatMoney(t.vat)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="num">{formatMoney(t.total)}</dd>
          </div>
        </dl>
      </article>

      <div>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Where the hours come from
        </h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[420px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Site</th>
                <th className="px-3 py-2 text-right font-medium">Shifts</th>
                <th className="px-3 py-2 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {draft.sites.map((x) => (
                <tr key={x.site} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{x.site}</td>
                  <td className="num px-3 py-2 text-right">{x.shifts}</td>
                  <td className="num px-3 py-2 text-right">{h(x.hours)}</td>
                </tr>
              ))}
              <tr className="bg-surface-muted/50 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="num px-3 py-2 text-right">{t.shifts}</td>
                <td className="num px-3 py-2 text-right">{h(t.hours)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Hours screen for this month:
          {draft.hoursEntry === null ? (
            <Pill tone="mute">Nothing entered</Pill>
          ) : (
            <Pill tone={Math.abs(draft.hoursEntry - t.hours) < 0.001 ? "good" : "warn"}>{h(draft.hoursEntry)}</Pill>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          disabled={!canCreate}
          onClick={() => {
            toast.info("Preview only: creating the invoice is connected in the next phase.");
            onClose();
          }}
        >
          Create invoice
        </Button>
      </div>
    </>
  );
}
