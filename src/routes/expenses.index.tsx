import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, ReceiptText, Search, Trash2 } from "@/lib/icons";
import { toast } from "sonner";
import { useLedger } from "@/lib/ledger/store";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { expenseTotal, formatDate, formatMoney, totalsForExpenses } from "@/lib/ledger/calc";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { ExpenseDialog } from "@/components/app/ExpenseDialog";
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
import type { Expense } from "@/lib/ledger/types";

export const Route = createFileRoute("/expenses/")({
  head: () => ({
    meta: [
      { title: "Expenses — LedgerFlow" },
      {
        name: "description",
        content:
          "Business expense register with category, net amount, VAT, gross total, payment method and supplier reference.",
      },
      { property: "og:title", content: "Expenses — LedgerFlow" },
      {
        property: "og:description",
        content: "Record business expenses with VAT and reconcile net and gross totals.",
      },
    ],
  }),
  component: ExpensesPage,
});

function ExpensesPage() {
  return (
    <RequireView module="expenses">
      <ExpensesPageContent />
    </RequireView>
  );
}

function ExpensesPageContent() {
  const { data, invoiceViews, deleteExpense } = useLedger();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [toDelete, setToDelete] = useState<Expense | null>(null);

  const invoiceNumberById = useMemo(
    () => new Map(invoiceViews.map((i) => [i.id, i.number])),
    [invoiceViews],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.expenses
      .filter((e) => (category === "all" ? true : e.category === category))
      .filter((e) => (from ? e.date >= from : true))
      .filter((e) => (to ? e.date <= to : true))
      .filter((e) =>
        q ? `${e.description} ${e.category} ${e.paidTo}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data.expenses, query, category, from, to]);

  const totals = useMemo(() => totalsForExpenses(rows), [rows]);
  const filtered = query || category !== "all" || from || to;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Net (ex VAT)" value={formatMoney(totals.net)} icon={ReceiptText} />
        <SummaryCard label="VAT" value={formatMoney(totals.vat)} tone="warning" />
        <SummaryCard label="Gross" value={formatMoney(totals.gross)} tone="danger" />
        <SummaryCard label="Expenses" value={String(totals.count)} sublabel="Filtered view" />
      </div>

      <Panel>
        <PanelHeader
          title="Expenses"
          description={`${rows.length} of ${data.expenses.length} expenses`}
          actions={
            can("expenses", "create") ? (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" /> Add Expense
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
              placeholder="Search description, category or payee…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-8 w-52 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {data.settings.expenseCategories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 w-40 text-[13px]"
            aria-label="Expense date from"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 w-40 text-[13px]"
            aria-label="Expense date to"
          />
          {filtered ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("");
                setCategory("all");
                setFrom("");
                setTo("");
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No expenses match this view" : "No expenses recorded yet"}
            description={
              filtered
                ? "Adjust the search or filters to see other expenses."
                : "Add your first business expense to start tracking net, VAT and gross spend."
            }
          />
        ) : (
          <TableWrap>
            <Table className="min-w-[1220px]">
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Category</TH>
                  <TH>Description</TH>
                  <TH align="right">Amount (ex VAT)</TH>
                  <TH align="right">VAT</TH>
                  <TH align="right">Total</TH>
                  <TH>Method</TH>
                  <TH>Paid To</TH>
                  <TH>Reference</TH>
                  <TH>Linked Invoice</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((e) => (
                  <TR key={e.id}>
                    <TD className="font-medium">{formatDate(e.date)}</TD>
                    <TD>{e.category}</TD>
                    <TD className="max-w-64 truncate whitespace-normal">{e.description}</TD>
                    <TD mono align="right">
                      {formatMoney(e.amountExVat)}
                    </TD>
                    <TD mono align="right">
                      {formatMoney(e.vatAmount)}
                    </TD>
                    <TD mono align="right" className="font-medium">
                      {formatMoney(expenseTotal(e))}
                    </TD>
                    <TD>{e.method}</TD>
                    <TD>{e.paidTo || "—"}</TD>
                    <TD mono>{e.reference || "—"}</TD>
                    <TD>{e.invoiceId ? (invoiceNumberById.get(e.invoiceId) ?? "—") : "—"}</TD>
                    <TD align="right">
                      <div className="flex items-center justify-end gap-1">
                        {can("expenses", "edit") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Edit expense"
                            onClick={() => {
                              setEditing(e);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                        {can("expenses", "delete") ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete expense"
                            onClick={() => setToDelete(e)}
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

      <ExpenseDialog open={formOpen} onOpenChange={setFormOpen} expense={editing} />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete expense?"
        description={toDelete ? `“${toDelete.description}” will be permanently removed.` : ""}
        confirmLabel="Delete"
        onConfirm={() => {
          if (toDelete) {
            deleteExpense(toDelete.id);
            toast.success("Expense deleted.");
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
