import { cn } from "@/lib/utils";
import type { CheckStatus, PayStatus, PeriodStatus } from "@/lib/payroll/types";

const base =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-normal";

const payStyles: Record<PayStatus, string> = {
  Current: "bg-warning-soft text-warning border-warning/25",
  OverPaid: "bg-danger-soft text-destructive border-destructive/25",
  "Paid in Full": "bg-success-soft text-success border-success/25",
};

/** Current = still owed to the person, OverPaid = they were paid too much. */
export function PayStatusBadge({ status, className }: { status: PayStatus; className?: string }) {
  return (
    <span className={cn(base, payStyles[status], className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

const checkStyles: Record<Exclude<CheckStatus, "">, string> = {
  Reviewed: "bg-info-soft text-primary border-primary/25",
  Verified: "bg-success-soft text-success border-success/25",
};

export function CheckBadge({ status, className }: { status: CheckStatus; className?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn(base, checkStyles[status], className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

const periodStyles: Record<PeriodStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border-strong",
  reviewed: "bg-info-soft text-primary border-primary/25",
  verified: "bg-warning-soft text-warning border-warning/25",
  closed: "bg-success-soft text-success border-success/25",
};

const periodLabels: Record<PeriodStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  verified: "Verified",
  closed: "Closed",
};

export function PeriodStatusBadge({
  status,
  className,
}: {
  status: PeriodStatus;
  className?: string;
}) {
  return (
    <span className={cn(base, periodStyles[status], className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
      {periodLabels[status]}
    </span>
  );
}
