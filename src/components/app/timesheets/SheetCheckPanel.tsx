import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Download, Info } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Pill, RowResultBadge, SheetStatusBadge } from "@/components/app/timesheets/badges";
import {
  FORMAT_LABEL,
  fmtDate,
  fmtDiff,
  fmtHours,
  maskNi,
  sheetTotals,
  type TimesheetSheet,
} from "@/lib/timesheets/data";

function Notice({ tone, children }: { tone: "warn" | "info"; children: ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : Info;
  return (
    <div
      role="note"
      className={
        tone === "warn"
          ? "flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] text-foreground"
          : "flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-[13px] text-foreground"
      }
    >
      <Icon
        className={tone === "warn" ? "mt-0.5 size-4 text-warning" : "mt-0.5 size-4 text-primary"}
        aria-hidden="true"
      />
      <div>{children}</div>
    </div>
  );
}

export function SheetCheckPanel({
  sheet,
  onBack,
  onDownload,
}: {
  sheet: TimesheetSheet;
  onBack: () => void;
  onDownload: () => void;
}) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const t = useMemo(() => sheetTotals(sheet), [sheet]);
  const rows = onlyIssues ? sheet.rows.filter((row) => row.result !== "match") : sheet.rows;
  const notFound = sheet.status === "staff_not_found";
  const allMatch = t.issues === 0 && !t.statedMismatch && !notFound;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" aria-label="Back to all sheets" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{sheet.staffName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{sheet.monthLabel}</span>
              <span className="num">NI {maskNi(sheet.ni)}</span>
              <span>{sheet.fileName}</span>
              <Pill tone="mute">{FORMAT_LABEL[sheet.format]}</Pill>
            </p>
          </div>
        </div>
        <SheetStatusBadge status={sheet.status} />
      </div>

      {notFound ? (
        <Notice tone="warn">
          This person is not in Staff yet. Add them, or ask the sender for their NI number, before
          this sheet can be checked.
        </Notice>
      ) : null}
      {sheet.matchedBy === "name" ? (
        <Notice tone="warn">
          The sheet has no NI number, so this was matched by name only. Confirm it is the right
          person.
        </Notice>
      ) : null}
      {t.statedMismatch ? (
        <Notice tone="warn">
          The sheet says <strong>{fmtHours(sheet.statedHours)}</strong> in total, but its rows add
          up to <strong>{fmtHours(t.sheetHours)}</strong>.
        </Notice>
      ) : null}
      {sheet.readNote ? <Notice tone="info">{sheet.readNote}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Hours on the sheet" value={fmtHours(t.sheetHours)} />
        <SummaryCard label="Hours in our records" value={fmtHours(t.recordHours)} />
        <SummaryCard
          label="Difference"
          value={fmtDiff(t.diff)}
          tone={t.diff === 0 ? "success" : t.diff > 0 ? "danger" : "warning"}
          sublabel={t.diff > 0 ? "Sheet is higher" : t.diff < 0 ? "Sheet is lower" : undefined}
        />
        <SummaryCard
          label="Rows to look at"
          value={String(t.issues)}
          sublabel={`of ${sheet.rows.length} rows`}
          tone={t.issues ? "warning" : "success"}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Shift by shift"
          description={`${rows.length} of ${sheet.rows.length} rows shown`}
          actions={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={onlyIssues ? "outline" : "default"}
                onClick={() => setOnlyIssues(false)}
              >
                All rows
              </Button>
              <Button
                size="sm"
                variant={onlyIssues ? "default" : "outline"}
                onClick={() => setOnlyIssues(true)}
              >
                Needs a look
              </Button>
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="Nothing to look at" description="Every row matches our records." />
        ) : (
          <TableWrap>
            <Table className="min-w-[860px]">
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Site</TH>
                  <TH>Time</TH>
                  <TH align="right">Sheet</TH>
                  <TH align="right">Our record</TH>
                  <TH align="right">Difference</TH>
                  <TH>Result</TH>
                  <TH>Note</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id} className={row.result === "match" ? "" : "bg-warning-soft/30"}>
                    <TD>{fmtDate(row.date)}</TD>
                    <TD>{row.site}</TD>
                    <TD mono>
                      {row.start} to {row.end}
                    </TD>
                    <TD align="right" mono>
                      {fmtHours(row.sheetHours)}
                    </TD>
                    <TD align="right" mono>
                      {row.recordHours === null ? "—" : fmtHours(row.recordHours)}
                    </TD>
                    <TD align="right" mono>
                      {row.recordHours === null ? "—" : fmtDiff(row.sheetHours - row.recordHours)}
                    </TD>
                    <TD>
                      <RowResultBadge result={row.result} />
                    </TD>
                    <TD className="max-w-[280px] truncate text-muted-foreground">
                      {row.note ?? ""}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted/50 px-4 py-3">
        <p className="text-[13px] text-muted-foreground">
          {notFound
            ? "Add this person to Staff first, then check the sheet again."
            : allMatch
              ? "Everything matches. The receipt will show this sheet as all correct."
              : "The receipt lists every row marked above so you can send it to the staff member."}
        </p>
        <Button onClick={onDownload}>
          <Download className="size-4" /> Download receipt
        </Button>
      </div>
    </div>
  );
}