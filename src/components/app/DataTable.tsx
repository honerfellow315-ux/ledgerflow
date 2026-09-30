import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <table className={cn("w-full min-w-[720px] border-collapse text-[12px]", className)}>
      {children}
    </table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-muted">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "h-11 border-b border-border transition-colors last:border-b-0 hover:bg-accent/55",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  className,
  align = "left",
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      {...rest}
      className={cn(
        "h-9 whitespace-nowrap border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
  align = "left",
  mono,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right" | "center";
  mono?: boolean;
}) {
  return (
    <td
      {...rest}
      className={cn(
        "whitespace-nowrap px-3 py-2 align-middle text-foreground",
        mono && "num",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}
