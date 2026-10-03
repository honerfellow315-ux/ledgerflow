import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "@/lib/icons";
import {
  listTrash,
  restoreFromTrash,
  permanentlyDelete,
  type TrashItem,
  type TrashType,
} from "@/lib/actions/trash";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/ledger/calc";

export const Route = createFileRoute("/recycle-bin/")({
  head: () => ({
    meta: [
      { title: "Recycle Bin — LedgerFlow" },
      {
        name: "description",
        content:
          "Deleted clients, invoices, payments and other records — restore or permanently remove them.",
      },
    ],
  }),
  component: RecycleBinPage,
});

const TYPE_LABELS: Record<TrashType, string> = {
  client: "Client",
  company: "Company",
  invoice: "Invoice",
  payment: "Payment",
  expense: "Expense",
  hours: "Hours entry",
  subcontract: "Subcontract",
  creditNote: "Credit Note",
  staff: "Staff",
};

function RecycleBinPage() {
  // Admin-only screen, same pattern as /users — RequireView's module here is
  // irrelevant; the real gate is isAdmin below.
  return (
    <RequireView module="dashboard">
      <RecycleBinPageContent />
    </RequireView>
  );
}

function RecycleBinPageContent() {
  const { isAdmin, ready } = usePermissions();
  const qc = useQueryClient();
  const trashQ = useQuery({ queryKey: ["trash"], queryFn: () => listTrash() });

  const [toPurge, setToPurge] = useState<TrashItem | null>(null);

  const restoreMutation = useMutation({
    mutationFn: (item: TrashItem) => restoreFromTrash({ data: { type: item.type, id: item.id } }),
    onSuccess: (res, item) => {
      // The restored row's own list (invoices, payments, ...) is stale now too.
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: [listQueryKeyFor(item.type)] });
      if (item.type === "staff") qc.invalidateQueries({ queryKey: ["salary"] });
      const note = res && typeof res === "object" && "note" in res ? String(res.note) : "";
      toast.success(note ? `Restored. ${note}` : "Restored.");
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Restore failed."),
  });

  const purgeMutation = useMutation({
    mutationFn: (item: TrashItem) => permanentlyDelete({ data: { type: item.type, id: item.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
      toast.success("Permanently deleted.");
      setToPurge(null);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Delete failed."),
  });

  if (!ready) return null;

  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Only administrators can see and recover deleted records."
        />
      </Panel>
    );
  }

  const rows = trashQ.data ?? [];

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Recycle Bin"
          description={
            rows.length === 0
              ? "Nothing deleted."
              : `${rows.length} deleted record${rows.length === 1 ? "" : "s"} — restore or remove for good.`
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            title="Recycle bin is empty"
            description="Anything deleted from clients, invoices, payments, expenses, hours, subcontracting or credit notes shows up here so it can be recovered."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Record</TH>
                  <TH>Deleted</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((item) => (
                  <TR key={`${item.type}-${item.id}`}>
                    <TD className="text-muted-foreground">{TYPE_LABELS[item.type]}</TD>
                    <TD>
                      <div className="font-medium">{item.label}</div>
                      {item.detail ? (
                        <div className="text-[12px] text-muted-foreground">{item.detail}</div>
                      ) : null}
                    </TD>
                    <TD className="text-muted-foreground">
                      {formatDate(item.deletedAt.slice(0, 10))}
                    </TD>
                    <TD align="right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={restoreMutation.isPending}
                          onClick={() => restoreMutation.mutate(item)}
                        >
                          <RotateCcw className="size-4" /> Restore
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setToPurge(item)}>
                          <Trash2 className="size-4" /> Delete forever
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      <ConfirmDialog
        open={toPurge != null}
        onOpenChange={(v) => !v && setToPurge(null)}
        title="Delete this permanently?"
        description={`"${toPurge?.label ?? ""}" will be gone for good — this can't be undone, even from here.`}
        confirmLabel="Delete forever"
        onConfirm={() => toPurge && purgeMutation.mutate(toPurge)}
      />
    </div>
  );
}

/** Maps a trash item's type to the React Query key its normal list view uses
 * (see KEYS in src/lib/ledger/store.tsx), so restoring it refreshes that
 * screen too instead of only clearing the bin. */
function listQueryKeyFor(type: TrashType): string {
  switch (type) {
    case "client":
      return "clients";
    case "company":
      return "companies";
    case "invoice":
      return "invoices";
    case "payment":
      return "payments";
    case "expense":
      return "expenses";
    case "hours":
      return "hours";
    case "subcontract":
      return "subcontracts";
    case "creditNote":
      return "creditNotes";
    case "staff":
      return "staff";
  }
}
