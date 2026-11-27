import type { CSSProperties } from "react";
import { formatDate, formatMoney, round2, type InvoiceViewWithCredit } from "@/lib/ledger/calc";
import type { Client, Settings } from "@/lib/ledger/types";

const STATUS_LABEL = { paid: "Paid", partial: "Partially paid", unpaid: "Unpaid" } as const;

/**
 * Print-only "Invoice Statement": the client's invoices and where each one stands, with NO account
 * ledger. It reuses the page frame, letterhead handling and `sd-*` classes of the account statement
 * (StatementDocument / StatementDocumentSafari in routes/statements.index.tsx), so it prints on the
 * billing company's saved letterhead through the same window.print() path. Those two components
 * are untouched; only one of the statement documents is rendered at a time.
 */
export function InvoiceStatusDocument({
  settings,
  client,
  endClientLabel,
  invoices,
  statementDate,
  safari,
}: {
  settings: Settings;
  client: Client;
  endClientLabel?: string | undefined;
  invoices: InvoiceViewWithCredit[];
  statementDate: string;
  /** Same switch as the account statement: Safari/iOS needs the other letterhead technique. */
  safari: boolean;
}) {
  const contact = [settings.businessEmail, settings.businessPhone].filter((v) => v.trim());

  const letterhead = (settings.businessLetterhead ?? "").trim();
  const marginTop = settings.letterheadMarginTop ?? 0;
  const marginBottom = settings.letterheadMarginBottom ?? 0;
  const pageMarginTop = letterhead ? marginTop : 14;
  const pageMarginBottom = letterhead ? marginBottom : 14;
  const pageSideMarginMm = 12;

  const letterheadStyle =
    safari && letterhead
      ? ({ "--sd-letterhead-image": `url(${letterhead})` } as CSSProperties)
      : undefined;
  const wrapperClass = safari ? "statement-doc-safari" : "statement-doc";

  const sorted = [...invoices].sort(
    (a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.number.localeCompare(b.number),
  );
  const count = { paid: 0, partial: 0, unpaid: 0 };
  let total = 0;
  let settled = 0;
  let outstanding = 0;
  const lines = sorted.map((v) => {
    const left = round2(v.effectiveOutstanding);
    const done = round2(v.total - left);
    count[v.effectiveStatus] += 1;
    total += v.total;
    settled += done;
    outstanding += left;
    return { v, left, done };
  });

  return (
    <div
      className={letterhead ? `${wrapperClass} has-letterhead` : wrapperClass}
      style={letterheadStyle}
    >
      {!safari && letterhead ? <img className="sd-letterhead-bg" src={letterhead} alt="" /> : null}
      <table className="sd-page">
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
            <td className="sd-page-body" style={{ padding: `0 ${pageSideMarginMm}mm` }}>
              <header className="sd-head">
                {letterhead ? (
                  <div />
                ) : (
                  <div>
                    {settings.businessName.trim() ? (
                      <h1 className="sd-business">{settings.businessName}</h1>
                    ) : null}
                    {settings.businessAddress.trim() ? (
                      <p className="sd-lines">{settings.businessAddress}</p>
                    ) : null}
                    {contact.length > 0 ? <p className="sd-lines">{contact.join("\n")}</p> : null}
                    {settings.vatNumber.trim() ? (
                      <p className="sd-lines">VAT No. {settings.vatNumber}</p>
                    ) : null}
                    {settings.companyNumber.trim() ? (
                      <p className="sd-lines">Company No. {settings.companyNumber}</p>
                    ) : null}
                  </div>
                )}
                <div className="sd-title-block">
                  <h2 className="sd-title">Invoice Statement</h2>
                  <p className="sd-lines">Statement date: {formatDate(statementDate)}</p>
                  {client.accountReference ? (
                    <p className="sd-lines">Account ref: {client.accountReference}</p>
                  ) : null}
                </div>
              </header>

              <section className="sd-client">
                <p className="sd-label">Statement for</p>
                <p className="sd-client-name">{client.company}</p>
                <p className="sd-lines">{client.name}</p>
                {endClientLabel ? <p className="sd-lines">Client: {endClientLabel}</p> : null}
                {client.address ? <p className="sd-lines">{client.address}</p> : null}
                {client.vatNumber ? <p className="sd-lines">VAT No. {client.vatNumber}</p> : null}
              </section>

              {lines.length === 0 ? (
                <p className="sd-empty">There are no invoices to show for this client.</p>
              ) : (
                <section className="sd-outstanding">
                  <table className="sd-ob-table">
                    <thead>
                      <tr>
                        <th>Invoice No.</th>
                        <th>Invoice Date</th>
                        <th>Due Date</th>
                        <th className="sd-num">Total</th>
                        <th className="sd-num">Paid / credited</th>
                        <th className="sd-num">Outstanding</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(({ v, left, done }) => (
                        <tr key={v.id}>
                          <td className="sd-nowrap">{v.number}</td>
                          <td className="sd-nowrap">{formatDate(v.invoiceDate)}</td>
                          <td className="sd-nowrap">{formatDate(v.dueDate)}</td>
                          <td className="sd-num">{formatMoney(v.total)}</td>
                          <td className="sd-num">{formatMoney(done)}</td>
                          <td className="sd-num">{formatMoney(left)}</td>
                          <td className="sd-nowrap">{STATUS_LABEL[v.effectiveStatus]}</td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 700 }}>
                        <td colSpan={3}>Total</td>
                        <td className="sd-num">{formatMoney(round2(total))}</td>
                        <td className="sd-num">{formatMoney(round2(settled))}</td>
                        <td className="sd-num">{formatMoney(round2(outstanding))}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                  <p className="sd-lines">
                    {lines.length} invoice{lines.length === 1 ? "" : "s"} · Paid: {count.paid} ·
                    Partially paid: {count.partial} · Unpaid: {count.unpaid}
                  </p>
                </section>
              )}

              {contact.length > 0 ? (
                <p className="sd-lines">
                  If anything on this statement looks wrong, please contact {contact.join(" or ")}.
                </p>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
