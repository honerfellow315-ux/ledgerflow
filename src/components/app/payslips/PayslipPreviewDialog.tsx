import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Download } from "@/lib/icons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/ledger/calc";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { earningLines, payslipTotals, type PayslipRow } from "@/lib/payslips/data";

const hrs = (n: number) => `${Number(n.toFixed(2))}`;

export function PayslipPreviewDialog({
  rows,
  index,
  onIndex,
  onClose,
}: {
  rows: PayslipRow[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const p = index === null ? null : (rows[index] ?? null);
  return (
    <Dialog open={p !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        {p && index !== null ? (
          <>
            <DialogHeader>
              <DialogTitle>Payslip preview</DialogTitle>
              <DialogDescription>
                {index + 1} of {rows.length}. Use the arrows to flip through the staff.
              </DialogDescription>
            </DialogHeader>

            <article
              aria-label={`Payslip for ${p.name}`}
              className="rounded-lg border border-border-strong bg-white p-6 text-[13px] text-slate-900 shadow-sm"
            >
              <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-semibold">{p.company}</h2>
                  <p className="mt-0.5 text-slate-500">Payslip</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">Pay period</p>
                  <p className="font-semibold">{formatMonthLabel(p.month)}</p>
                </div>
              </header>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-slate-200 py-4">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium">{p.name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">NI number</dt>
                  <dd className="num font-medium">{p.ni || "Not recorded"}</dd>
                </div>
              </dl>

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
                  {earningLines(p).map((l) => (
                    <tr key={l.label} className="border-b border-slate-100">
                      <td className="py-2">{l.label}</td>
                      <td className="num py-2 text-right">{l.hours === null ? "" : hrs(l.hours)}</td>
                      <td className="num py-2 text-right">{l.rate === null ? "" : formatMoney(l.rate)}</td>
                      <td className="num py-2 text-right">{formatMoney(l.amount)}</td>
                    </tr>
                  ))}
                  {earningLines(p).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-3 text-slate-500">
                        No pay recorded for this month.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              <footer className="mt-4 flex items-center justify-between border-t border-slate-300 pt-3">
                <span className="font-semibold">Total pay</span>
                <span className="num text-lg font-semibold">{formatMoney(payslipTotals(p).amount)}</span>
              </footer>
            </article>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button variant="outline" size="icon" aria-label="Previous payslip" disabled={index === 0} onClick={() => onIndex(index - 1)}>
                  <ArrowLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next payslip"
                  disabled={index >= rows.length - 1}
                  onClick={() => onIndex(index + 1)}
                >
                  <ArrowRight className="size-4" />
                </Button>
              </div>
              <Button onClick={() => toast.info("Preview only: the PDF download is connected in the next phase.")}>
                <Download className="size-4" /> Download PDF
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
