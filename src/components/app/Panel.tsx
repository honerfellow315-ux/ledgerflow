import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  // Note: deliberately NOT `overflow-hidden` here — an ancestor with any
  // overflow other than `visible` becomes the containing block for any
  // `position: sticky` descendant (see TableWrap's floating scrollbar
  // below), which would trap it inside this panel instead of letting it
  // stick to the viewport. Rounded corners are clipped further down
  // instead (PanelHeader's own rounded-t-lg, TableWrap's rounded-b-lg).
  return <section className={cn("panel rounded-lg", className)}>{children}</section>;
}

export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-t-lg border-b border-border bg-gradient-to-b from-surface-muted/70 to-surface-muted/40 px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center border-t border-dashed border-border px-6 py-12 text-center">
      <span className="mb-3 flex size-8 items-center justify-center rounded-full bg-muted">
        <span className="size-1.5 rounded-full bg-border-strong" />
      </span>
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/**
 * Wraps a table with horizontal scrolling and a second, "floating" scrollbar
 * pinned to the bottom of the viewport (via `sticky`) while the table is on
 * screen. Without this, a wide table's only scrollbar sits at the table's
 * natural bottom edge — once you've scrolled the page down past it, you'd
 * have to scroll back up just to pan sideways. The sticky bar stays reachable
 * the whole time the table is in view, and it's kept in sync (either side can
 * drive the scroll) with the real, top scroll container.
 */
export function TableWrap({ children }: { children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [needsScroll, setNeedsScroll] = useState(false);
  const syncing = useRef(false);

  useEffect(() => {
    const el = topRef.current;
    if (!el) return;

    const measure = () => {
      setScrollWidth(el.scrollWidth);
      setNeedsScroll(el.scrollWidth > el.clientWidth + 1);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children]);

  const onTopScroll = () => {
    if (syncing.current) return;
    syncing.current = true;
    if (bottomRef.current && topRef.current)
      bottomRef.current.scrollLeft = topRef.current.scrollLeft;
    syncing.current = false;
  };
  const onBottomScroll = () => {
    if (syncing.current) return;
    syncing.current = true;
    if (topRef.current && bottomRef.current)
      topRef.current.scrollLeft = bottomRef.current.scrollLeft;
    syncing.current = false;
  };

  return (
    <div className="w-full">
      <div
        ref={topRef}
        onScroll={onTopScroll}
        className={cn(
          "w-full overflow-x-auto overscroll-x-contain",
          !needsScroll && "rounded-b-lg",
        )}
      >
        {children}
      </div>
      {needsScroll ? (
        <div
          ref={bottomRef}
          onScroll={onBottomScroll}
          aria-hidden="true"
          className="sticky bottom-0 z-20 w-full overflow-x-auto overscroll-x-contain rounded-b-lg border-t border-border bg-surface [&::-webkit-scrollbar]:h-2.5"
        >
          <div style={{ width: scrollWidth, height: 1 }} />
        </div>
      ) : null}
    </div>
  );
}
