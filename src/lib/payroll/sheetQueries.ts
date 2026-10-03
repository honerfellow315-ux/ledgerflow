import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@/lib/unwrap";
import {
  getPayrollSheet,
  listAssignableStaff,
  listPayrollSheets,
  listSheetCompanies,
} from "@/lib/actions/payroll";
import { salaryKeys } from "./queries";

export const payrollKeys = {
  all: ["payroll"] as const,
  companies: ["payroll", "companies"] as const,
  sheets: (companyId: string) => ["payroll", "sheets", companyId] as const,
  sheet: (sheetId: string) => ["payroll", "sheet", sheetId] as const,
  assignable: (sheetId: string) => ["payroll", "assignable", sheetId] as const,
};

export const useSheetCompanies = (enabled = true) =>
  useQuery({
    queryKey: payrollKeys.companies,
    queryFn: () => unwrap(listSheetCompanies()),
    enabled,
  });

export const usePayrollSheets = (companyId: string | null) =>
  useQuery({
    queryKey: payrollKeys.sheets(companyId ?? ""),
    queryFn: () => unwrap(listPayrollSheets({ data: { companyId: companyId ?? "" } })),
    enabled: !!companyId,
  });

export const usePayrollSheet = (sheetId: string | null) =>
  useQuery({
    queryKey: payrollKeys.sheet(sheetId ?? ""),
    queryFn: () => unwrap(getPayrollSheet({ data: { sheetId: sheetId ?? "" } })),
    enabled: !!sheetId,
  });

export const useAssignableStaff = (sheetId: string, enabled: boolean) =>
  useQuery({
    queryKey: payrollKeys.assignable(sheetId),
    queryFn: () => unwrap(listAssignableStaff({ data: { sheetId } })),
    enabled: enabled && !!sheetId,
    staleTime: 0,
    gcTime: 0,
  });

/** Re-fetches everything the payroll screens show after any mutation (and the staff / salary caches they share). */
export function useRefreshPayroll() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: payrollKeys.all }),
      qc.invalidateQueries({ queryKey: salaryKeys.staff }),
      qc.invalidateQueries({ queryKey: salaryKeys.all }),
    ]);
  }, [qc]);
}
