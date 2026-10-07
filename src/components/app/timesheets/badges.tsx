import { cn } from "@/lib/utils";
import type { RowResult, SheetStatus } from "@/lib/timesheets/data";

export const TONES = {
  good: "bg-success-soft text-success border-success/25",
  warn: "bg-warning-soft text-warning border-warning/25",
  bad: "bg-danger-soft text-destructive border-destructive/25",
  mute: "bg-muted text-muted-foreground border-border-strong",
} as const;

export type Tone = keyof typeof TONES;

export function Pill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        TONES[tone],
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}

const SHEET_STATUS: Record<SheetStatus, { label: string; tone: Tone }> = {
  ready: { label: "All matching", tone: "good" },
  needs_review: { label: "Needs a look", tone: "warn" },
  staff_not_found: { label: "Staff not found", tone: "bad" },
};

const ROW_RESULT: Record<RowResult, { label: string; tone: Tone }> = {
  match: { label: "Matches", tone: "good" },
  hours_over: { label: "Sheet is higher", tone: "bad" },
  hours_under: { label: "Sheet is lower", tone: "warn" },
  not_in_records: { label: "Not in our records", tone: "bad" },
  not_on_sheet: { label: "Missing from sheet", tone: "warn" },
  check_reading: { label: "Check the reading", tone: "warn" },
};

export function SheetStatusBadge({ status }: { status: SheetStatus }) {
  const m = SHEET_STATUS[status];
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

export function RowResultBadge({ result }: { result: RowResult }) {
  const m = ROW_RESULT[result];
  return <Pill tone={m.tone}>{m.label}</Pill>;
}