import assert from "node:assert/strict";
import { multiCompanyClients, groupStatement } from "../src/lib/ledger/statementGroups";
import { buildInvoiceViews, suggestNextInvoiceNumber } from "../src/lib/ledger/calc";
import type { Client, Invoice, LedgerData } from "../src/lib/ledger/types";
const clients = [
  { id: "a", name: "POD Management", company: "Alpha", companyId: "ours-a" },
  { id: "b", name: " pod   management ", company: "Beta", companyId: "ours-b" },
  { id: "c", name: "Different", company: "Gamma" },
] as Client[];
const inv = (id: string, clientId: string, amount: number, date: string): Invoice => ({
  id,
  number: id,
  clientId,
  invoiceDate: date,
  dueDate: date,
  amountExVat: amount,
  vatIncluded: false,
  vatRate: 0,
  description: "Test",
  paymentTerms: "",
});
const invoices = [inv("099", "a", 100, "2026-09-01"), inv("100", "b", 200, "2026-10-01")];
const data = {
  clients,
  companies: [],
  settings: { businessName: "Test billing" },
  invoices,
  payments: [
    {
      id: "p",
      invoiceId: "099",
      clientId: "a",
      date: "2026-09-02",
      amount: 150,
      method: "Bank",
      reference: "",
    },
  ],
  creditNotes: [],
} as unknown as LedgerData;
const views = buildInvoiceViews(invoices, data.payments, clients, data.creditNotes);
assert.equal(multiCompanyClients(clients).length, 1);
assert.equal(multiCompanyClients(clients)[0]?.companyCount, 2);
const result = groupStatement(data, views, clients.slice(0, 2));
assert.equal(result.accountBalance, 150);
assert.equal(result.overdue, 200, "Credit from Alpha must not pay Beta");
const october = groupStatement(data, views, clients.slice(0, 2), "2026-10");
assert.equal(october.opening, -50);
assert.equal(october.closing, 150);
assert.equal(october.rows.length, 1);
assert.equal(groupStatement(data, views, [clients[0]!]).accountBalance, -50);
assert.equal(groupStatement(data, views, [clients[1]!]).accountBalance, 200);
assert.deepEqual(
  ["99", "100", "9"].sort((a, b) => b.localeCompare(a, "en-GB", { numeric: true })),
  ["100", "99", "9"],
);
assert.equal(
  suggestNextInvoiceNumber({ invoices, clients, clientId: "a", prefix: "", fallbackNext: 1 }),
  "100",
);
assert.equal(
  suggestNextInvoiceNumber({ invoices, clients, clientId: "c", prefix: "", fallbackNext: 1 }),
  "001",
);
console.log(
  "PASS: same-name grouping, independent account credits, period opening balances, company totals and invoice numbering.",
);
