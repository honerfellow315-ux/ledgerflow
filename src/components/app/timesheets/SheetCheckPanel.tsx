import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  Eye,
  Info,
  Pencil,
  RefreshCw,
  Trash2,
} from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/ledger/calc";
import { Pill, RowResultBadge, SheetStatusBadge } from "@/components/app/timesheets/badges";
import {
  FORMAT_LABEL,
  fmtDate,
  fmtDiff,
  fmtHours,
  maskNi,
  sheetTotals,
  type SheetRow,
  type TimesheetSheet,
} from "@/lib/timesheets/data";
import { AcceptDifferenceDialog } from "@/components/app/timesheets/AcceptDifferenceDialog";
import { ReadRowDialog } from "@/components/app/timesheets/ReadRowDialog";
import { EditRowDialog } from "@/components/app/timesheets/EditRowDialog";
import {
  PayPanel,
  type AccountInput,
  type PaymentInput,
} from "@/components/app/timesheets/PayPanel";
import type { TimesheetPayInfo } from "@/lib/actions/timesheets";

/** Start / end of a shift. A missing time is said in words instead of a bare dash. */
function ShiftTimes({ start, end }: { start: string; end: string }) {
  const has = (t: string) => Boolean(t) && t !== "—";
  if (!has(start) && !has(end)) {
    return <span className="font-sans text-xs text-muted-foreground">No times on sheet</span>;
  }
  return (
    <span>
      {has(start) ? start : <span className="text-muted-foreground">not given</span>}
      <span className="px-1.5 text-muted-foreground">→</span>
      {has(end) ? end : <span className="text-muted-foreground">not given</span>}
    </span>
  );
}

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
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function SheetCheckPanel({
  sheet,
  onBack,
  onDownload,
  onPrint,
  onRecheck,
  onDelete,
  onConfirm,
  onCorrectIdentity,
  onAcceptRow,
  onUnacceptRow,
  onAcceptStated,
  onUnacceptStated,
  onEditRow,
  payInfo,
  onSaveAccount,
  onAddPayment,
  onDeletePayment,
  payBusy,
  busy = false,
}: {
  sheet: TimesheetSheet;
  onBack: () => void;
  onDownload: () => void;
  onPrint?: () => void;
  /** Confirms a name-only match (shown only for those sheets). */
  onConfirm?: () => void;
  onRecheck?: () => void;
  onDelete?: () => void;
  busy?: boolean;
  onCorrectIdentity?: (name: string, ni: string, dob: string) => void;
  /** Accept a difference with the actual hours and a reason (approvers). Left out for everyone else. */
  onAcceptRow?: (rowId: string, note: string, actualHours: number) => void;
  onUnacceptRow?: (rowId: string) => void;
  onAcceptStated?: (note: string) => void;
  onUnacceptStated?: () => void;
  /** Change the hours / rate of one shift. The Salary Sheet gets the same figures. */
  onEditRow?: (rowId: string, hours: number, rate: number, note: string) => void;
  /** Bank details and payments of this staff member for the month. */
  payInfo?: TimesheetPayInfo | null;
  onSaveAccount?: (a: AccountInput) => void;
  onAddPayment?: (p: PaymentInput) => void;
  onDeletePayment?: (paymentId: string) => void;
  /** Payments stay possible in a locked month; only a running request blocks them. */
  payBusy?: boolean;
}) {
  const [editRow, setEditRow] = useState<SheetRow | null>(null);
  /** The row whose "Accept with note" pop-up is open. */
  const [dialogRow, setDialogRow] = useState<SheetRow | null>(null);
  const [readRow, setReadRow] = useState<SheetRow | null>(null);
  const [statedNote, setStatedNote] = useState("");
  const [statedOpen, setStatedOpen] = useState(false);
  const [sourceName, setSourceName] = useState(sheet.sourceName ?? "");
  const [sourceNi, setSourceNi] = useState(sheet.sourceNi ?? "");
  const [sourceDob, setSourceDob] = useState(sheet.sourceDob ?? "");
  const [editIdentity, setEditIdentity] = useState(sheet.status === "staff_not_found");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [lastIssueId, setLastIssueId] = useState<string | null>(null);
  const t = useMemo(() => sheetTotals(sheet), [sheet]);
  const openIssues = sheet.rows.filter(
    (row) => row.result !== "match" && !row.accepted && !row.edited,
  );
  const goToNextIssue = () => {
    if (openIssues.length === 0) return;
    const at = openIssues.findIndex((row) => row.id === lastIssueId);
    const next = openIssues[(at + 1) % openIssues.length]!;
    setLastIssueId(next.id);
    // The row may be hidden by the "Needs a look" filter or not drawn yet: show all rows first.
    setOnlyIssues(false);
    window.setTimeout(() => {
      document
        .getElementById(`ts-row-${next.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };
  const rows = onlyIssues
    ? sheet.rows.filter((row) => row.result !== "match" && !row.accepted && !row.edited)
    : sheet.rows;
  const notFound = sheet.status === "staff_not_found";
  const allMatch = t.issues === 0 && !t.statedMismatch && !notFound;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 max-w-full items-start gap-3">
          <Button variant="outline" size="icon" aria-label="Back to all sheets" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 break-words">
            <h1 className="text-xl font-semibold text-foreground">{sheet.staffName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{sheet.monthLabel}</span>
              <span className="num">NI {maskNi(sheet.ni)}</span>
              <span className="min-w-0 break-all">{sheet.fileName}</span>
              <Pill tone="mute">{FORMAT_LABEL[sheet.format]}</Pill>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onRecheck ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onRecheck}>
              <RefreshCw className="size-4" /> Check again
            </Button>
          ) : null}
          {onDelete ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onDelete}>
              <Trash2 className="size-4" /> Delete
            </Button>
          ) : null}
          <SheetStatusBadge status={sheet.status} />
        </div>
      </div>

      {(() => {
        const suggested = sheet.matchedBy === "name" && !sheet.staffConfirmed && !notFound;
        const verified = !notFound && !suggested;
        const frame = notFound
          ? "border-destructive/40 bg-destructive/5"
          : suggested
            ? "border-warning/40 bg-warning-soft"
            : "border-primary/30 bg-primary/5";
        return (
          <section
            aria-label="Staff identity"
            className={cn("rounded-xl border-2 p-4 sm:p-5", frame)}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">Staff identity</h2>
                  <Pill tone={notFound ? "bad" : suggested ? "warn" : "good"}>
                    {notFound
                      ? "Not verified"
                      : suggested
                        ? "Waiting for your approval"
                        : sheet.matchedBy === "ni"
                          ? "Verified by NI number"
                          : "Approved"}
                  </Pill>
                </div>
                <p className="mt-1.5 text-sm text-foreground">
                  {notFound ? (
                    <>
                      No staff member could be matched yet. Enter the <strong>NI number</strong> (or
                      the <strong>name</strong> if there is no NI number) below and press{" "}
                      <strong>Verify identity</strong>.
                    </>
                  ) : suggested ? (
                    <>
                      Suggested staff member: <strong>{sheet.staffName}</strong>. It was found by
                      name, which is not final because two people can share a name or a date of
                      birth. Check it is the right person, then approve.
                    </>
                  ) : (
                    <>
                      Staff member: <strong>{sheet.staffName}</strong>
                      {sheet.matchedBy === "ni"
                        ? ". The NI number on the sheet matches Staff."
                        : ". You approved this match."}
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {suggested && onConfirm ? (
                  <Button size="sm" disabled={busy} onClick={onConfirm}>
                    <Check className="size-4" /> Approve {sheet.staffName}
                  </Button>
                ) : null}
                {onCorrectIdentity ? (
                  <Button
                    size="sm"
                    variant={notFound ? "default" : "outline"}
                    disabled={busy}
                    onClick={() => setEditIdentity(!editIdentity)}
                  >
                    <Pencil className="size-4" />
                    {editIdentity
                      ? "Hide identity form"
                      : verified
                        ? "Edit identity"
                        : "Enter / correct identity"}
                  </Button>
                ) : null}
              </div>
            </div>
            {onCorrectIdentity && editIdentity ? (
              <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
                <p className="text-xs text-muted-foreground">
                  The NI number is checked first and is final when it matches. With no NI number the
                  name is used (and the date of birth, if you add it) to suggest a staff member,
                  which you then approve. This changes the uploaded sheet only.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs">
                    NI number
                    <input
                      value={sourceNi}
                      onChange={(e) => setSourceNi(e.target.value)}
                      maxLength={20}
                      autoComplete="off"
                      className="mt-1 h-9 w-full rounded-lg border bg-background px-2"
                    />
                  </label>
                  <label className="block text-xs">
                    Name
                    <input
                      value={sourceName}
                      onChange={(e) => setSourceName(e.target.value)}
                      maxLength={120}
                      autoComplete="off"
                      className="mt-1 h-9 w-full rounded-lg border bg-background px-2"
                    />
                  </label>
                  <label className="block text-xs">
                    Date of birth (optional)
                    <input
                      type="date"
                      value={sourceDob}
                      onChange={(e) => setSourceDob(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border bg-background px-2"
                    />
                  </label>
                </div>
                <Button
                  size="sm"
                  disabled={busy || (!sourceName.trim() && !sourceNi.trim())}
                  onClick={() => onCorrectIdentity(sourceName.trim(), sourceNi.trim(), sourceDob)}
                >
                  <Check className="size-4" /> Verify identity
                </Button>
              </div>
            ) : null}
          </section>
        );
      })()}
      {t.statedMismatch ? (
        <Notice tone="warn">
          <div className="space-y-2">
            <p>
              The sheet says <strong>{fmtHours(sheet.statedHours)}</strong> in total, but its rows
              add up to <strong>{fmtHours(t.sheetHours)}</strong>.
            </p>
            {onAcceptStated ? (
              statedOpen ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={statedNote}
                    onChange={(e) => setStatedNote(e.target.value)}
                    placeholder="Reason for accepting"
                    aria-label="Reason for accepting the sheet total"
                    className="h-8 min-w-[220px] flex-1 rounded-md border border-border bg-background px-2 text-sm"
                  />
                  <Button
                    size="sm"
                    disabled={busy || statedNote.trim().length < 3}
                    onClick={() => {
                      onAcceptStated(statedNote.trim());
                      setStatedOpen(false);
                      setStatedNote("");
                    }}
                  >
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setStatedOpen(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setStatedOpen(true)}
                >
                  Accept with note
                </Button>
              )
            ) : null}
          </div>
        </Notice>
      ) : null}
      {sheet.statedAccepted ? (
        <Notice tone="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              The sheet's total differs from its rows. Accepted by {sheet.statedAccepted.by}:{" "}
              {sheet.statedAccepted.note}
            </span>
            {onUnacceptStated ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={onUnacceptStated}>
                Withdraw
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : null}
      {sheet.readNote ? (
        <Notice tone="info">
          <span className="whitespace-pre-line">{sheet.readNote}</span>
        </Notice>
      ) : null}

      <div className="-mx-1 grid gap-3 px-1 py-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="Hours on the sheet" value={fmtHours(t.sheetHours)} />
        <SummaryCard
          label="Hours in our records"
          value={notFound ? "Not linked" : fmtHours(t.recordHours)}
          sublabel={
            notFound
              ? "Match this sheet to a staff member first"
              : "Imported shifts for this staff member and month"
          }
        />
        <SummaryCard
          label="Difference"
          value={notFound ? "Not compared" : fmtDiff(t.diff)}
          tone={notFound ? "warning" : t.diff === 0 ? "success" : t.diff > 0 ? "danger" : "warning"}
          {...(!notFound && t.diff !== 0
            ? { sublabel: t.diff > 0 ? "Sheet is higher" : "Sheet is lower" }
            : {})}
        />
        <SummaryCard
          label="Rows to look at"
          value={String(t.issues)}
          sublabel={`of ${sheet.rows.length} rows`}
          tone={t.issues ? "warning" : "success"}
        />
        <SummaryCard
          label="Payable hours"
          value={notFound || !t.payCalculated ? "—" : fmtHours(t.payHours)}
          sublabel={
            notFound
              ? "Match this sheet to a staff member first"
              : !t.payCalculated
                ? "Press Check again to calculate"
                : t.issues
                  ? "Rows still to look at are not included"
                  : "Matched rows + accepted actual hours"
          }
        />
        <SummaryCard
          label="Amount to pay"
          value={notFound || !t.payCalculated ? "—" : formatMoney(t.payAmount)}
          sublabel="Payable hours × rate"
          tone={t.payCalculated && !notFound && t.issues === 0 ? "success" : "warning"}
        />
      </div>

      {sheet.rows.some((row) => /Possible duplicate|more than 24 hours/.test(row.note ?? "")) ? (
        <Notice tone="warn">
          Some stored shifts may be duplicated or exceed 24 hours on one date. Review the flagged
          rows and the source shift imports. No records have been removed or excluded from the
          total.
        </Notice>
      ) : null}
      <Panel>
        <PanelHeader
          title="Shift by shift"
          description={`${rows.length} of ${sheet.rows.length} rows shown. Sites come from the uploaded sheet; differences from salary records appear in Note.`}
          actions={
            <div className="flex items-center gap-2">
              {openIssues.length > 0 ? (
                <Button size="sm" variant="outline" onClick={goToNextIssue}>
                  Next issue ({openIssues.length})
                </Button>
              ) : null}
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
            <Table className="min-w-[1180px]">
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Site on sheet</TH>
                  <TH>Start / end</TH>
                  <TH align="right">Sheet hours</TH>
                  <TH align="right">Recorded hours</TH>
                  <TH align="right">Difference</TH>
                  <TH align="right">Rate</TH>
                  <TH align="right">Pay hours</TH>
                  <TH align="right">Amount</TH>
                  <TH>Result</TH>
                  <TH>Note</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const open = row.result !== "match" && !row.accepted && !row.edited;
                  const calculated = row.payAmount !== null && row.payAmount !== undefined;
                  return (
                    <TR
                      key={row.id}
                      id={`ts-row-${row.id}`}
                      className={cn(
                        "lf-eq-row transition-colors hover:bg-surface-muted/50",
                        open
                          ? "bg-warning-soft/30"
                          : row.accepted || row.edited
                            ? "bg-success-soft/20"
                            : "",
                        row.id === lastIssueId && "ring-2 ring-inset ring-primary/60",
                      )}
                    >
                      <TD className="whitespace-nowrap font-medium">{fmtDate(row.date)}</TD>
                      <TD className="w-[190px] max-w-[190px] whitespace-normal break-words">
                        {row.site || "Not provided"}
                      </TD>
                      <TD mono className="whitespace-nowrap">
                        <ShiftTimes start={row.start} end={row.end} />
                      </TD>
                      <TD align="right" mono>
                        {fmtHours(row.sheetHours)}
                      </TD>
                      <TD align="right" mono>
                        {row.recordHours === null ? "—" : fmtHours(row.recordHours)}
                      </TD>
                      <TD align="right" mono>
                        {row.accepted || row.edited
                          ? fmtDiff(0)
                          : row.recordHours === null
                            ? "—"
                            : fmtDiff(row.sheetHours - row.recordHours)}
                      </TD>
                      <TD align="right" mono className="text-muted-foreground">
                        {row.payRate === null || row.payRate === undefined
                          ? "—"
                          : row.payRate > 0
                            ? formatMoney(row.payRate)
                            : "No rate"}
                      </TD>
                      <TD align="right" mono>
                        {!calculated ? (
                          "—"
                        ) : open ? (
                          <span className="text-xs font-medium text-warning">Pending</span>
                        ) : (
                          fmtHours(row.payHours ?? 0)
                        )}
                      </TD>
                      <TD align="right" mono className="font-semibold">
                        {!calculated ? (
                          "—"
                        ) : open ? (
                          <span className="text-xs font-medium text-warning">Pending</span>
                        ) : (
                          <span className="text-primary">{formatMoney(row.payAmount ?? 0)}</span>
                        )}
                      </TD>
                      <TD>
                        <RowResultBadge result={row.result} />
                        {row.accepted ? (
                          <div className="mt-1">
                            <Pill tone="good">Accepted</Pill>
                          </div>
                        ) : null}
                        {row.edited ? (
                          <div className="mt-1">
                            <Pill tone="good">Edited</Pill>
                          </div>
                        ) : null}
                      </TD>
                      <TD className="w-[300px] max-w-[300px] whitespace-normal break-words text-xs">
                        {row.accepted ? (
                          <p
                            className="lf-clamp2 text-foreground"
                            title={row.accepted.note}
                          >
                            <span className="font-medium">
                              {row.accepted.actualHours !== null &&
                              row.accepted.actualHours !== undefined
                                ? `Actual ${fmtHours(row.accepted.actualHours)}`
                                : "Accepted"}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {row.accepted.by} · {row.accepted.note}
                            </span>
                          </p>
                        ) : row.edited ? (
                          <p className="lf-clamp2 text-foreground" title={row.edited.note ?? ""}>
                            <span className="font-medium">
                              Edited: {fmtHours(row.edited.hours)} × {formatMoney(row.edited.rate)}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {row.edited.by}
                              {row.edited.note ? ` · ${row.edited.note}` : ""}
                            </span>
                          </p>
                        ) : row.note ? (
                          <p className="lf-clamp2 text-muted-foreground" title={row.note}>
                            {row.note}
                          </p>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TD>
                      <TD align="right" className="w-[1%] whitespace-nowrap">
                        <div className="flex flex-nowrap items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => setReadRow(row)}
                          >
                            <Eye className="size-3.5" /> Read
                          </Button>
                          {row.accepted && onAcceptRow ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7"
                              disabled={busy}
                              onClick={() => setDialogRow(row)}
                            >
                              Edit note
                            </Button>
                          ) : null}
                          {row.accepted && onUnacceptRow ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-muted-foreground"
                              disabled={busy}
                              onClick={() => onUnacceptRow(row.id)}
                            >
                              Withdraw
                            </Button>
                          ) : null}
                          {!row.accepted && !row.edited && open && onAcceptRow ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-primary/40 text-primary hover:bg-primary/10"
                              disabled={busy}
                              onClick={() => setDialogRow(row)}
                            >
                              Accept with note
                            </Button>
                          ) : null}
                          {onEditRow && !row.note?.startsWith("Counted once") ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7"
                              disabled={busy}
                              onClick={() => setEditRow(row)}
                            >
                              <Pencil className="size-3.5" /> Edit
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      {payInfo ? (
        <PayPanel
          info={payInfo}
          busy={payBusy ?? busy}
          monthLabel={sheet.monthLabel}
          {...(onSaveAccount ? { onSaveAccount } : {})}
          {...(onAddPayment ? { onAddPayment } : {})}
          {...(onDeletePayment ? { onDeletePayment } : {})}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted/50 px-4 py-3">
        <p className="text-[13px] text-muted-foreground">
          {notFound
            ? "Add this person to Staff first, then check the sheet again."
            : allMatch
              ? "Everything matches. The receipt will show this sheet as all correct."
              : "The receipt lists every row marked above so you can send it to the staff member."}
        </p>
        {onPrint ? (
          <Button variant="outline" onClick={onPrint}>
            Print / Save PDF
          </Button>
        ) : null}
        <Button onClick={onDownload}>
          <Download className="size-4" /> Download receipt
        </Button>
      </div>
      <ReadRowDialog row={readRow} onClose={() => setReadRow(null)} />
      {onEditRow ? (
        <EditRowDialog
          row={editRow}
          busy={busy}
          onClose={() => setEditRow(null)}
          onSubmit={(hours, rate, note) => {
            if (editRow) onEditRow(editRow.id, hours, rate, note);
            setEditRow(null);
          }}
        />
      ) : null}
      {onAcceptRow ? (
        <AcceptDifferenceDialog
          row={dialogRow}
          busy={busy}
          onClose={() => setDialogRow(null)}
          onSubmit={(note, hours) => {
            if (dialogRow) onAcceptRow(dialogRow.id, note, hours);
            setDialogRow(null);
          }}
        />
      ) : null}
    </div>
  );
}
