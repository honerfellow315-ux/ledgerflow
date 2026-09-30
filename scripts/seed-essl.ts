/**
 * One-off seed: adds the ESSL company + Showsec client + the ESS/624
 * invoice, using the data read off the reference invoice PDF the client
 * shared (European Security Services (London) Limited → Showsec
 * International Ltd, invoice ESS/624, 14/09/2026).
 *
 * This is here purely so the client can see a real, working example inside
 * the app (Companies, Clients, Invoices) without typing it in by hand.
 * Safe to re-run: if a company with this name or an invoice with this
 * number already exists, it skips re-inserting that row.
 *
 * Usage (after DATABASE_URL is set in .env):
 *   npx tsx scripts/seed-essl.ts
 *   (or: bun run scripts/seed-essl.ts)
 *
 * NOTE: this fills in the company/client/invoice DATA only. It does not
 * upload a letterhead image — the source PDF was a filled-in invoice, not a
 * blank letterhead. To get the "print on letterhead" look for this company,
 * open Companies → European Security Services (London) Limited → Edit, and
 * upload a blank/clean export of their letterhead there.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../drizzle/schema";

async function main() {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) throw new Error("DATABASE_URL is not set — check your .env file.");

  const sql = neon(connectionString);
  const db = drizzle(sql, { schema });

  const companyName = "European Security Services (London) Limited";

  let [company] = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.name, companyName))
    .limit(1);

  if (!company) {
    const id = `co-${Date.now().toString(36)}`;
    const [row] = await db
      .insert(schema.companies)
      .values({
        id,
        name: companyName,
        email: "accounts@esslondon.co.uk",
        phone: "0333 3050977 / 0333 3050012",
        address: "240 York Road, Leeds, England, LS9 9BP",
        vatNumber: "815453240",
        companyNumber: "04817379",
        website: "www.esslondon.com",
        bankDetails:
          "Bank Name: Lloyds Bank\nAccount name: European Security Services (London) Ltd\nAccount number: 03759296\nSort code: 30-98-91",
      })
      .returning();
    company = row;
    console.log(`Company created: ${companyName} (${company?.id})`);
  } else {
    console.log(`Company already exists: ${companyName} (${company.id}) — reusing it.`);
  }
  if (!company) throw new Error("Failed to create or find the company.");

  const clientName = "Showsec International Ltd";

  let [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.name, clientName))
    .limit(1);

  if (!client) {
    const id = `cl-${Date.now().toString(36)}`;
    const [row] = await db
      .insert(schema.clients)
      .values({
        id,
        name: clientName,
        company: clientName,
        address: "HO Leicester, Regent House, 16 West Walk, Leicester, LE1 7NA",
        status: "active",
        companyId: company.id,
      })
      .returning();
    client = row;
    console.log(`Client created: ${clientName} (${client?.id})`);
  } else {
    console.log(`Client already exists: ${clientName} (${client.id}) — reusing it.`);
  }
  if (!client) throw new Error("Failed to create or find the client.");

  const invoiceNumber = "ESS/624";
  const [existingInvoice] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.number, invoiceNumber))
    .limit(1);

  if (existingInvoice) {
    console.log(`Invoice ${invoiceNumber} already exists — skipping.`);
  } else {
    const id = `inv-${Date.now().toString(36)}`;
    await db.insert(schema.invoices).values({
      id,
      number: invoiceNumber,
      clientId: client.id,
      invoiceDate: "2026-09-14",
      // Not printed on the source invoice — defaulted to the invoice date;
      // adjust in the Invoices screen if the real due date differs.
      dueDate: "2026-09-14",
      poReference: "51898",
      description:
        "SIA Door Licence, Amount: 2, From: 20:00, To: 08:00 — Big Retreat, Cambridgeshire PE28 2PH (Date: 12-09-2026)",
      amountExVat: 438.0,
      hours: 24,
      rate: 18.25,
      vatIncluded: true,
      vatRate: 20,
      paymentTerms: "",
      notes: "Imported from reference invoice ESS/624 for demo purposes.",
    });
    console.log(`Invoice created: ${invoiceNumber}`);
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
