import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Client, ClientStatus, Company } from "@/lib/ledger/types";

/** Company filter value for clients that are not linked to any billing company. */
export const NO_COMPANY = "__none__";
/** Company filter value meaning "every company". */
export const ALL_COMPANIES = "__all__";

const STATUS_LABEL: Record<ClientStatus, string> = {
  active: "Active",
  "on-hold": "On hold",
  closed: "Closed",
};

/** The billing company a client is invoiced under, as a filter key. */
export function companyKeyOf(client: Pick<Client, "companyId"> | undefined): string {
  return client?.companyId || NO_COMPANY;
}

/** Clients that belong to a Company filter value (ALL_COMPANIES = everyone). */
export function clientsInCompany(clients: Client[], companyKey: string): Client[] {
  if (companyKey === ALL_COMPANIES) return clients;
  return clients.filter((c) => companyKeyOf(c) === companyKey);
}

/**
 * Two linked dropdowns: "Billing company" (which of OUR companies the work is
 * invoiced under) and "Client" (the customer, limited to that company).
 * Changing the company keeps the current client if it belongs to the new
 * company, otherwise switches to that company's first client.
 *
 * Fully controlled: the parent owns `companyKey` and `clientId`.
 */
export function CompanyClientPicker({
  clients,
  companies,
  companyKey,
  clientId,
  onCompanyChange,
  onClientChange,
  showNameFilter = false,
  className,
}: {
  clients: Client[];
  companies: Company[];
  companyKey: string;
  clientId: string;
  onCompanyChange: (companyKey: string) => void;
  onClientChange: (clientId: string) => void;
  /** Adds a third dropdown to pick the client by its contact/client NAME (same selection as above). */
  showNameFilter?: boolean;
  className?: string;
}) {
  // Only offer companies that actually have a client, plus "No company" when
  // some clients are not linked to one.
  const companyOptions = useMemo(() => {
    const used = new Set(clients.map(companyKeyOf));
    const list = companies
      .filter((c) => used.has(c.id))
      .map((c) => ({ key: c.id, label: c.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (used.has(NO_COMPANY)) list.push({ key: NO_COMPANY, label: "No billing company" });
    return list;
  }, [clients, companies]);

  const visibleClients = useMemo(
    () =>
      [...clientsInCompany(clients, companyKey)].sort((a, b) =>
        (a.company || a.name).localeCompare(b.company || b.name),
      ),
    [clients, companyKey],
  );

  // Same clients, listed by client name (the person/contact) instead of company.
  const nameOptions = useMemo(() => {
    const list = [...clientsInCompany(clients, companyKey)].sort((a, b) =>
      (a.name || a.company).localeCompare(b.name || b.company),
    );
    const count = new Map<string, number>();
    for (const c of list) {
      const k = (c.name || c.company).trim().toLowerCase();
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    return list.map((c) => {
      const base = c.name || c.company;
      const dup = (count.get(base.trim().toLowerCase()) ?? 0) > 1 && c.company && c.company !== base;
      return {
        id: c.id,
        label:
          base +
          (dup ? ` — ${c.company}` : "") +
          (c.status !== "active" ? ` (${STATUS_LABEL[c.status]})` : ""),
      };
    });
  }, [clients, companyKey]);

  const handleCompany = (key: string) => {
    onCompanyChange(key);
    const inNew = clientsInCompany(clients, key);
    if (!inNew.some((c) => c.id === clientId)) {
      const next = inNew.find((c) => c.status === "active") ?? inNew[0];
      if (next) onClientChange(next.id);
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Select value={companyKey} onValueChange={handleCompany}>
        <SelectTrigger className="h-8 w-full text-[13px] sm:w-56" aria-label="Billing company">
          <SelectValue placeholder="Billing company" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_COMPANIES}>All billing companies</SelectItem>
          {companyOptions.map((o) => (
            <SelectItem key={o.key} value={o.key}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={clientId} onValueChange={onClientChange}>
        <SelectTrigger className="h-8 w-full text-[13px] sm:w-72" aria-label="Client">
          <SelectValue placeholder="Select client" />
        </SelectTrigger>
        <SelectContent>
          {visibleClients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.company || c.name}
              {c.status !== "active" ? ` (${STATUS_LABEL[c.status]})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showNameFilter ? (
        <Select value={clientId} onValueChange={onClientChange}>
          <SelectTrigger className="h-8 w-full text-[13px] sm:w-64" aria-label="Client name">
            <SelectValue placeholder="Client name" />
          </SelectTrigger>
          <SelectContent>
            {nameOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}