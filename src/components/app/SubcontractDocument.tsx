import {
  formatDate,
  formatMoney,
  formatMonth,
  subcontractValue,
  subcontractVat,
  subcontractValueIncVat,
} from "@/lib/ledger/calc";
import type { Client, Settings, SubcontractEntry } from "@/lib/ledger/types";

/**
 * Print-only subcontractor work statement: same "hidden div + window.print()"
 * approach as InvoiceDocument (see routes/invoices.index.tsx), and reuses the
 * same .invoice-doc print styles for a consistent, on-brand look.
 *
 * This documents hours WE subcontracted out — not a receivable invoice to a
 * client — so VAT only shows up when the entry has it switched on (most
 * subcontractor payments are zero-rated/exempt, so usually it's just hours,
 * rate and total).
 */
export function SubcontractDocument({
  settings,
  client,
  entry,
}: {
  settings: Settings;
  client: Client | undefined;
  entry: SubcontractEntry;
}) {
  const value = subcontractValue(entry);
  const vat = subcontractVat(entry);
  const total = subcontractValueIncVat(entry);
  const logo = (settings.businessLogo ?? "").trim();
  const letterhead = (settings.businessLetterhead ?? "").trim();
  const marginTop = settings.letterheadMarginTop ?? 0;
  const marginBottom = settings.letterheadMarginBottom ?? 0;
  // Safe top/bottom gap to leave clear of the letterhead's own header/footer
  // artwork. Falls back to a plain 14mm when there's no letterhead. See the
  // print workflow note on InvoiceDocument for how this is actually
  // enforced on every printed page (a thead/tfoot spacer table, not
  // `@page` margin).
  const pageMarginTop = letterhead ? marginTop : 14;
  const pageMarginBottom = letterhead ? marginBottom : 14;
  const pageSideMarginMm = 12;

  const contactLines: { label: string; value: string }[] = [
    { label: "Email", value: settings.businessEmail.trim() },
    { label: "Phone", value: settings.businessPhone.trim() },
    { label: "Web", value: (settings.businessWebsite ?? "").trim() },
  ].filter((c) => c.value);

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
                    </div>
                  </div>
                )}
                <div className="id-title-block">
                  <h2 className="id-title">Subcontractor Statement</h2>
                  {entry.invoiceNumber ? (
                    <p className="id-lines">Ref. {entry.invoiceNumber}</p>
                  ) : null}
                  <p className="id-lines">Period: {formatMonth(entry.month)}</p>
                  {entry.invoiceDate ? (
                    <p className="id-lines">Date: {formatDate(entry.invoiceDate)}</p>
                  ) : null}
                  {entry.dueDate ? (
                    <p className="id-lines">Due date: {formatDate(entry.dueDate)}</p>
                  ) : null}
                  {entry.reference ? (
                    <p className="id-lines">Reference: {entry.reference}</p>
                  ) : null}
                </div>
              </header>

              <section className="id-client">
                <p className="id-label">Subcontractor</p>
                <p className="id-client-name">{entry.subcontractorName}</p>
                {client?.company ? (
                  <p className="id-lines">Work allocated under: {client.company}</p>
                ) : null}
              </section>

              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="id-num">Hours</th>
                    <th className="id-num">Rate</th>
                    <th className="id-num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{entry.description || "Subcontracted hours"}</td>
                    <td className="id-num">{entry.hoursProceed}</td>
                    <td className="id-num">{formatMoney(entry.rate)}/hr</td>
                    <td className="id-num">{formatMoney(value)}</td>
                  </tr>
                </tbody>
              </table>

              <section className="id-summary">
                <dl>
                  {entry.vatIncluded ? (
                    <>
                      <div>
                        <dt>Subtotal</dt>
                        <dd>{formatMoney(value)}</dd>
                      </div>
                      <div>
                        <dt>VAT ({entry.vatRate}%)</dt>
                        <dd>{formatMoney(vat)}</dd>
                      </div>
                    </>
                  ) : null}
                  <div className="id-total">
                    <dt>Total</dt>
                    <dd>{formatMoney(total)}</dd>
                  </div>
                </dl>
              </section>

              {entry.notes ? (
                <section className="id-terms">
                  <p className="id-lines">{entry.notes}</p>
                </section>
              ) : null}

              {footerStrip.length > 0 ? (
                <footer className="id-footer">
                  <p className="id-footer-strip">{footerStrip.join("  •  ")}</p>
                </footer>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
