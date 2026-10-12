import { useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useLedger } from "@/lib/ledger/store";
import { groupStatement } from "@/lib/ledger/statementGroups";
import type { Client } from "@/lib/ledger/types";
import { formatMoney, formatDate, formatMonth } from "@/lib/ledger/calc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { downloadCsv } from "@/lib/ledger/csv";

export function GroupedStatement({
  name,
  clients,
  onBack,
  renderPrint,
}: {
  name: string;
  clients: Client[];
  onBack: () => void;
  renderPrint: (clients: Client[], month: string, billingClient: Client) => ReactNode;
}) {
  const { data, invoiceViews } = useLedger();
  const [selected, setSelected] = useState(clients.map((c) => c.id));
  const [month, setMonth] = useState("");
  const [printClientId, setPrintClientId] = useState("");
  const [billingKey, setBillingKey] = useState("");
  const [separate, setSeparate] = useState(false);
  const picked = useMemo(() => clients.filter((c) => selected.includes(c.id)), [clients, selected]);
  const billingOptions = [...new Map(picked.map((c) => [c.companyId || "default", c])).entries()];
  const billingClient =
    billingOptions.length === 1
      ? billingOptions[0]![1]
      : billingOptions.find(([key]) => key === billingKey)?.[1];
  const printClients = separate ? picked.filter((c) => c.id === printClientId) : picked;
  const printBilling = separate ? printClients[0] : billingClient;
  const print = (clientId = "") => {
    flushSync(() => setPrintClientId(clientId));
    window.print();
  };
  const combined = groupStatement(data, invoiceViews, picked, month);
  const sections = separate
    ? picked.map((c) => ({
        id: c.id,
        title: `${c.company || c.name} — ${data.companies.find((x) => x.id === c.companyId)?.name || "Unassigned"}`,
        result: groupStatement(data, invoiceViews, [c], month),
      }))
    : [{ id: "combined", title: `${name} — combined statement`, result: combined }];
  const download = () =>
    downloadCsv(
      `combined-statement-${month || "all"}.csv`,
      [
        "Company",
        "Billing company",
        "Date",
        "Type",
        "Reference",
        "Description",
        "Debit",
        "Credit",
        "Balance",
      ],
      [
        ["", "", "", "Opening balance", "", "", "", "", combined.opening],
        ...combined.rows.map((r) =>
          [
            r.company,
            r.billing,
            r.date,
            r.type,
            r.reference,
            r.description,
            r.debit,
            r.credit,
            r.balance,
          ].map((v) => (typeof v === "string" && /^[=+@\-\t\r]/.test(v) ? `'${v}` : v)),
        ),
      ],
    );
  return (
    <>
      <div className="group-statements statement-screen space-y-4">
        <div className="statement-screen space-y-4">
          <Panel>
            <PanelHeader
              title={name}
              description="Combined view only. Individual client accounts and their credits remain separate."
            />
            <div className="space-y-3 p-4">
              <Button variant="outline" onClick={onBack}>
                Back to individual statements
              </Button>
              <p className="text-sm text-muted-foreground">
                Same-name matches are suggestions. Select the companies that belong to this client
                before printing.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {clients.map((c) => (
                  <label key={c.id} className="flex items-start gap-2 rounded border p-3 text-sm">
                    <Checkbox
                      checked={selected.includes(c.id)}
                      onCheckedChange={(v) =>
                        setSelected((s) => (v ? [...s, c.id] : s.filter((id) => id !== c.id)))
                      }
                    />
                    <span>
                      {c.company || c.name}
                      <small className="block text-muted-foreground">
                        Billing:{" "}
                        {data.companies.find((x) => x.id === c.companyId)?.name || "Unassigned"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={month || "all"}
                  onValueChange={(v) => setMonth(v === "all" ? "" : v)}
                >
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All months</SelectItem>
                    {groupStatement(data, invoiceViews, clients).months.map((m) => (
                      <SelectItem key={m} value={m}>
                        {formatMonth(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={separate ? "separate" : "combined"}
                  onValueChange={(v) => setSeparate(v === "separate")}
                >
                  <SelectTrigger className="w-full sm:w-60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="combined">One combined statement</SelectItem>
                    <SelectItem value="separate">Separate company statements</SelectItem>
                  </SelectContent>
                </Select>
                {!separate && billingOptions.length > 1 ? (
                  <Select value={billingKey} onValueChange={setBillingKey}>
                    <SelectTrigger className="w-full sm:w-64" aria-label="Print letterhead">
                      <SelectValue placeholder="Choose billing company letterhead" />
                    </SelectTrigger>
                    <SelectContent>
                      {billingOptions.map(([key, c]) => (
                        <SelectItem key={key} value={key}>
                          {data.companies.find((x) => x.id === c.companyId)?.name ||
                            data.settings.businessName ||
                            "Default business"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {!separate ? (
                  <Button disabled={!picked.length || !billingClient} onClick={() => print()}>
                    Print / Save PDF
                  </Button>
                ) : null}
                <Button variant="outline" disabled={!picked.length} onClick={download}>
                  Export combined CSV
                </Button>
              </div>
            </div>
          </Panel>
        </div>
        {!picked.length ? (
          <p>Select at least one company.</p>
        ) : (
          sections.map((s) => (
            <section
              key={s.id}
              className="group-statement-page rounded-lg border bg-background p-4"
            >
              {separate ? (
                <Button className="mb-3" onClick={() => print(s.id)}>
                  Print this company / Save PDF
                </Button>
              ) : null}
              <h2 className="text-xl font-semibold">Statement of Account</h2>
              <h3 className="mt-1 font-semibold">{s.title}</h3>
              <p className="text-sm">
                {month ? formatMonth(month) : "All account history"} · {name}
              </p>
              <p className="my-3 text-sm">
                Opening: {formatMoney(s.result.opening)} · Invoiced:{" "}
                {formatMoney(s.result.invoiced)} · Received: {formatMoney(s.result.received)} ·
                Closing balance: {formatMoney(s.result.closing)}
              </p>
              <TableWrap>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      {[
                        "Company / Billing",
                        "Date",
                        "Type / Reference",
                        "Description",
                        "Debit",
                        "Credit",
                        "Balance",
                      ].map((h) => (
                        <th key={h} className="p-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.result.rows.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2">
                          {r.company}
                          <br />
                          {r.billing}
                        </td>
                        <td className="p-2">{formatDate(r.date)}</td>
                        <td className="p-2">
                          {r.type}
                          <br />
                          {r.reference}
                        </td>
                        <td className="p-2">{r.description}</td>
                        <td className="p-2 whitespace-nowrap">{formatMoney(r.debit)}</td>
                        <td className="p-2 whitespace-nowrap">{formatMoney(r.credit)}</td>
                        <td className="p-2 whitespace-nowrap">{formatMoney(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              {!s.result.rows.length ? (
                <p className="py-3 text-sm">No transactions in this period.</p>
              ) : null}
              <p className="mt-3 text-sm font-semibold">
                Closing balance: {formatMoney(s.result.closing)}
              </p>
            </section>
          ))
        )}
      </div>
      {printClients.length > 0 && printBilling
        ? renderPrint(printClients, month, printBilling)
        : null}
    </>
  );
}
