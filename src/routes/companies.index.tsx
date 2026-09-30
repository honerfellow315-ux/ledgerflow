import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Building2, Pencil, Plus, Search, Trash2 } from "@/lib/icons";
import { toast } from "sonner";
import { useLedger } from "@/lib/ledger/store";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { CompanyDialog } from "@/components/app/CompanyDialog";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { RequireView } from "@/components/app/RequireView";
import { usePermissions } from "@/lib/ledger/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Company } from "@/lib/ledger/types";

export const Route = createFileRoute("/companies/")({
  head: () => ({
    meta: [
      { title: "Companies — LedgerFlow" },
      {
        name: "description",
        content: "Manage the billing companies clients are invoiced under.",
      },
      { property: "og:title", content: "Companies — LedgerFlow" },
      { property: "og:description", content: "Billing entities used across client invoices." },
    ],
  }),
  component: CompaniesPage,
});

function CompaniesPage() {
  return (
    <RequireView module="companies">
      <CompaniesPageContent />
    </RequireView>
  );
}

function CompaniesPageContent() {
  const { data, deleteCompany } = useLedger();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [toDelete, setToDelete] = useState<Company | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.companies
      .filter((co) =>
        q ? `${co.name} ${co.email} ${co.vatNumber}`.toLowerCase().includes(q) : true,
      )
      .map((co) => ({
        company: co,
        clientCount: data.clients.filter((c) => c.companyId === co.id).length,
      }));
  }, [data.companies, data.clients, query]);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Companies"
          description={`${rows.length} of ${data.companies.length} billing companies`}
          actions={
            can("companies", "create") ? (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="size-4" /> Add Company
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
              placeholder="Search name, email or VAT…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={
              data.companies.length === 0 ? "No companies yet" : "No companies match this search"
            }
            description="Add a billing company here, then pick it under “Bill Under Company” on any client so their invoices and statements go out under this company's details."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Company</TH>
                  <TH>Email</TH>
                  <TH>Phone</TH>
                  <TH>VAT Number</TH>
                  <TH align="right">Clients</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map(({ company, clientCount }) => (
                  <TR key={company.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-muted/60">
                          {company.letterhead ? (
                            <img
                              src={company.letterhead}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : company.logo ? (
                            <img
                              src={company.logo}
                              alt=""
                              className="size-full object-contain p-0.5"
                            />
                          ) : (
                            <Building2 className="size-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <span className="font-medium text-foreground">{company.name}</span>
                      </div>
                    </TD>
                    <TD>{company.email || "—"}</TD>
                    <TD>{company.phone || "—"}</TD>
                    <TD>{company.vatNumber || "—"}</TD>
                    <TD mono align="right">
                      {clientCount}
                    </TD>
                    <TD align="right">
                      <div className="flex justify-end gap-1">
                        {can("companies", "edit") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Edit ${company.name}`}
                            onClick={() => {
                              setEditing(company);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        ) : null}
                        {can("companies", "delete") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive"
                            aria-label={`Delete ${company.name}`}
                            onClick={() => setToDelete(company)}
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

      <CompanyDialog open={dialogOpen} onOpenChange={setDialogOpen} company={editing} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete company?"
        description={`This removes ${toDelete?.name ?? "the company"}. Clients billed under it will fall back to the default Settings business profile — their invoices and other records are not affected.`}
        confirmLabel="Delete company"
        onConfirm={() => {
          if (toDelete) {
            deleteCompany(toDelete.id);
            toast.success("Company deleted.");
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
