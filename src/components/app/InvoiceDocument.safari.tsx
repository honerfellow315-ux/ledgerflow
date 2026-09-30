import { formatDate, formatMoney, round2 } from "@/lib/ledger/calc";
import type { InvoiceView } from "@/lib/ledger/calc";
import type { Client, Settings } from "@/lib/ledger/types";

/**
 * Safari/iOS-safe variant of InvoiceDocument. Content and copy are
 * identical — only the letterhead mechanism differs, because WebKit's print
 * engine doesn't repaint `position: fixed` elements past the first printed
 * page (see src/lib/print-browser.ts for the full explanation).
 *
 * Here the letterhead is painted as a CSS background on the SAME
 * `<thead>`/`<tfoot>` spacer cells that already reserve the safe top/bottom
 * gap — thead/tfoot repeating on every printed page is plain table
 * behaviour every engine (Safari included) supports natively, so this
 * repeats correctly without relying on fixed positioning at all. The
 * top slice of the letterhead shows through the thead cell, the bottom
 * slice through the tfoot cell — see `.invoice-doc-safari` in
 * styles.print-safari.css for the actual background-position math.
 *
 * DO NOT change InvoiceDocument.tsx or its styles to match this — that
 * component is the working Chrome/Edge/Firefox path and must stay untouched.
 */
export function InvoiceDocumentSafari({
  settings,
  client,
  invoice,
}: {
  settings: Settings;
  client: Client | undefined;
  invoice: InvoiceView;
}) {
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
  const pageMarginTop = letterhead ? marginTop : 14;
  const pageMarginBottom = letterhead ? marginBottom : 14;
  const pageSideMarginMm = 12;

  const footerStrip = [
    settings.businessName.trim(),
    settings.businessAddress.trim().replace(/\n+/g, ", "),
    settings.businessPhone.trim(),
    settings.businessEmail.trim(),
    (settings.businessWebsite ?? "").trim(),
  ].filter(Boolean);

  // Passed down as a CSS custom property so styles.print-safari.css can use
  // it as a `background-image` on the thead/tfoot cells — no `<img>`
  // element involved, so there's nothing for WebKit to drop after page 1.
  const letterheadStyle = letterhead
    ? ({ "--id-letterhead-image": `url(${letterhead})` } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={letterhead ? "invoice-doc-safari has-letterhead" : "invoice-doc-safari"}
      style={letterheadStyle}
    >
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
                </div>
              </header>

              <section className="id-client">
                <p className="id-label">Bill to</p>
                <p className="id-client-name">{invoice.clientCompany}</p>
                {client?.name ? <p className="id-lines">{client.name}</p> : null}
                {client?.address ? <p className="id-lines">{client.address}</p> : null}
                {client?.vatNumber ? <p className="id-lines">VAT No. {client.vatNumber}</p> : null}
              </section>

              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    {invoice.balanceOnly ? null : invoice.lineItems && invoice.lineItems.length > 0 ? (
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
                      <td>{invoice.description || "Services rendered"} — balance outstanding</td>
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
                  ) : (
                    <tr>
                      <td>{invoice.description || "Services rendered"}</td>
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
                    <dd>{formatMoney(invoice.balanceOnly ? invoice.vatBase : invoice.amountExVat)}</dd>
                  </div>
                  {invoice.vatIncluded ? (
                    <div>
                      <dt>VAT ({invoice.vatRate}%)</dt>
                      <dd>{formatMoney(invoice.vat)}</dd>
                    </div>
                  ) : null}
                  <div className="id-total">
                    <dt>Total due</dt>
                    <dd>
                      {formatMoney(
                        invoice.balanceOnly ? round2(invoice.vatBase + invoice.vat) : invoice.total,
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
