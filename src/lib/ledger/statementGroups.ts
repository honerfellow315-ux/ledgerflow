import type { Client, LedgerData } from "./types";
import {
  applyClientCredit,
  creditNoteOwnerClientId,
  creditNoteTotal,
  paymentOwnerClientId,
  round2,
  type InvoiceView,
} from "./calc";
export const clientNameKey = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
export function multiCompanyClients(clients: Client[]) {
  const groups = new Map<string, Client[]>();
  for (const c of clients) {
    const key = clientNameKey(c.name);
    if (key) groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups]
    .map(([key, clients]) => ({
      key,
      name: clients[0]!.name,
      clients,
      companyCount: new Set(clients.map((c) => `${c.companyId ?? ""}|${clientNameKey(c.company)}`))
        .size,
    }))
    .filter((g) => g.companyCount > 1)
    .sort((a, b) => a.name.localeCompare(b.name));
}
export interface GroupEntry {
  id: string;
  clientId: string;
  company: string;
  billing: string;
  date: string;
  type: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}
export function groupStatement(
  data: LedgerData,
  views: InvoiceView[],
  clients: Client[],
  month = "",
) {
  const ids = new Set(clients.map((c) => c.id));
  const byClient = new Map(clients.map((c) => [c.id, c]));
  const invoiceMap = new Map(views.map((i) => [i.id, i]));
  const entries: GroupEntry[] = [];
  function add(
    clientId: string,
    e: Omit<GroupEntry, "clientId" | "company" | "billing" | "balance">,
  ) {
    const c = byClient.get(clientId);
    if (!c) return;
    entries.push({
      ...e,
      clientId,
      company: c.company || c.name,
      billing:
        data.companies.find((x) => x.id === c.companyId)?.name ||
        data.settings.businessName ||
        "Unassigned",
      balance: 0,
    });
  }
  const selected = views.filter((i) => ids.has(i.clientId));
  for (const i of selected)
    add(i.clientId, {
      id: `i:${i.id}`,
      date: i.invoiceDate,
      type: "Invoice",
      reference: i.number,
      description: i.description,
      debit: i.total,
      credit: 0,
    });
  for (const p of data.payments) {
    const owner = paymentOwnerClientId(p, invoiceMap);
    if (owner)
      add(owner, {
        id: `p:${p.id}`,
        date: p.date,
        type: "Payment",
        reference: p.reference || invoiceMap.get(p.invoiceId)?.number || "",
        description: `Payment (${p.method})`,
        debit: 0,
        credit: p.amount,
      });
  }
  for (const n of data.creditNotes) {
    const owner = creditNoteOwnerClientId(n, invoiceMap);
    if (owner && n.status !== "draft")
      add(owner, {
        id: `c:${n.id}`,
        date: n.date,
        type: "Credit Note",
        reference: n.number,
        description: n.reason,
        debit: 0,
        credit: creditNoteTotal(n),
      });
  }
  const rank: Record<string, number> = { Invoice: 0, "Credit Note": 1, Payment: 2 };
  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || rank[a.type]! - rank[b.type]! || a.id.localeCompare(b.id),
  );
  let balance = 0;
  for (const e of entries) {
    balance = round2(balance + e.debit - e.credit);
    e.balance = balance;
  }
  const opening = month
    ? (entries.filter((e) => e.date.slice(0, 7) < month).at(-1)?.balance ?? 0)
    : 0;
  const rows = month ? entries.filter((e) => e.date.startsWith(month)) : entries;
  // Credit stays within each legal account, never moves across grouped companies.
  const adjusted = clients.flatMap(
    (c) => applyClientCredit(selected.filter((i) => i.clientId === c.id)).views,
  );
  return {
    rows,
    opening,
    closing: rows.at(-1)?.balance ?? opening,
    accountBalance: balance,
    months: [...new Set(entries.map((e) => e.date.slice(0, 7)))].sort().reverse(),
    invoiced: round2(rows.reduce((s, e) => s + e.debit, 0)),
    received: round2(rows.filter((e) => e.type === "Payment").reduce((s, e) => s + e.credit, 0)),
    overdue: round2(
      adjusted.filter((i) => i.ageing > 0).reduce((s, i) => s + i.effectiveOutstanding, 0),
    ),
  };
}
