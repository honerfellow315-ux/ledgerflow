import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Clock } from "@/lib/icons";
import { dashboardPayrollHours } from "@/lib/actions/dashboardPayroll";
import { unwrap } from "@/lib/unwrap";
import { formatMoney } from "@/lib/ledger/calc";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { Panel, PanelHeader } from "@/components/app/Panel";
import { cn } from "@/lib/utils";

const hoursText = (h: number) =>
  h.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Dashboard card: payroll hours + pay for each payroll company, one month at a time. */
export function PayrollHoursPanel({ enabled }: { enabled: boolean }) {
  const [month, setMonth] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["dashboard-payroll-hours", month],
    queryFn: () => unwrap(dashboardPayrollHours({ data: { month } })),
    enabled,
    refetchInterval: 60_000,
  });
  const d = q.data;
  const maxHours = Math.max(0, ...(d?.companies ?? []).map((c) => c.hours));

  return (
    <Panel>
      <PanelHeader
        title="Payroll Hours by Company"
        description={
          d?.month
            ? `${formatMonthLabel(d.month)} · ${hoursText(d.totalHours)} hours · ${formatMoney(d.totalAmount)}`
            : "Hours and pay for each payroll company."
        }
        actions={
          <>
            {d && d.months.length > 1 ? (
              <div
                role="group"
                aria-label="Payroll month"
                className="inline-flex rounded-lg border border-white/10 bg-white/[0.05] p-0.5"
              >
                {[...d.months]
                  .slice(0, 3)
                  .reverse()
                  .map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMonth(m)}
                      aria-pressed={d.month === m}
                      className={cn(
                        "rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                        d.month === m
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {formatMonthLabel(m).slice(0, 3)} {m.slice(2, 4)}
                    </button>
                  ))}
              </div>
            ) : null}
            <Link to="/payroll" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </>
        }
      />
      {q.isError ? (
        <p className="p-4 text-xs text-destructive">
          Payroll hours could not be loaded. Please refresh.
        </p>
      ) : q.isPending ? (
        <p className="p-4 text-xs text-muted-foreground">Loading payroll hours…</p>
      ) : !d || d.companies.length === 0 || !d.month ? (
        <p className="p-4 text-xs text-muted-foreground">
          No payroll sheets yet. Create one on the Payroll Sheet page.
        </p>
      ) : (
        <ul className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
          {d.companies.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-info/25 bg-info/15 text-info">
                <Building2 className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span
                    className={cn(
                      "truncate font-medium",
                      c.active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.name}
                  </span>
                  <span className="num shrink-0 font-semibold text-foreground">
                    {c.status ? `${hoursText(c.hours)} h` : "—"}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-mark to-[oklch(0.65_0.14_190)]"
                    style={{ width: `${maxHours > 0 ? (c.hours / maxHours) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-1 flex items-center gap-1 truncate text-[10.5px] text-muted-foreground">
                  <Clock className="size-3" />
                  {c.status
                    ? `${c.lines} staff · ${formatMoney(c.amount)} · ${c.status}`
                    : "No sheet this month"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
