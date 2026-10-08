import type { KeyboardEvent } from "react";
import type { LucideIcon } from "@/lib/icons";
import { ChevronRight } from "@/lib/icons";
import { cn } from "@/lib/utils";

/** Smooth S-curve path through the points (display-only sparkline). */
function sparkPath(values: number[], w: number, h: number) {
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pts = values.map((v, i) => ({
    x: values.length === 1 ? w / 2 : (i / (values.length - 1)) * w,
    y: span === 0 ? h / 2 : h - pad - ((v - min) / span) * (h - pad * 2),
  }));
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2;
    d += ` C ${mx.toFixed(2)} ${pts[i - 1].y.toFixed(2)} ${mx.toFixed(2)} ${pts[i].y.toFixed(2)} ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  }
  return { line: d, area: `${d} L ${w} ${h} L 0 ${h} Z` };
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 72;
  const h = 28;
  const { line, area } = sparkPath(values, w, h);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-7 w-[4.5rem] shrink-0 overflow-visible", className)}
      aria-hidden
    >
      <path d={area} fill="currentColor" opacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SummaryCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "default",
  onClick,
  active = false,
  title,
  premium = false,
  trend,
  spark,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger";
  /** Makes the whole card a button (keyboard + click). */
  onClick?: () => void;
  /** Highlights the card while the filter it controls is on. */
  active?: boolean;
  title?: string;
  /** Dashboard-style card: larger number, tinted glass, optional trend/sparkline. */
  premium?: boolean;
  /** Display-only % change vs last month (premium cards). null/undefined hides it. */
  trend?: number | null;
  /** Display-only sparkline values (premium cards). */
  spark?: number[];
}) {
  const accent = {
    default: "text-primary bg-gradient-to-br from-info-soft to-info-soft/40",
    success: "text-success bg-gradient-to-br from-success-soft to-success-soft/40",
    warning: "text-warning bg-gradient-to-br from-warning-soft to-warning-soft/40",
    danger: "text-destructive bg-gradient-to-br from-danger-soft to-danger-soft/40",
  }[tone];

  const premiumAccent = {
    default: "text-info bg-info/20 border-info/30",
    success: "text-success bg-success/20 border-success/30",
    warning: "text-warning bg-warning/20 border-warning/30",
    danger: "text-destructive bg-destructive/20 border-destructive/30",
  }[tone];

  const sparkColor = {
    default: "text-info",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  }[tone];

  const bar = {
    default: "from-primary/70 via-primary to-primary/70",
    success: "from-success/70 via-success to-success/70",
    warning: "from-warning/70 via-warning to-warning/70",
    danger: "from-destructive/70 via-destructive to-destructive/70",
  }[tone];

  const clickable = typeof onClick === "function";
  const interactiveProps = clickable
    ? {
        role: "button" as const,
        tabIndex: 0,
        title,
        "aria-pressed": active,
        onClick,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};

  if (premium) {
    const hasTrend = typeof trend === "number" && Number.isFinite(trend);
    const hasSpark = Array.isArray(spark) && spark.length > 1;
    return (
      <div
        {...interactiveProps}
        data-tone={tone}
        className={cn(
          "panel-interactive lf-stat relative flex flex-col gap-2 overflow-hidden px-3.5 py-3",
          clickable && "cursor-pointer text-left",
          active && "ring-2 ring-warning/60",
        )}
      >
        <div className="flex items-start justify-between">
          {Icon ? (
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg border shadow-sm",
                premiumAccent,
              )}
            >
              <Icon className="size-[18px]" />
            </span>
          ) : (
            <span />
          )}
          {clickable ? <ChevronRight className="size-3.5 text-muted-foreground" /> : null}
        </div>

        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-foreground/85">{label}</p>
          <p className="num lf-stat-value mt-0.5 truncate font-semibold leading-tight tracking-tight text-foreground">
            {value}
          </p>
          {sublabel ? (
            <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">{sublabel}</p>
          ) : null}
        </div>

        {hasTrend || hasSpark ? (
          <div className="mt-auto flex items-end justify-between gap-2">
            {hasTrend ? (
              <div className="leading-tight">
                <p
                  className={cn(
                    "flex items-center gap-1 text-[12px] font-semibold",
                    (trend as number) >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
                    {(trend as number) >= 0 ? (
                      <path
                        d="M6 10V2M2.5 5.5 6 2l3.5 3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : (
                      <path
                        d="M6 2v8M2.5 6.5 6 10l3.5-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </svg>
                  {Math.abs(trend as number).toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground">vs last month</p>
              </div>
            ) : (
              <span />
            )}
            {hasSpark ? <Sparkline values={spark as number[]} className={sparkColor} /> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      {...interactiveProps}
      data-tone={tone}
      className={cn(
        "panel-interactive relative flex min-h-28 items-start justify-between gap-3 overflow-hidden px-4 py-4",
        clickable && "cursor-pointer text-left",
        active && "ring-2 ring-warning/60",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r", bar)}
      />
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