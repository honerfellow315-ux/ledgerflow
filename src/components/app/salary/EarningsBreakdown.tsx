import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/unwrap";
import { getEntryBreakdown } from "@/lib/actions/salary";
import { formatMoney } from "@/lib/ledger/calc";

/**
 * "Earned from" list for one salary line: the person's imported shifts grouped
 * by system and client company. Renders nothing when the line has no imported
 * shifts (e.g. it came from the Excel salary sheet import).
 */
export function EarningsBreakdown({ entryId }: { entryId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["salary", "breakdown", entryId],
    queryFn: () => unwrap(getEntryBreakdown({ data: { entryId } })),
  });
  if (data.length === 0) return null;

  const clients = new Set(data.map((r) => r.clientName || "—"));
  const systems = new Set(data.map((r) => r.source));
  const total = data.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-surface-muted/50 px-3 py-2">
        <p className="text-[12px] font-semibold text-foreground">Earned from</p>
        <p className="text-[11px] text-muted-foreground">
          {clients.size} client {clients.size === 1 ? "company" : "companies"} · {systems.size}{" "}
          {systems.size === 1 ? "shift company" : "shift companies"} — all added to this one person
        </p>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
            <th className="px-3 py-1.5 font-semibold">Shift company</th>
            <th className="px-3 py-1.5 font-semibold">Client company</th>
            <th className="px-3 py-1.5 text-right font-semibold">Shifts</th>
            <th className="px-3 py-1.5 text-right font-semibold">Hours</th>
            <th className="px-3 py-1.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={`${r.source}|${r.clientName}`} className="border-t border-border">
              <td className="px-3 py-1.5">{r.source}</td>
              <td className="px-3 py-1.5">{r.clientName || "—"}</td>
              <td className="num px-3 py-1.5 text-right">{r.shifts}</td>
              <td className="num px-3 py-1.5 text-right">{r.hours}</td>
              <td className="num px-3 py-1.5 text-right">{formatMoney(r.amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-border font-semibold">
            <td className="px-3 py-1.5" colSpan={4}>
              Total from shifts
            </td>
            <td className="num px-3 py-1.5 text-right">{formatMoney(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
