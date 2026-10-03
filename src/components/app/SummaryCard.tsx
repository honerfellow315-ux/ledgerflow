import type { KeyboardEvent } from "react";
import type { LucideIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

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
  /** Dashboard-style card: larger number, softer accent, rounder corners. */
  premium?: boolean;
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

  const clickable = typeof onClick === "function";
  return (
    <div
      {...(clickable
        ? {
            role: "button",
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
        : {})}
      style={premium ? { borderRadius: 14 } : undefined}
      className={cn(
        "panel-interactive relative flex items-start justify-between gap-3 overflow-hidden",
        premium ? "min-h-32 px-5 py-5" : "min-h-28 px-4 py-4",
        clickable && "cursor-pointer text-left",
        active && "ring-2 ring-warning/60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 bg-gradient-to-r",
          premium ? "h-[2px] opacity-50" : "h-[3px]",
          bar,
        )}
      />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "num truncate font-semibold leading-tight text-foreground",
            premium ? "mt-3 text-[28px] tracking-tight" : "mt-2 text-xl",
          )}
        >
          {value}
        </p>
        {sublabel ? <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p> : null}
      </div>
      {Icon ? (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center shadow-sm ring-1 ring-inset ring-black/[0.03]",
            premium ? "size-10 rounded-xl" : "size-9 rounded-lg",
            accent,
          )}
        >
          <Icon className="size-4" />
        </span>
      ) : null}
    </div>
  );
}