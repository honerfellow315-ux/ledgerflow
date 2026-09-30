import { cn } from "@/lib/utils";
import type {
  ApprovalStatus,
  ClientStatus,
  CreditNoteStatus,
  InvoiceStatus,
} from "@/lib/ledger/types";

const invoiceStyles: Record<InvoiceStatus, string> = {
  paid: "bg-success-soft text-success border-success/25",
  partial: "bg-warning-soft text-warning border-warning/25",
  unpaid: "bg-danger-soft text-destructive border-destructive/25",
};

const approvalStyles: Record<ApprovalStatus, string> = {
  approved: "bg-success-soft text-success border-success/25",
  unapproved: "bg-muted text-muted-foreground border-border-strong",
};

const clientStyles: Record<ClientStatus, string> = {
  active: "bg-success-soft text-success border-success/25",
  "on-hold": "bg-warning-soft text-warning border-warning/25",
  closed: "bg-muted text-muted-foreground border-border-strong",
};

const creditStyles: Record<CreditNoteStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border-strong",
  issued: "bg-warning-soft text-warning border-warning/25",
  applied: "bg-success-soft text-success border-success/25",
};

const labels: Record<string, string> = {
  paid: "Paid",
  partial: "Partial",
  unpaid: "Unpaid",
  active: "Active",
  "on-hold": "On hold",
  closed: "Closed",
  draft: "Draft",
  issued: "Issued",
  applied: "Applied",
  approved: "Approved",
  unapproved: "Unapproved",
};

export function StatusBadge({
  status,
  kind = "invoice",
  className,
}: {
  status: InvoiceStatus | ClientStatus | CreditNoteStatus | ApprovalStatus;
  kind?: "invoice" | "client" | "credit" | "approval";
  className?: string;
}) {
  const styles =
    kind === "invoice"
      ? invoiceStyles[status as InvoiceStatus]
      : kind === "client"
        ? clientStyles[status as ClientStatus]
        : kind === "approval"
          ? approvalStyles[status as ApprovalStatus]
          : creditStyles[status as CreditNoteStatus];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-normal",
        styles,
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
      {labels[status] ?? status}
    </span>
  );
}
