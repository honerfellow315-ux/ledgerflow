import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Clock, FileText, Pencil, Plus, Search, Trash2 } from "@/lib/icons";
import { toast } from "sonner";
import { useLedger } from "@/lib/ledger/store";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import {
  formatHours,
  formatMoney,
  formatMonth,
  hoursPaidForEntry,
  hoursRemainingToPay,
  hoursValue,
  remainingHours,
  round2,
} from "@/lib/ledger/calc";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { HoursDialog } from "@/components/app/HoursDialog";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HoursEntry } from "@/lib/ledger/types";

export const Route = createFileRoute("/hours/")({
  head: () => ({
    meta: [
      { title: "Hours — LedgerFlow" },
      {
        name: "description",
        content:
          "Monthly hours ledger per client, with payroll, management payroll and unpaid hours deducted to give billable remaining hours and value.",
      },
      { property: "og:title", content: "Hours — LedgerFlow" },
      {
        property: "og:description",
        content: "Track total, payroll and remaining billable hours per client each month.",
      },
    ],
  }),
  component: HoursPage,
});

const thisMonth = () => new Date().toISOString().slice(0, 7);

function HoursPage() {
  return (
    <RequireView module="hours">
      <HoursPageContent />
    </RequireView>
  );
}

function HoursPageContent() {
  const { data, deleteHours, invoiceViews } = useLedger();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HoursEntry | null>(null);
  const [toDelete, setToDelete] = useState<HoursEntry | null>(null);

  const clientById = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const invoiceViewById = useMemo(
    () => new Map(invoiceViews.map((v) => [v.id, v])),
    [invoiceViews],
  );
  const companyById = useMemo(
    () => new Map(data.companies.map((c) => [c.id, c])),
    [data.companies],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.hours
      .filter((h) => (clientId === "all" ? true : h.clientId === clientId))
      .filter((h) =>
        companyId === "all" ? true : (clientById.get(h.clientId)?.companyId ?? null) === companyId,
      )
      .filter((h) => (fromMonth ? h.month >= fromMonth : true))
      .filter((h) => (toMonth ? h.month <= toMonth : true))
      .filter((h) => {
        if (!q) return true;
        const client = clientById.get(h.clientId);
        return `${h.month} ${client?.company ?? ""} ${client?.name ?? ""} ${h.notes ?? ""}`
          .toLowerCase()
          .includes(q);
      })
      .map((h) => {
        const client = clientById.get(h.clientId);
        const billingCompany = client?.companyId ? companyById.get(client.companyId) : undefined;
        return {
          ...h,
          clientCompany: client?.company ?? "—",
          billingCompanyName: billingCompany?.name ?? "—",
          remaining: remainingHours(h),
          value: hoursValue(h),
          paidHours: hoursPaidForEntry(h.id, data.payments),
          remainingToPay: hoursRemainingToPay(h, data.payments),
          invoice: h.invoiceId ? invoiceViewById.get(h.invoiceId) : undefined,
        };
      })
      .sort(
        (a, b) => b.month.localeCompare(a.month) || a.clientCompany.localeCompare(b.clientCompany),
      );
  }, [
    data.hours,
    data.payments,
    clientById,
    companyById,
    invoiceViewById,
    query,
    clientId,
    companyId,
    fromMonth,
    toMonth,
  ]);

  const totals = useMemo(() => {
    const current = thisMonth();
    return {
      hoursThisMonth: round2(
        data.hours.filter((h) => h.month === current).reduce((s, h) => s + h.totalHours, 0),
      ),
      remaining: round2(rows.reduce((s, r) => s + r.remaining, 0)),
      value: round2(rows.reduce((s, r) => s + r.value, 0)),
    };
  }, [data.hours, rows]);

  const filtered = query || clientId !== "all" || companyId !== "all" || fromMonth || toMonth;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Total Hours This Month"
          value={formatHours(totals.hoursThisMonth)}
          sublabel={formatMonth(thisMonth())}
          icon={Clock}
        />
        <SummaryCard
          label="Total Remaining Hours"
          value={formatHours(totals.remaining)}
          sublabel="Filtered view"
        />
        <SummaryCard label="Total Value" value={formatMoney(totals.value)} tone="success" />
      </div>

      <Panel>
        <PanelHeader
          title="Hours"
          description={`${rows.length} of ${data.hours.length} monthly entries`}
          actions={
            can("hours", "create") ? (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" /> Add Hours
              </Button>
            ) : undefined
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search client or notes…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="h-8 w-48 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {data.clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.company}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="h-8 w-44 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {data.companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="month"
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="h-8 w-40 text-[13px]"
            aria-label="Month from"
          />
          <Input
            type="month"
            value={toMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="h-8 w-40 text-[13px]"
            aria-label="Month to"
          />
          {filtered ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("");
                setClientId("all");
                setCompanyId("all");
                setFromMonth("");
                setToMonth("");
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No hours match this view" : "No hours recorded yet"}
            description={
              filtered
                ? "Adjust the filters to see other months or clients."
                : "Add a monthly hours entry to start tracking billable time per client."
            }
          />
        ) : (
          <TableWrap>
            <Table className="min-w-[1580px]">
              <THead>
                <TR>
                  <TH>Month</TH>
                  <TH>Client</TH>
                  <TH>Company</TH>
                  <TH align="right">Total Hours</TH>
                  <TH align="right">Payroll Hours</TH>
                  <TH align="right">Mgmt Payroll Hours</TH>
                  <TH align="right">Unpaid Hours</TH>
                  <TH align="right">Remaining Hours</TH>
                  <TH align="right">Rate</TH>
                  <TH align="right">Value</TH>
                  <TH align="right">Hours Paid</TH>
                  <TH align="right">Remaining to Pay</TH>
                  <TH>Invoice</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((h) => (
                  <TR key={h.id}>
                    <TD className="font-medium">{formatMonth(h.month)}</TD>
                    <TD>{h.clientCompany}</TD>
                    <TD className="text-muted-foreground">{h.billingCompanyName}</TD>
                    <TD mono align="right">
                      {formatHours(h.totalHours)}
                    </TD>
                    <TD mono align="right">
                      {formatHours(h.payrollHours)}
                    </TD>
                    <TD mono align="right">
                      {formatHours(h.managementPayrollHours)}
                    </TD>
                    <TD mono align="right">
                      {formatHours(h.unpaidHours)}
                    </TD>
                    <TD mono align="right" className="font-medium">
                      {formatHours(h.remaining)}
                    </TD>
                    <TD mono align="right">
                      {formatMoney(h.rate)}
                    </TD>
                    <TD mono align="right" className="font-medium">
                      {formatMoney(h.value)}
                    </TD>
                    <TD mono align="right">
                      {formatHours(h.paidHours)}
                    </TD>
                    <TD
                      mono
                      align="right"
                      className={h.remainingToPay > 0.004 ? "text-warning" : undefined}
                    >
                      {formatHours(h.remainingToPay)}
                    </TD>
                    <TD>
                      {h.invoice ? (
                        <Link
                          to="/invoices"
                          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                          title={`${h.invoice.number} — ${h.invoice.status}`}
                        >
                          <FileText className="size-3.5 text-muted-foreground" />
                          {h.invoice.number}
                          <StatusBadge status={h.invoice.status} />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Not invoiced</span>
                      )}
                    </TD>
                    <TD align="right">
                      <div className="flex items-center justify-end gap-1">
                        {can("hours", "edit") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Edit hours entry"
                            onClick={() => {
                              setEditing(h);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                        {can("hours", "delete") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete hours entry"
                            onClick={() => setToDelete(h)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      <HoursDialog open={formOpen} onOpenChange={setFormOpen} entry={editing} />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete hours entry?"
        description={
          toDelete
            ? `The entry for ${formatMonth(toDelete.month)} will be permanently removed.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (toDelete) {
            deleteHours(toDelete.id);
            toast.success("Hours entry deleted.");
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
