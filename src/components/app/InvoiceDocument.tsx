import { formatDate, formatMoney, round2 } from "@/lib/ledger/calc";
import type { InvoiceView } from "@/lib/ledger/calc";
import type { Client, Settings } from "@/lib/ledger/types";

/**
 * Print-only single invoice document: hidden on screen, shown in place of the
 * app UI under `@media print` (see the `.invoice-doc` rules in styles.css),
 * so a single invoice can be sent to a client as a PDF or paper copy.
 *
 * Mirrors the StatementDocument pattern in routes/statements.index.tsx —
 * same "hidden div + window.print()" approach, scoped to one invoice instead
 * of a client's whole running ledger.
 */
export function InvoiceDocument({
  settings,
  client,
  invoice,
}: {
  settings: Settings;
  client: Client | undefined;
  invoice: InvoiceView;
  /** Remaining (unprocessed) hours of this invoice; 0 when none / not an hours invoice. */
  remainingHours?: number;
}) {
  // Payroll split invoices: print ONLY the remaining-hours part. Sub total, VAT and
  // Total are shown for that part alone (display only; stored invoice data is untouched).
  const remainingOnly =
    !invoice.balanceOnly &&
    !(invoice.lineItems && invoice.lineItems.length > 0) &&
    invoice.hours != null &&
    invoice.rate != null &&
    (invoice.payrollHours ?? 0) > 0 &&
    (invoice.payrollRate ?? 0) > 0;
  const remainingAmount = remainingOnly
    ? round2(invoice.amountExVat - (invoice.payrollHours ?? 0) * (invoice.payrollRate ?? 0))
    : 0;
  const remainingVat = invoice.vatIncluded
    ? round2((remainingAmount * (invoice.vatRate ?? 0)) / 100)
    : 0;

  const contactLines: { label: string; value: string }[] = [
    { label: "Email", value: settings.businessEmail.trim() },
    { label: "Phone", value: settings.businessPhone.trim() },
    { label: "Web", value: (settings.businessWebsite ?? "").trim() },
  ].filter((c) => c.value);
  const bankDetails = (settings.bankDetails ?? "").trim();

  const logo = (settings.businessLogo ?? "").trim();
  const letterhead = (settings.businessLetterhead ?? "").trim();
  const marginTop = settings.letterheadMarginTop ?? 0;
  const marginBottom = settings.letterheadMarginBottom ?? 0;
  // Safe top/bottom gap to leave clear of the letterhead's own header/footer
  // artwork. Falls back to a plain 14mm when there's no letterhead.
  const pageMarginTop = letterhead ? marginTop : 14;
  const pageMarginBottom = letterhead ? marginBottom : 14;

  // --- Print workflow ---------------------------------------------------
  // `@page` is always `margin: 0` (see styles.css) so the letterhead image
  // — `position: fixed; top:0; left:0`, sized to the full 210mm x 297mm
  // sheet — prints edge-to-edge with no inset math. The content's safe
  // top/bottom gap instead comes from a `<table>` whose `<thead>`/`<tfoot>`
  // are blank spacer rows sized to the letterhead's header/footer artwork:
  // browsers natively reprint a table's thead/tfoot at the top/bottom of
  // every page it spans, so the real content (the single tbody cell) stays
  // clear of the letterhead on every printed page, and anything that
  // doesn't fit on one page flows onto the next automatically.
  const pageSideMarginMm = 12;

  const footerStrip = [
    settings.businessName.trim(),
    settings.businessAddress.trim().replace(/\n+/g, ", "),
    settings.businessPhone.trim(),
    settings.businessEmail.trim(),
    (settings.businessWebsite ?? "").trim(),
  ].filter(Boolean);

  return (
    <div className={letterhead ? "invoice-doc has-letterhead" : "invoice-doc"}>
      {letterhead ? <img className="id-letterhead-bg" src={letterhead} alt="" /> : null}
      <table className="id-page">
        <thead>
          <tr>
            <td style={{ height: `${pageMarginTop}mm` }} />
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td style={{ height: `${pageMarginBottom}mm` }} />
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="id-page-body" style={{ padding: `0 ${pageSideMarginMm}mm` }}>
              <header className="id-head">
                {letterhead ? null : (
                  <div className="id-identity">
                    {logo ? <img className="id-logo" src={logo} alt="" /> : null}
                    <div>
                      {settings.businessName.trim() ? (
                        <h1 className="id-business">{settings.businessName}</h1>
                      ) : null}
                      {settings.businessAddress.trim() ? (
                        <p className="id-lines">{settings.businessAddress}</p>
                      ) : null}
                      {contactLines.length > 0 ? (
                        <div className="id-contact">
                          {contactLines.map((c) => (
                            <p key={c.label} className="id-lines">
                              <span className="id-contact-label">{c.label}:</span> {c.value}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {settings.vatNumber.trim() ? (
                        <p className="id-lines">VAT No. {settings.vatNumber}</p>
                      ) : null}
                      {settings.companyNumber.trim() ? (
                        <p className="id-lines">Company No. {settings.companyNumber}</p>
                      ) : null}
                    </div>
                  </div>
                )}
                <div className="id-title-block">
                  <h2 className="id-title">Invoice</h2>
                  <p className="id-lines">Invoice No. {invoice.number}</p>
                  <p className="id-lines">Invoice date: {formatDate(invoice.invoiceDate)}</p>
                  <p className="id-lines">Due date: {formatDate(invoice.dueDate)}</p>
                  {invoice.poReference ? (
                    <p className="id-lines">PO/Ref: {invoice.poReference}</p>
                  ) : null}
                  {invoice.endClient?.trim() ? (
                    <p className="id-lines">Client: {invoice.endClient.trim()}</p>
                  ) : null}
                </div>
              </header>

              <section className="id-client">
                <p className="id-label">Bill to</p>
                <p className="id-client-name">{invoice.clientCompany}</p>
                {client?.name ? <p className="id-lines">{client.name}</p> : null}
                {client?.address ? <p className="id-lines">{client.address}</p> : null}
                {client?.vatNumber ? <p className="id-lines">VAT No. {client.vatNumber}</p> : null}
              </section>

              {/* Main + optional second description. Always printed, including
                  for Line Items invoices (whose rows carry their own text). */}
              {invoice.lineItems && invoice.lineItems.length > 0 && !invoice.balanceOnly ? (
                invoice.description?.trim() || invoice.description2?.trim() ? (
                  <section className="id-desc-block" style={{ marginBottom: "8px" }}>
                    {invoice.description?.trim() ? (
                      <p className="id-lines" style={{ whiteSpace: "pre-line" }}>
                        {invoice.description.trim()}
                      </p>
                    ) : null}
                    {invoice.description2?.trim() ? (
                      <p className="id-lines" style={{ whiteSpace: "pre-line" }}>
                        {invoice.description2.trim()}
                      </p>
                    ) : null}
                  </section>
                ) : null
              ) : null}

              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    {invoice.balanceOnly ? null : invoice.lineItems &&
                      invoice.lineItems.length > 0 ? (
                      <>
                        <th className="id-num">Qty</th>
                        <th className="id-num">Unit Price</th>
                      </>
                    ) : invoice.hours != null && invoice.rate != null ? (
                      <>
                        <th className="id-num">Hours</th>
                        <th className="id-num">Rate</th>
                      </>
                    ) : null}
                    <th className="id-num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.balanceOnly ? (
                    // VAT was applied on the outstanding balance only: show just
                    // that balance here. The full original amount and the earlier
                    // payment stay in the ledger / statement history.
                    <tr>
                      <td>
                        {invoice.description || "Services rendered"} — balance outstanding
                        {invoice.description2?.trim() ? (
                          <div style={{ whiteSpace: "pre-line" }}>
                            {invoice.description2.trim()}
                          </div>
                        ) : null}
                      </td>
                      <td className="id-num">{formatMoney(invoice.vatBase)}</td>
                    </tr>
                  ) : invoice.lineItems && invoice.lineItems.length > 0 ? (
                    invoice.lineItems.map((li) => (
                      <tr key={li.id}>
                        <td>{li.description || "—"}</td>
                        <td className="id-num">{li.quantity}</td>
                        <td className="id-num">{formatMoney(li.unitPrice)}</td>
                        <td className="id-num">{formatMoney(li.quantity * li.unitPrice)}</td>
                      </tr>
                    ))
                  ) : invoice.hours != null &&
                    invoice.rate != null &&
                    (invoice.payrollHours ?? 0) > 0 &&
                    (invoice.payrollRate ?? 0) > 0 ? (
                    // Payroll split: the payroll row is NOT printed on the invoice
                    // (only the remaining-hours row). Calculations are untouched.
                    <tr>
                      <td>
                        {invoice.description || "Services rendered"}
                        {invoice.description2?.trim() ? (
                          <div style={{ whiteSpace: "pre-line" }}>
                            {invoice.description2.trim()}
                          </div>
                        ) : null}
                      </td>
                      <td className="id-num">
                        {round2(invoice.hours - (invoice.payrollHours ?? 0))}
                      </td>
                      <td className="id-num">{formatMoney(invoice.rate)}/hr</td>
                      <td className="id-num">
                        {formatMoney(
                          round2(
                            invoice.amountExVat -
                              (invoice.payrollHours ?? 0) * (invoice.payrollRate ?? 0),
                          ),
                        )}
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td>
                        {invoice.description || "Services rendered"}
                        {invoice.description2?.trim() ? (
                          <div style={{ whiteSpace: "pre-line" }}>
                            {invoice.description2.trim()}
                          </div>
                        ) : null}
                      </td>
                      {invoice.hours != null && invoice.rate != null ? (
                        <>
                          <td className="id-num">{invoice.hours}</td>
                          <td className="id-num">{formatMoney(invoice.rate)}/hr</td>
                        </>
                      ) : null}
                      <td className="id-num">{formatMoney(invoice.amountExVat)}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <section className="id-summary">
                <dl>
                  <div>
                    <dt>Sub total</dt>
                    <dd>
                      {formatMoney(
                        remainingOnly
                          ? remainingAmount
                          : invoice.balanceOnly
                            ? invoice.vatBase
                            : invoice.amountExVat,
                      )}
                    </dd>
                  </div>
                  {invoice.vatIncluded ? (
                    <div>
                      <dt>VAT ({invoice.vatRate}%)</dt>
                      <dd>{formatMoney(remainingOnly ? remainingVat : invoice.vat)}</dd>
                    </div>
                  ) : null}
                  <div className="id-total">
                    <dt>Total due</dt>
                    <dd>
                      {formatMoney(
                        remainingOnly
                          ? round2(remainingAmount + remainingVat)
                          : invoice.balanceOnly
                            ? round2(invoice.vatBase + invoice.vat)
                            : invoice.total,
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="id-terms">
                {invoice.paymentTerms ? <p>Payment terms: {invoice.paymentTerms}</p> : null}
                {invoice.notes ? <p className="id-lines">{invoice.notes}</p> : null}
              </section>

              {bankDetails ? (
                <section className="id-bank">
                  <p className="id-label">Payment details</p>
                  <p className="id-lines">{bankDetails}</p>
                </section>
              ) : null}

              {letterhead ? (
                <footer className="id-footer">
                  <p className="id-footer-thanks">Thank you for your business.</p>
                </footer>
              ) : footerStrip.length > 0 ? (
                <footer className="id-footer">
                  <p className="id-footer-strip">{footerStrip.join("  •  ")}</p>
                  <p className="id-footer-thanks">Thank you for your business.</p>
                </footer>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
