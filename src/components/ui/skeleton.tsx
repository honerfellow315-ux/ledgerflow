import { cn } from "@/lib/utils";

/** A pulsing placeholder shown while data loads, instead of a bare "Loading…" line. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted/60", className)} />
  );
}

/** A few table-like rows of placeholders. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2 px-4 py-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
