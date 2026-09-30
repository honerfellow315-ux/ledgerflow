import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  buildInvoiceViews,
  applyClientCredit,
  type InvoiceView,
  type InvoiceViewWithCredit,
} from "./calc";
import type {
  Client,
  Company,
  CreditNote,
  Expense,
  HoursEntry,
  Invoice,
  LedgerData,
  Payment,
  Settings,
  SubcontractEntry,
} from "./types";

import {
  listClients,
  addClient as addClientFn,
  updateClient as updateClientFn,
  deleteClient as deleteClientFn,
} from "@/lib/actions/clients";
import {
  listCompanies,
  addCompany as addCompanyFn,
  updateCompany as updateCompanyFn,
  deleteCompany as deleteCompanyFn,
} from "@/lib/actions/companies";
import {
  listInvoices,
  addInvoice as addInvoiceFn,
  updateInvoice as updateInvoiceFn,
  deleteInvoice as deleteInvoiceFn,
} from "@/lib/actions/invoices";
import {
  listPayments,
  addPayment as addPaymentFn,
  updatePayment as updatePaymentFn,
  deletePayment as deletePaymentFn,
} from "@/lib/actions/payments";
import {
  listExpenses,
  addExpense as addExpenseFn,
  updateExpense as updateExpenseFn,
  deleteExpense as deleteExpenseFn,
} from "@/lib/actions/expenses";
import {
  listHours,
  addHours as addHoursFn,
  updateHours as updateHoursFn,
  deleteHours as deleteHoursFn,
} from "@/lib/actions/hours";
import {
  listSubcontracts,
  addSubcontract as addSubcontractFn,
  updateSubcontract as updateSubcontractFn,
  deleteSubcontract as deleteSubcontractFn,
} from "@/lib/actions/subcontracts";
import {
  listCreditNotes,
  addCreditNote as addCreditNoteFn,
  updateCreditNote as updateCreditNoteFn,
  deleteCreditNote as deleteCreditNoteFn,
} from "@/lib/actions/creditNotes";
import { getSettings, updateSettings as updateSettingsFn } from "@/lib/actions/settings";
import { defaultSettings } from "./defaults";
import { unwrap, asArray } from "@/lib/unwrap";

/**
 * Frontend data layer.
 *
 * Same public shape as before (components are untouched) — but every read
 * comes from React Query, and every write is a server function call against
 * the database, followed by a refetch of the affected list. This app is a
 * single-admin tool with light traffic, so "refetch after mutating" is
 * simpler and safer here than hand-rolled optimistic cache patching.
 */

const KEYS = {
  clients: ["clients"] as QueryKey,
  companies: ["companies"] as QueryKey,
  invoices: ["invoices"] as QueryKey,
  payments: ["payments"] as QueryKey,
  expenses: ["expenses"] as QueryKey,
  hours: ["hours"] as QueryKey,
  subcontracts: ["subcontracts"] as QueryKey,
  creditNotes: ["creditNotes"] as QueryKey,
  settings: ["settings"] as QueryKey,
};

interface LedgerContextValue {
  data: LedgerData;
  hydrated: boolean;
  invoiceViews: InvoiceView[];
  /** Same rows as `invoiceViews`, with per-invoice credit fields
   * (`creditApplied`, `effectiveOutstanding`, `effectiveStatus`) added —
   * an earlier overpayment by a client is automatically netted against
   * their next invoice(s), oldest first. See calc.ts:applyClientCredit. */
  invoiceViewsWithCredit: InvoiceViewWithCredit[];
  /** A client's current unallocated credit balance (0 if none). */
  creditBalanceByClient: Map<string, number>;
  addClient: (client: Omit<Client, "id">) => void;
  updateClient: (id: string, patch: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  /** Returns the created row (with its id) so a caller — e.g. the "add a new
   * company" form inside ClientDialog — can immediately link a client to it. */
  addCompany: (company: Omit<Company, "id">) => Promise<Company | undefined>;
  updateCompany: (id: string, patch: Partial<Company>) => void;
  deleteCompany: (id: string) => void;
  /** `hoursEntryId`, when given, links the created invoice back onto that
   * Hours entry (sets its `invoiceId`) in the same action — see
   * InvoiceDialog's "Link to Hours Entry" picker. */
  addInvoice: (invoice: Omit<Invoice, "id">, hoursEntryId?: string) => void;
  updateInvoice: (id: string, patch: Partial<Invoice>) => void;
  deleteInvoice: (id: string) => void;
  addPayment: (payment: Omit<Payment, "id">) => void;
  updatePayment: (id: string, patch: Partial<Payment>) => void;
  deletePayment: (id: string) => void;
  /** Deletes every payment recorded against an invoice in one action — the
   * only supported way to move an invoice's computed status back to
   * "unpaid", since status is never stored directly (see calc.ts:statusFor).
   * Returns once all deletes have settled so callers can show a toast. */
  clearInvoicePayments: (invoiceId: string) => Promise<void>;
  addExpense: (expense: Omit<Expense, "id">) => void;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;
  addHours: (entry: Omit<HoursEntry, "id">) => void;
  updateHours: (id: string, patch: Partial<HoursEntry>) => void;
  deleteHours: (id: string) => void;
  /** Returns a promise (unlike most other add* actions here) so the
   * Add/Edit Subcontracting Entry dialog can surface the server's
   * remaining-hours validation error instead of it being swallowed. */
  addSubcontract: (entry: Omit<SubcontractEntry, "id">) => Promise<void>;
  updateSubcontract: (id: string, patch: Partial<SubcontractEntry>) => Promise<void>;
  deleteSubcontract: (id: string) => void;
  addCreditNote: (note: Omit<CreditNote, "id">) => void;
  updateCreditNote: (id: string, patch: Partial<CreditNote>) => void;
  deleteCreditNote: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const LedgerContext = createContext<LedgerContextValue | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const clientsQ = useQuery({ queryKey: KEYS.clients, queryFn: () => unwrap(listClients()) });
  const companiesQ = useQuery({ queryKey: KEYS.companies, queryFn: () => unwrap(listCompanies()) });
  const invoicesQ = useQuery({ queryKey: KEYS.invoices, queryFn: () => unwrap(listInvoices()) });
  const paymentsQ = useQuery({ queryKey: KEYS.payments, queryFn: () => unwrap(listPayments()) });
  const expensesQ = useQuery({ queryKey: KEYS.expenses, queryFn: () => unwrap(listExpenses()) });
  const hoursQ = useQuery({ queryKey: KEYS.hours, queryFn: () => unwrap(listHours()) });
  const subcontractsQ = useQuery({
    queryKey: KEYS.subcontracts,
    queryFn: () => unwrap(listSubcontracts()),
  });
  const creditNotesQ = useQuery({ queryKey: KEYS.creditNotes, queryFn: () => unwrap(listCreditNotes()) });
  const settingsQ = useQuery({ queryKey: KEYS.settings, queryFn: () => unwrap(getSettings()) });

  // Small helper: fire a mutation, then invalidate the list(s) it affects.
  function action<TInput>(fn: (input: TInput) => Promise<unknown>, keys: QueryKey[]) {
    return (input: TInput) => {
      fn(input)
        .then(() => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k }))))
        .catch((err) => console.error(err));
    };
  }

  const addClient = action((c: Omit<Client, "id">) => addClientFn({ data: c }), [KEYS.clients]);
  const updateClient = (id: string, patch: Partial<Client>) =>
    action(
      (p: Partial<Client>) => updateClientFn({ data: { id, patch: p } }),
      [KEYS.clients],
    )(patch);
  const deleteClient = action(
    (id: string) => deleteClientFn({ data: { id } }),
    [KEYS.clients, KEYS.invoices, KEYS.payments, KEYS.hours, KEYS.subcontracts, KEYS.creditNotes],
  );

  // Unlike the other mutations below, this one returns the created row: the
  // "add a new company" inline form in ClientDialog needs the new id right
  // away, before the client record referencing it is saved.
  const addCompany = (c: Omit<Company, "id">) =>
    addCompanyFn({ data: c })
      .then((row) => {
        qc.invalidateQueries({ queryKey: KEYS.companies });
        return row;
      })
      .catch((err) => {
        console.error(err);
        return undefined;
      });
  const updateCompany = (id: string, patch: Partial<Company>) =>
    action(
      (p: Partial<Company>) => updateCompanyFn({ data: { id, patch: p } }),
      [KEYS.companies],
    )(patch);
  const deleteCompany = action(
    (id: string) => deleteCompanyFn({ data: { id } }),
    [KEYS.companies, KEYS.clients],
  );

  // When the invoice is created from a specific Hours entry (picked in
  // InvoiceDialog's "Link to Hours Entry" field), link that entry back to
  // the new invoice in the same action — nothing left for the person to do
  // afterwards in the Hours screen.
  const addInvoice = (i: Omit<Invoice, "id">, hoursEntryId?: string) => {
    addInvoiceFn({ data: i })
      .then(async (row) => {
        if (row && hoursEntryId) {
          await updateHoursFn({
            data: { id: hoursEntryId, patch: { invoiceId: row.id } },
          }).catch((err) => console.error("addInvoice: link hours entry failed", err));
        }
        await Promise.all(
          [KEYS.invoices, KEYS.settings, KEYS.hours].map((k) =>
            qc.invalidateQueries({ queryKey: k }),
          ),
        );
      })
      .catch((err) => console.error(err));
  };
  const updateInvoice = (id: string, patch: Partial<Invoice>) =>
    action(
      (p: Partial<Invoice>) => updateInvoiceFn({ data: { id, patch: p } }),
      [KEYS.invoices],
    )(patch);
  const deleteInvoice = action(
    (id: string) => deleteInvoiceFn({ data: { id } }),
    [KEYS.invoices, KEYS.payments],
  );

  const addPayment = action((p: Omit<Payment, "id">) => addPaymentFn({ data: p }), [KEYS.payments]);
  const updatePayment = (id: string, patch: Partial<Payment>) =>
    action(
      (p: Partial<Payment>) => updatePaymentFn({ data: { id, patch: p } }),
      [KEYS.payments],
    )(patch);
  const deletePayment = action((id: string) => deletePaymentFn({ data: { id } }), [KEYS.payments]);
  const clearInvoicePayments = async (invoiceId: string) => {
    const toRemove = (asArray(paymentsQ.data)).filter((p) => p.invoiceId === invoiceId);
    try {
      await Promise.all(toRemove.map((p) => deletePaymentFn({ data: { id: p.id } })));
    } finally {
      await qc.invalidateQueries({ queryKey: KEYS.payments });
    }
  };

  const addExpense = action((e: Omit<Expense, "id">) => addExpenseFn({ data: e }), [KEYS.expenses]);
  const updateExpense = (id: string, patch: Partial<Expense>) =>
    action(
      (p: Partial<Expense>) => updateExpenseFn({ data: { id, patch: p } }),
      [KEYS.expenses],
    )(patch);
  const deleteExpense = action((id: string) => deleteExpenseFn({ data: { id } }), [KEYS.expenses]);

  const addHours = action((h: Omit<HoursEntry, "id">) => addHoursFn({ data: h }), [KEYS.hours]);
  const updateHours = (id: string, patch: Partial<HoursEntry>) =>
    action(
      (p: Partial<HoursEntry>) => updateHoursFn({ data: { id, patch: p } }),
      [KEYS.hours],
    )(patch);
  const deleteHours = action((id: string) => deleteHoursFn({ data: { id } }), [KEYS.hours]);

  // Unlike most other add*/update* actions in this file (fire-and-forget,
  // errors only logged), these two return the promise: the server enforces
  // the invoice remaining-hours cap (see actions/subcontracts.ts), and the
  // dialog needs that rejection to show the person why the save failed.
  const addSubcontract = (s: Omit<SubcontractEntry, "id">) =>
    addSubcontractFn({ data: s }).then(async () => {
      await qc.invalidateQueries({ queryKey: KEYS.subcontracts });
    });
  const updateSubcontract = (id: string, patch: Partial<SubcontractEntry>) =>
    updateSubcontractFn({ data: { id, patch } }).then(async () => {
      await qc.invalidateQueries({ queryKey: KEYS.subcontracts });
    });
  const deleteSubcontract = action(
    (id: string) => deleteSubcontractFn({ data: { id } }),
    [KEYS.subcontracts],
  );

  const addCreditNote = action(
    (n: Omit<CreditNote, "id">) => addCreditNoteFn({ data: n }),
    [KEYS.creditNotes],
  );
  const updateCreditNote = (id: string, patch: Partial<CreditNote>) =>
    action(
      (p: Partial<CreditNote>) => updateCreditNoteFn({ data: { id, patch: p } }),
      [KEYS.creditNotes],
    )(patch);
  const deleteCreditNote = action(
    (id: string) => deleteCreditNoteFn({ data: { id } }),
    [KEYS.creditNotes],
  );

  const updateSettings = action(
    (patch: Partial<Settings>) => updateSettingsFn({ data: patch }),
    [KEYS.settings],
  );

  const hydrated =
    clientsQ.isSuccess &&
    companiesQ.isSuccess &&
    invoicesQ.isSuccess &&
    paymentsQ.isSuccess &&
    expensesQ.isSuccess &&
    hoursQ.isSuccess &&
    subcontractsQ.isSuccess &&
    creditNotesQ.isSuccess &&
    settingsQ.isSuccess;

  const data: LedgerData = {
    clients: asArray(clientsQ.data),
    companies: asArray(companiesQ.data),
    invoices: asArray(invoicesQ.data),
    payments: asArray(paymentsQ.data),
    expenses: asArray(expensesQ.data),
    hours: asArray(hoursQ.data),
    subcontracts: asArray(subcontractsQ.data),
    creditNotes: asArray(creditNotesQ.data),
    settings: settingsQ.data && !(settingsQ.data instanceof Response) ? settingsQ.data : defaultSettings,
  };

  const invoiceViews = useMemo(
    () => buildInvoiceViews(data.invoices, data.payments, data.clients),
    [data.invoices, data.payments, data.clients],
  );

  // Credit is allocated per client (an overpayment on Client A's invoice
  // never covers Client B), so group first, then run the chronological
  // allocation pass within each group.
  const { invoiceViewsWithCredit, creditBalanceByClient } = useMemo(() => {
    const byClient = new Map<string, InvoiceView[]>();
    for (const v of invoiceViews) {
      const list = byClient.get(v.clientId) ?? [];
      list.push(v);
      byClient.set(v.clientId, list);
    }
    const rows: InvoiceViewWithCredit[] = [];
    const credit = new Map<string, number>();
    for (const [cid, list] of byClient) {
      const { views, remainingCredit } = applyClientCredit(list);
      rows.push(...views);
      if (remainingCredit > 0.004) credit.set(cid, remainingCredit);
    }
    return { invoiceViewsWithCredit: rows, creditBalanceByClient: credit };
  }, [invoiceViews]);

  const value: LedgerContextValue = {
    data,
    hydrated,
    invoiceViews,
    invoiceViewsWithCredit,
    creditBalanceByClient,
    addClient,
    updateClient,
    deleteClient,
    addCompany,
    updateCompany,
    deleteCompany,
    addInvoice,
    updateInvoice,
    deleteInvoice,
    addPayment,
    updatePayment,
    clearInvoicePayments,
    deletePayment,
    addExpense,
    updateExpense,
    deleteExpense,
    addHours,
    updateHours,
    deleteHours,
    addSubcontract,
    updateSubcontract,
    deleteSubcontract,
    addCreditNote,
    updateCreditNote,
    deleteCreditNote,
    updateSettings,
  };

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error("useLedger must be used inside LedgerProvider");
  return ctx;
}