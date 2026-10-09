/**
 * Invoice drafts — UI only (sample clients and shifts, nothing is saved).
 * The money uses the same hoursInvoiceAmount() as the real Hours x Rate invoice, so a draft
 * can never disagree with the invoice it turns into. Phase B swaps buildDrafts() for real shifts.
 */
import { hoursInvoiceAmount, round2 } from "@/lib/ledger/calc";

export interface SiteHours {
  site: string;
  shifts: number;
  hours: number;
}

export interface Draft {
  id: string;
  client: string;
  month: string;
  sites: SiteHours[];
  payrollHours: number;
  rate: number | null;
  payrollRate: number | null;
  vatRate: number;
  /** Hours already typed into the Hours screen for this client and month (null = none). */
  hoursEntry: number | null;
  invoiced: boolean;
}

export type DraftState = "ready" | "check" | "done";

export function draftMonths(count = 4): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export function draftTotals(d: Draft) {
  const hours = round2(d.sites.reduce((a, s) => a + s.hours, 0));
  const payrollHours = Math.min(d.payrollHours, hours);
  const exVat = hoursInvoiceAmount({
    hours,
    rate: d.rate ?? 0,
    payrollHours,
    payrollRate: d.payrollRate ?? 0,
  });
  const vat = round2(exVat * (d.vatRate / 100));
  return {
    hours,
    payrollHours,
    normalHours: round2(hours - payrollHours),
    exVat,
    vat,
    total: round2(exVat + vat),
    shifts: d.sites.reduce((a, s) => a + s.shifts, 0),
  };
}

export function draftState(d: Draft): { state: DraftState; text: string } {
  const t = draftTotals(d);
  if (d.invoiced) return { state: "done", text: "Already invoiced" };
  if (d.rate === null || d.rate <= 0) return { state: "check", text: "No rate set" };
  if (d.payrollHours > t.hours) return { state: "check", text: "Payroll hours are more than shift hours" };
  if (d.hoursEntry !== null && Math.abs(d.hoursEntry - t.hours) > 0.001) {
    const diff = round2(t.hours - d.hoursEntry);
    return { state: "check", text: `Differs from Hours screen by ${diff > 0 ? "+" : ""}${diff} h` };
  }
  return { state: "ready", text: "Ready" };
}

const site = (name: string, shifts: number, hours: number): SiteHours => ({ site: name, shifts, hours });

export function buildDrafts(month: string): Draft[] {
  const bump = (Number(month.slice(-2)) % 3) * 8;
  const mk = (
    i: number,
    client: string,
    sites: SiteHours[],
    rest: Omit<Draft, "id" | "client" | "month" | "sites">,
  ): Draft => ({ id: `${month}-${i}`, client, month, sites, ...rest });
  return [
    mk(1, "Northgate Retail Ltd", [site("Northgate Retail Park", 24, 288 + bump), site("Canal Street Depot", 12, 144)], {
      payrollHours: 96, rate: 14.5, payrollRate: 12.45, vatRate: 20, hoursEntry: 432 + bump, invoiced: false,
    }),
    mk(2, "Marsh Lane Stores", [site("Marsh Lane Store", 22, 176)], {
      payrollHours: 0, rate: 13.75, payrollRate: null, vatRate: 20, hoursEntry: 176, invoiced: false,
    }),
    mk(3, "Docklands Logistics", [site("Docklands Site", 18, 216), site("Harbour Warehouse", 10, 80)], {
      payrollHours: 0, rate: 14, payrollRate: null, vatRate: 20, hoursEntry: 296, invoiced: true,
    }),
    mk(4, "Riverside Offices", [site("Riverside Offices", 21, 178.5)], {
      payrollHours: 40, rate: 15.2, payrollRate: 12.45, vatRate: 20, hoursEntry: 170, invoiced: false,
    }),
    mk(5, "Harbour Warehousing", [site("Harbour Warehouse", 16, 128 + bump)], {
      payrollHours: 0, rate: null, payrollRate: null, vatRate: 20, hoursEntry: null, invoiced: false,
    }),
    mk(6, "Crest Events", [site("Station Yard", 6, 72), site("Arena Gate B", 8, 96)], {
      payrollHours: 0, rate: 16, payrollRate: null, vatRate: 20, hoursEntry: null, invoiced: false,
    }),
  ];
}
