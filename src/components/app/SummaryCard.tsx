import type { LucideIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

export function SummaryCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const accent = {
    default: "text-primary bg-gradient-to-br from-info-soft to-info-soft/40",
    success: "text-success bg-gradient-to-br from-success-soft to-success-soft/40",
    warning: "text-warning bg-gradient-to-br from-warning-soft to-warning-soft/40",
    danger: "text-destructive bg-gradient-to-br from-danger-soft to-danger-soft/40",
  }[tone];

  const bar = {
    default: "from-primary/70 via-primary to-primary/70",
    success: "from-success/70 via-success to-success/70",
    warning: "from-warning/70 via-warning to-warning/70",
    danger: "from-destructive/70 via-destructive to-destructive/70",
  }[tone];

  return (
    <div className="panel-interactive relative flex min-h-28 items-start justify-between gap-3 overflow-hidden px-4 py-4">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r", bar)} />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {label}
        </p>
        <p className="num mt-2 truncate text-xl font-semibold leading-tight text-foreground">
          {value}
        </p>
        {sublabel ? <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p> : null}
      </div>
      {Icon ? (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-inset ring-black/[0.03]",
            accent,
          )}
        >
          <Icon className="size-4" />
        </span>
      ) : null}
    </div>
  );
}
