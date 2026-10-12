import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { invoices, clients, companies, settings } from "../../../drizzle/schema";
import { suggestNextInvoiceNumber } from "../ledger/calc";
import type { Invoice, Client } from "../ledger/types";
export async function lockInvoiceNumbers() {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ledgerflow-invoice-numbers'))`);
}
export async function nextInvoiceNumber(clientId: string) {
  const allClients = await db.select().from(clients);
  const client = allClients.find((c) => c.id === clientId);
  if (!client) throw new Error("Client no longer exists.");
  const [config] = await db.select().from(settings).where(eq(settings.id, "default"));
  const company = client.companyId
    ? (await db.select().from(companies).where(eq(companies.id, client.companyId)))[0]
    : undefined;
  const all = await db.select().from(invoices);
  return suggestNextInvoiceNumber({
    invoices: all as unknown as Invoice[],
    clients: allClients as unknown as Client[],
    clientId,
    prefix: company?.invoicePrefix?.trim() || config?.invoicePrefix || "INV-",
    fallbackNext: config?.nextInvoiceNumber ?? 1,
  });
}
export async function checkInvoiceNumber(number: string, clientId: string, exceptId = "") {
  const found =
    await db.execute(sql`SELECT i.id FROM invoices i JOIN clients c ON c.id=i.client_id JOIN clients target ON target.id=${clientId}
 WHERE lower(btrim(i.number))=lower(btrim(${number})) AND i.id<>${exceptId}
 AND coalesce('company:'||c.company_id,'client:'||c.id)=coalesce('company:'||target.company_id,'client:'||target.id) LIMIT 1`);
  if (found.rows.length)
    throw new Error(
      "That invoice number already exists in this billing company, including the recycle bin. Choose another number.",
    );
}
