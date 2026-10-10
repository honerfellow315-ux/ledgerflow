import { formatMoney } from "@/lib/ledger/calc";
import { marginTone } from "@/lib/owner/data";

const money0 = (n: number) => formatMoney(n).replace(/\.00$/, "");

/** Billed vs received, a few months. Plain CSS bars so it stays light and readable. */
export function TrendBars({ data }: { data: { label: string; billed: number; received: number }[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.billed, d.received]));
  return (
    <div>
      <div
        role="img"
        aria-label={`Billed and received per month: ${data.map((d) => `${d.label} billed ${money0(d.billed)}, received ${money0(d.received)}`).join("; ")}`}
        className="flex h-44 items-end gap-3 border-b border-border px-1"
      >
        {data.map((d) => (
          <div key={d.label} className="flex h-full flex-1 items-end justify-center gap-1">
            <div
              className="w-full max-w-5 rounded-t bg-primary"
              style={{ height: `${Math.round((d.billed / max) * 100)}%` }}
              title={`Billed ${money0(d.billed)}`}
            />
            <div
              className="w-full max-w-5 rounded-t bg-success"
              style={{ height: `${Math.round((d.received / max) * 100)}%` }}
              title={`Received ${money0(d.received)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-3 px-1">
        {data.map((d) => (
          <div key={d.label} className="flex-1 text-center text-xs text-muted-foreground">
            {d.label}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" /> Billed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success" /> Received
        </span>
      </div>
    </div>
  );
}

export function AgeingBars({ data }: { data: { label: string; amount: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.amount));
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li key={d.label}>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-foreground">{d.label}</span>
            <span className="num font-medium text-foreground">{formatMoney(d.amount)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted" aria-hidden="true">
            <div
              className={i === 0 ? "h-1.5 rounded-full bg-primary" : i === 3 ? "h-1.5 rounded-full bg-destructive" : "h-1.5 rounded-full bg-warning"}
              style={{ width: `${Math.round((d.amount / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MarginBar({ pct }: { pct: number }) {
  const tone = marginTone(pct);
  const color = tone === "bad" ? "bg-destructive" : tone === "warn" ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 rounded-full bg-muted" aria-hidden="true">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, (pct / 40) * 100))}%` }} />
      </div>
      <span className="num w-12 text-right text-[13px] font-medium">{pct}%</span>
    </div>
  );
}
