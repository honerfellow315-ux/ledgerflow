import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { IdCard, Pencil, Plus, Search } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { StaffDialog } from "@/components/app/salary/StaffDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normName, normNi } from "@/lib/payroll/calc";
import { useStaffList } from "@/lib/payroll/queries";
import {
  SHARE_CODE_WARN_DAYS,
  daysToShareCodeExpiry,
  displayDate,
  isWorking,
  shareCodeState,
} from "@/lib/payroll/staffFields";
import type { Staff } from "@/lib/payroll/types";

export const Route = createFileRoute("/staff/")({
  head: () => ({
    meta: [
      { title: "Staff — LedgerFlow" },
      {
        name: "description",
        content: "Staff master records: RSS / ESS IDs, NI numbers, tags, areas and bank details.",
      },
    ],
  }),
  component: StaffPage,
});

function StaffPage() {
  return (
    <RequireView module="staff">
      <StaffPageContent />
    </RequireView>
  );
}

const ALL = "__all__";

/** Share-code expiry date, coloured when it has passed or is close. */
function ShareCodeCell({ staff }: { staff: Staff }) {
  const state = shareCodeState(staff);
  const days = daysToShareCodeExpiry(staff);
  const tone =
    state === "expired"
      ? "text-destructive"
      : state === "soon"
        ? "text-warning"
        : "text-foreground";
  const note =
    state === "expired" ? " (expired)" : state === "soon" && days !== null ? ` (${days}d)` : "";
  return (
    <span className={tone}>
      {displayDate(staff.shareCodeExpiry)}
      {note}
    </span>
  );
}

function StaffPageContent() {
  const { can } = usePermissions();
  const canCreate = can("staff", "create");
  const canEdit = can("staff", "edit");
  const { data: staff = [], isLoading, error } = useStaffList();

  const [q, setQ] = useState("");
  const [area, setArea] = useState(ALL);
  const [active, setActive] = useState("active");
  const [dialog, setDialog] = useState<{ open: boolean; staff: Staff | null }>({
    open: false,
    staff: null,
  });

  const areas = useMemo(
    () =>
      [...new Set(staff.map((s) => s.area.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [staff],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const niNeedle = normNi(q);
    return staff.filter((s) => {
      if (active === "active" && !s.active) return false;
      if (active === "inactive" && s.active) return false;
      if (area !== ALL && s.area.trim() !== area) return false;
      if (!needle) return true;
      return (
        s.name.toLowerCase().includes(needle) ||
        s.rssId === needle ||
        s.essId === needle ||
        s.tag.toLowerCase().includes(needle) ||
        (niNeedle.length >= 3 && normNi(s.ni).includes(niNeedle))
      );
    });
  }, [staff, q, area, active]);

  const missingIds = staff.filter((s) => s.active && !s.rssId && !s.essId).length;
  const missingBank = staff.filter((s) => s.active && !s.accountDetail.trim()).length;
  const missingNi = staff.filter((s) => s.active && !s.ni.trim()).length;
  // Cheap warnings from the new detail fields (staff who are still working only).
  const working = staff.filter(isWorking);
  const shareCodeIssues = working.filter((s) => {
    const st = shareCodeState(s);
    return st === "expired" || st === "soon";
  }).length;
  const missingBankNumbers = working.filter((s) => !s.sortCode || !s.accountNumber).length;
  // One person must be ONE record (their NI is what ties together everything they
  // earn across companies). Two active records with the same name usually mean the
  // same person was created twice — e.g. once from RSS and once from ESS without an NI.
  const duplicateNames = useMemo(() => {
    const byName = new Map<string, number>();
    for (const s of staff) {
      if (!s.active) continue;
      const k = normName(s.name);
      if (k) byName.set(k, (byName.get(k) ?? 0) + 1);
    }
    return [...byName.values()].filter((n) => n > 1).length;
  }, [staff]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Staff</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Master records reused by every salary month. Contains NI numbers and bank details.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setDialog({ open: true, staff: null })}>
            <Plus className="size-4" /> Add staff
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <SummaryCard
          label="Active staff"
          value={String(staff.filter((s) => s.active).length)}
          icon={IdCard}
        />
        <SummaryCard
          label="No RSS / ESS ID"
          value={String(missingIds)}
          sublabel="Can't be matched from shift exports"
          tone={missingIds ? "warning" : "success"}
        />
        <SummaryCard
          label="No bank details"
          value={String(missingBank)}
          tone={missingBank ? "warning" : "success"}
        />
        <SummaryCard
          label="Share code expiring"
          value={String(shareCodeIssues)}
          sublabel={`Expired or within ${SHARE_CODE_WARN_DAYS} days`}
          tone={shareCodeIssues ? "warning" : "success"}
        />
        <SummaryCard
          label="No sort code / account no."
          value={String(missingBankNumbers)}
          sublabel="Needed for the payroll report"
          tone={missingBankNumbers ? "warning" : "success"}
        />
        <SummaryCard
          label="No NI number"
          value={String(missingNi)}
          sublabel="NI joins one person's work across companies"
          tone={missingNi ? "warning" : "success"}
        />
        <SummaryCard
          label="Possible duplicates"
          value={String(duplicateNames)}
          sublabel="Same name on 2+ active records — search the name"
          tone={duplicateNames ? "warning" : "success"}
        />
      </div>

      <Panel>
        <PanelHeader
          title="All staff"
          description={`${rows.length} of ${staff.length} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name, ID, NI or tag"
                  className="h-9 w-52 pl-8"
                />
              </div>
              <Select value={area} onValueChange={setArea}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All areas</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={active} onValueChange={setActive}>
                <SelectTrigger className="h-9 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="all">Everyone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />
        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <EmptyState
            title="Couldn't load staff"
            description={error instanceof Error ? error.message : ""}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={staff.length === 0 ? "No staff yet" : "Nobody matches"}
            description={
              staff.length === 0
                ? "Add people here, or import a shift export / your Excel salary sheet on the Salary Sheet screen and they're created for you."
                : "Try a different search or filter."
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>RSS ID</TH>
                  <TH>ESS ID</TH>
                  <TH>NI</TH>
                  <TH>Tag</TH>
                  <TH>Area</TH>
                  <TH>Share code expiry</TH>
                  <TH>Bank</TH>
                  <TH>Account detail</TH>
                  <TH align="center">Status</TH>
                  <TH align="right">{""}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((s) => (
                  <TR key={s.id} onClick={() => setDialog({ open: true, staff: s })}>
                    <TD className="font-medium">{s.name}</TD>
                    <TD mono>{s.rssId || "—"}</TD>
                    <TD mono>{s.essId || "—"}</TD>
                    <TD mono>{s.ni || "—"}</TD>
                    <TD>{s.tag || "—"}</TD>
                    <TD>{s.area || "—"}</TD>
                    <TD>
                      {s.shareCodeExpiry ? (
                        <ShareCodeCell staff={s} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD>
                      {s.sortCode && s.accountNumber ? (
                        <span className="text-success">Complete</span>
                      ) : (
                        <span className="text-warning">Missing</span>
                      )}
                    </TD>
                    <TD className="max-w-[260px] truncate">{s.accountDetail || "—"}</TD>
                    <TD align="center">
                      <span className={s.active ? "text-success" : "text-muted-foreground"}>
                        {s.active ? "Active" : "Inactive"}
                      </span>
                    </TD>
                    <TD align="right">
                      {canEdit ? (
                        <Pencil className="ml-auto size-3.5 text-muted-foreground" />
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      <StaffDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}
        staff={dialog.staff}
        canEdit={dialog.staff ? canEdit : canCreate}
      />
    </div>
  );
}
