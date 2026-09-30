import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Eye, Pencil, Plus, Search, Trash2 } from "@/lib/icons";
import { toast } from "sonner";
import { useLedger } from "@/lib/ledger/store";
import { formatMoney, totalsForClient } from "@/lib/ledger/calc";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClientDialog } from "@/components/app/ClientDialog";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { RequireView } from "@/components/app/RequireView";
import { usePermissions } from "@/lib/ledger/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Client } from "@/lib/ledger/types";

export const Route = createFileRoute("/clients/")({
  head: () => ({
    meta: [
      { title: "Clients — LedgerFlow" },
      {
        name: "description",
        content: "Manage client accounts with invoiced, paid and outstanding totals.",
      },
      { property: "og:title", content: "Clients — LedgerFlow" },
      { property: "og:description", content: "Client ledger accounts with balances in GBP." },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  return (
    <RequireView module="clients">
      <ClientsPageContent />
    </RequireView>
  );
}

function ClientsPageContent() {
  const { data, invoiceViews, deleteClient } = useLedger();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [toDelete, setToDelete] = useState<Client | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.clients
      .filter((c) => (status === "all" ? true : c.status === status))
      .filter((c) => (q ? `${c.name} ${c.company} ${c.email}`.toLowerCase().includes(q) : true))
      .map((c) => ({ client: c, totals: totalsForClient(c.id, invoiceViews) }));
  }, [data.clients, invoiceViews, query, status]);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Clients"
          description={`${rows.length} of ${data.clients.length} accounts`}
          actions={
            can("clients", "create") ? (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="size-4" /> Add Client
              </Button>
            ) : undefined
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, company or email…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-40 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="on-hold">On hold</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No clients match this view"
            description="Adjust the search or filters, or add a new client."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Client Name</TH>
                  <TH>Company</TH>
                  <TH align="right">Total Invoiced</TH>
                  <TH align="right">Total Paid</TH>
                  <TH align="right">Outstanding</TH>
                  <TH>Status</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map(({ client, totals }) => (
                  <TR key={client.id}>
                    <TD>
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: client.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {client.name}
                      </Link>
                    </TD>
                    <TD>{client.company}</TD>
                    <TD mono align="right">
                      {formatMoney(totals.invoiced)}
                    </TD>
                    <TD mono align="right">
                      {formatMoney(totals.paid)}
                    </TD>
                    <TD mono align="right">
                      {formatMoney(totals.outstanding)}
                    </TD>
                    <TD>
                      <StatusBadge status={client.status} kind="client" />
                    </TD>
                    <TD align="right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`View ${client.company}`}
                          onClick={() =>
                            navigate({
                              to: "/clients/$clientId",
                              params: { clientId: client.id },
                            })
                          }
                        >
                          <Eye className="size-3.5" />
                        </Button>
                        {can("clients", "edit") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Edit ${client.company}`}
                            onClick={() => {
                              setEditing(client);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        ) : null}
                        {can("clients", "delete") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive"
                            aria-label={`Delete ${client.company}`}
                            onClick={() => setToDelete(client)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      <ClientDialog open={dialogOpen} onOpenChange={setDialogOpen} client={editing} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete client?"
        description={`This removes ${toDelete?.company ?? "the client"} along with its invoices and payments. This cannot be undone.`}
        confirmLabel="Delete client"
        onConfirm={() => {
          if (toDelete) {
            deleteClient(toDelete.id);
            toast.success("Client deleted.");
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
