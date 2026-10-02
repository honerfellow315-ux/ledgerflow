import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@/lib/unwrap";
import {
  getImportChecks,
  getPeriodSheet,
  listPayrollCompanies,
  listPeriods,
  listShiftCompanies,
  listStaff,
} from "@/lib/actions/salary";

export const salaryKeys = {
  all: ["salary"] as const,
  periods: ["salary", "periods"] as const,
  sheet: (periodId: string) => ["salary", "sheet", periodId] as const,
  companies: ["salary", "companies"] as const,
  shiftCompanies: ["salary", "shiftCompanies"] as const,
  checks: (periodId: string) => ["salary", "checks", periodId] as const,
  staff: ["staff"] as const,
};

export const usePeriods = (enabled = true) =>
  useQuery({ queryKey: salaryKeys.periods, queryFn: () => unwrap(listPeriods()), enabled });

export const usePeriodSheet = (periodId: string | null) =>
  useQuery({
    queryKey: salaryKeys.sheet(periodId ?? ""),
    queryFn: () => unwrap(getPeriodSheet({ data: { periodId: periodId ?? "" } })),
    enabled: !!periodId,
  });

export const useAllPayrollCompanies = (enabled = true) =>
  useQuery({ queryKey: salaryKeys.companies, queryFn: () => unwrap(listPayrollCompanies()), enabled });

/** Every shift company (RSS, ESS and the ones the client added), incl. switched-off ones. */
export const useShiftCompanies = (enabled = true) =>
  useQuery({
    queryKey: salaryKeys.shiftCompanies,
    queryFn: () => unwrap(listShiftCompanies()),
    enabled,
  });

/** The "Check data" report. Always re-reads when it opens, so it is never stale. */
export const useImportChecks = (periodId: string, enabled = true) =>
  useQuery({
    queryKey: salaryKeys.checks(periodId),
    queryFn: () => unwrap(getImportChecks({ data: { periodId } })),
    enabled: enabled && !!periodId,
    staleTime: 0,
    gcTime: 0,
  });

export const useStaffList = (enabled = true) =>
  useQuery({ queryKey: salaryKeys.staff, queryFn: () => unwrap(listStaff()), enabled });

/** Re-fetches everything the salary screens show (period list, open sheet,
 * payroll companies and staff) after any mutation. */
export function useRefreshSalary() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: salaryKeys.all }),
      qc.invalidateQueries({ queryKey: salaryKeys.staff }),
    ]);
  }, [qc]);
}

/** Readable message from anything a server function can throw (an Error, or a
 * 401/403 Response from requirePermission()). */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Response) {
    if (err.status === 403) return "You don't have permission to do that.";
    if (err.status === 401) return "Your session has expired — please sign in again.";
    return fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Form text -> number. Accepts "1,234.50", "£12", "(5.00)" as -5; blank -> 0. */
export function parseAmount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const negative = /^\(.*\)$/.test(t);
  const n = Number(t.replace(/[£,\s()]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return negative ? -Math.abs(n) : n;
}

/** number -> form text. Zero shows as an empty box so the sheet stays clean. */
export function amountToInput(n: number): string {
  return n === 0 || !Number.isFinite(n) ? "" : String(n);
}