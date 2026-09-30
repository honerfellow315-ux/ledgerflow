import { creditNoteTotal, creditNoteVat, formatDate, formatMoney } from "@/lib/ledger/calc";
import type { Client, CreditNote, Settings } from "@/lib/ledger/types";

/**
 * Safari/iOS-safe credit note. Reuses `.invoice-doc-safari` layout + CSS from
 * InvoiceDocument.safari (letterhead painted as thead/tfoot background).
 */
export function CreditNoteDocumentSafari({
  settings,
  client,
  note,
  invoiceNumber,
}: {
  settings: Settings;
  client: Client | undefined;
  note: CreditNote;
  invoiceNumber?: string | undefined;
}) {
  const contactLines: { label: string; value: string }[] = [
    { label: "Email", value: settings.businessEmail.trim() },
    { label: "Phone", value: settings.businessPhone.trim() },
    { label: "Web", value: (settings.businessWebsite ?? "").trim() },
  ].filter((c) => c.value);

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
                  <h2 className="id-title">Credit Note</h2>
                  <p className="id-lines">Credit Note No. {note.number}</p>
                  <p className="id-lines">Credit note date: {formatDate(note.date)}</p>
                  {invoiceNumber ? (
                    <p className="id-lines">Against invoice: {invoiceNumber}</p>
                  ) : null}
                </div>
              </header>

              <section className="id-client">
                <p className="id-label">Credit to</p>
                <p className="id-client-name">{client?.company ?? "—"}</p>
                {client?.name ? <p className="id-lines">{client.name}</p> : null}
                {client?.address ? <p className="id-lines">{client.address}</p> : null}
                {client?.vatNumber ? <p className="id-lines">VAT No. {client.vatNumber}</p> : null}
              </section>

              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="id-num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      {note.reason || "Credit"}
                      {invoiceNumber ? ` (against invoice ${invoiceNumber})` : ""}
                    </td>
                    <td className="id-num">{formatMoney(note.amountExVat)}</td>
                  </tr>
                </tbody>
              </table>

              <section className="id-summary">
                <dl>
                  <div>
                    <dt>Sub total</dt>
                    <dd>{formatMoney(note.amountExVat)}</dd>
                  </div>
                  {note.vatIncluded ? (
                    <div>
                      <dt>VAT ({note.vatRate}%)</dt>
                      <dd>{formatMoney(creditNoteVat(note))}</dd>
                    </div>
                  ) : null}
                  <div className="id-total">
                    <dt>Total credit</dt>
                    <dd>{formatMoney(creditNoteTotal(note))}</dd>
                  </div>
                </dl>
              </section>

              {note.comments ? (
                <section className="id-terms">
                  <p className="id-lines">{note.comments}</p>
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