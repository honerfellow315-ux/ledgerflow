import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Info, ListChecks, Search, Upload } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
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
import { Pill, SheetStatusBadge } from "@/components/app/timesheets/badges";
import { SheetCheckPanel } from "@/components/app/timesheets/SheetCheckPanel";
import { UploadTimesheetDialog } from "@/components/app/timesheets/TimesheetDialogs";
import { downloadTimesheetReport } from "@/lib/timesheets/reportExport";
import {
  FORMAT_LABEL,
  MOCK_SHEETS,
  fmtDateTime,
  fmtDiff,
  fmtHours,
  maskNi,
  sheetTotals,
  type SheetStatus,
  type TimesheetSheet,
} from "@/lib/timesheets/data";

export const Route = createFileRoute("/timesheets/")({
  head: () => ({
    meta: [
      { title: "Timesheet Check — LedgerFlow" },
      {
        name: "description",
        content: "Check the hours staff send you against your own shift records.",
      },
    ],
  }),
  component: TimesheetsPage,
});

function TimesheetsPage() {
  // Admin-only for now, same pattern as the Activity Log: the real gate is isAdmin below.
  return (
    <RequireView module="dashboard">
      <TimesheetsPageContent />
    </RequireView>
  );
}

const ALL = "all";

function TimesheetsPageContent() {
  const { isAdmin, ready } = usePermissions();
  const sheets: TimesheetSheet[] = MOCK_SHEETS;
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [uploadOpen, setUploadOpen] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sheets.filter((s) => {
      if (status !== ALL && s.status !== (status as SheetStatus)) return false;
      if (!needle) return true;
      return s.staffName.toLowerCase().includes(needle) || s.fileName.toLowerCase().includes(needle);
    });
  }, [sheets, q, status]);

  if (!ready) return null;
  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Only administrators can open Timesheet Check for now."
        />
      </Panel>
    );
  }

  const open = sheets.find((s) => s.id === openId) ?? null;
  if (open) {
    return (
      <SheetCheckPanel
        sheet={open}
        onBack={() => setOpenId(null)}
        onDownload={() => void downloadTimesheetReport([open])}
      />
    );
  }

  const count = (...s: SheetStatus[]) => sheets.filter((x) => s.includes(x.status)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Timesheet Check</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload the hours your staff sent and see where they differ from your own records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void downloadTimesheetReport(rows)}>
            <Download className="size-4" /> Download report
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" /> Upload timesheets
          </Button>
        </div>
      </div>

      <div
        role="note"
        className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-[13px] text-foreground"
      >
        <Info className="mt-0.5 size-4 text-primary" aria-hidden="true" />
        <p>This is a preview with sample people and hours. Nothing here is saved yet.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Sheets this month" value={String(sheets.length)} icon={ListChecks} />
        <SummaryCard
          label="All matching"
          value={String(count("ready"))}
          tone="success"
        />
        <SummaryCard
          label="Need a look"
          value={String(count("needs_review"))}
          tone={count("needs_review") ? "warning" : "success"}
        />
        <SummaryCard
          label="Staff not found"
          value={String(count("staff_not_found"))}
          sublabel="Add them to Staff first"
          tone={count("staff_not_found") ? "danger" : "success"}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Uploaded sheets"
          description={`${rows.length} of ${sheets.length} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name or file"
                  className="h-9 w-48 pl-8"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="ready">All matching</SelectItem>
                  <SelectItem value="needs_review">Needs a look</SelectItem>
                  <SelectItem value="staff_not_found">Staff not found</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            title="No sheets match"
            description="Try a different search or status, or upload a new sheet."
          />
        ) : (
          <TableWrap>
            <Table className="min-w-[900px]">
              <THead>
                <TR>
                  <TH>Staff</TH>
                  <TH>NI</TH>
                  <TH>File</TH>
                  <TH>Uploaded</TH>
                  <TH align="right">Sheet</TH>
                  <TH align="right">Our records</TH>
                  <TH align="right">Difference</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((s) => {
                  const t = sheetTotals(s);
                  return (
                    <TR key={s.id} onClick={() => setOpenId(s.id)}>
                      <TD className="font-medium">{s.staffName}</TD>
                      <TD mono>{maskNi(s.ni)}</TD>
                      <TD>
                        <span className="flex items-center gap-2">
                          <Pill tone="mute">{FORMAT_LABEL[s.format]}</Pill>
                          <span className="max-w-[200px] truncate text-muted-foreground">
                            {s.fileName}
                          </span>
                        </span>
                      </TD>
                      <TD>{fmtDateTime(s.uploadedAt)}</TD>
                      <TD align="right" mono>
                        {fmtHours(t.sheetHours)}
                      </TD>
                      <TD align="right" mono>
                        {s.status === "staff_not_found" ? "—" : fmtHours(t.recordHours)}
                      </TD>
                      <TD align="right" mono>
                        {s.status === "staff_not_found" ? "—" : fmtDiff(t.diff)}
                      </TD>
                      <TD>
                        <SheetStatusBadge status={s.status} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      <UploadTimesheetDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}