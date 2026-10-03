import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/app/Field";
import { importPayrollSheet } from "@/lib/actions/payroll";
import { readFileToSheets, type SheetMatrix } from "@/lib/payroll/excel";
import {
  parsePayrollSheet,
  type PayrollImportMatch,
  type PayrollImportLineAction,
  type PayrollImportParse,
  type PayrollImportResult,
} from "@/lib/payroll/sheetImport";
import { formatMonthLabel } from "@/lib/payroll/calc";
import { errorMessage } from "@/lib/payroll/queries";
import { useRefreshPayroll } from "@/lib/payroll/sheetQueries";
import { formatMoney } from "@/lib/ledger/calc";

const FILE_ACCEPT = ".xlsx,.csv";

const MATCH_LABEL: Record<PayrollImportMatch, string> = {
  matched: "On file",
  new: "New staff",
  notFound: "Not found",
  ambiguous: "Same name twice",
  niConflict: "NI differs",
};

const LINE_LABEL: Record<PayrollImportLineAction, string> = {
  add: "Add",
  update: "Update",
  unchanged: "No change",
  skip: "Kept as is",
  none: "Skipped",
};

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Brings an "All Payroll Format" Excel file into the open payroll sheet: hours, bank holiday hours,
 * holiday entitlement, comment and rate go on the sheet; the personal / banking / contract / SIA
 * columns fill empty staff fields (or create the staff). Always shows a preview first — nothing is
 * written until "Import" is pressed.
 */
export function ImportPayrollDialog({
  open,
  onOpenChange,
  sheetId,
  companyName,
  month,
  canCreateStaff,
  canEditStaff,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sheetId: string;
  companyName: string;
  month: string;
  canCreateStaff: boolean;
  canEditStaff: boolean;
}) {
  const refresh = useRefreshPayroll();
  const [fileName, setFileName] = useState("");
  const [tabs, setTabs] = useState<{ name: string; parse: PayrollImportParse }[]>([]);
  const [tab, setTab] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);

  const [updateExisting, setUpdateExisting] = useState(true);
  const [createMissing, setCreateMissing] = useState(true);
  const [fillDetails, setFillDetails] = useState(true);

  const [preview, setPreview] = useState<PayrollImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const runId = useRef(0);

  const parse = useMemo(() => tabs.find((t) => t.name === tab)?.parse ?? null, [tabs, tab]);
  const rows = parse?.rows;

  function reset() {
    setFileName("");
    setTabs([]);
    setTab("");
    setError("");
    setPreview(null);
  }

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    setFileName(file.name);
    setReading(true);
    try {
      const { sheets } = await readFileToSheets(file);
      const parsed = sheets
        .map((s: SheetMatrix) => ({ name: s.name, parse: parsePayrollSheet(s.matrix) }))
        .filter((t) => t.parse.found);
      if (parsed.length === 0) {
        setError(
          "This doesn't look like the All Payroll Format file — a header row with “Employee Name” and “Units (Hours)” was not found.",
        );
        return;
      }
      setTabs(parsed);
      // prefer the tab named after this sheet's month ("August 2026"), else the first one
      const label = formatMonthLabel(month).toLowerCase();
      setTab((parsed.find((t) => t.name.trim().toLowerCase() === label) ?? parsed[0]!).name);
    } catch (err) {
      setError(errorMessage(err, "Could not read that file."));
    } finally {
      setReading(false);
    }
  }

  // live preview: re-reads the database every time the file, tab or an option changes
  useEffect(() => {
    if (!open || !rows || rows.length === 0) {
      setPreview(null);
      return;
    }
    const id = ++runId.current;
    setPreviewing(true);
    importPayrollSheet({
      data: {
        sheetId,
        apply: false,
        createMissing: createMissing && canCreateStaff,
        updateExisting,
        fillDetails: fillDetails && canEditStaff,
        rows,
      },
    })
      .then((res) => {
        if (id === runId.current) setPreview(res);
      })
      .catch((err) => {
        if (id !== runId.current) return;
        setPreview(null);
        setError(errorMessage(err, "Could not check the file."));
      })
      .finally(() => {
        if (id === runId.current) setPreviewing(false);
      });
  }, [
    open,
    rows,
    sheetId,
    createMissing,
    updateExisting,
    fillDetails,
    canCreateStaff,
    canEditStaff,
  ]);

  async function doImport() {
    if (!rows || !preview) return;
    setImporting(true);
    try {
      const res = await importPayrollSheet({
        data: {
          sheetId,
          apply: true,
          createMissing: createMissing && canCreateStaff,
          updateExisting,
          fillDetails: fillDetails && canEditStaff,
          rows,
        },
      });
      await refresh();
      toast.success(
        `Imported: ${res.added} added, ${res.updated} updated${res.created ? `, ${res.created} new staff` : ""}.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Import failed."));
    } finally {
      setImporting(false);
    }
  }

  const problems = preview
    ? preview.rows.filter((r) => ["notFound", "ambiguous", "niConflict"].includes(r.match))
    : [];
  const writes = preview ? preview.added + preview.updated + preview.created + preview.filledStaff : 0;
  const invalidList = parse ? Object.entries(parse.invalid) : [];

  return (
    <Dialog open={open} onOpenChange={(v) => !importing && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Import Excel — {companyName} ({formatMonthLabel(month)})
          </DialogTitle>
          <DialogDescription>
            Choose your All Payroll Format file. Hours, bank holiday hours, comment and rate go onto
            this sheet; Total Hours and Amount are worked out again by the app. You see a preview
            first — nothing is saved until you press Import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Payroll file (.xlsx / .csv)">
            <Input
              type="file"
              accept={FILE_ACCEPT}
              onChange={(e) => onFile(e.target.files?.[0])}
              disabled={importing}
            />
          </Field>

          {reading ? <p className="text-[12px] text-muted-foreground">Reading {fileName}…</p> : null}
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          ) : null}

          {tabs.length > 1 ? (
            <Field label="Which tab of the file?">
              <Select value={tab} onValueChange={setTab}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tabs.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name} — {t.parse.rows.length} people
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {parse ? (
            <>
              <p className="text-[12px] text-muted-foreground">
                {parse.rows.length} people read from “{tab}”
                {parse.skippedRows > 0
                  ? ` · ${parse.skippedRows} template / empty rows ignored`
                  : ""}
                {parse.duplicates.length > 0
                  ? ` · ${parse.duplicates.length}+ repeated (${parse.duplicates.slice(0, 3).join(", ")}) — the row with pay is used`
                  : ""}
                {parse.mergedRows > 0
                  ? ` · ${parse.mergedRows} extra row${parse.mergedRows === 1 ? "" : "s"} (no name) merged into the person above`
                  : ""}
              </p>
              {parse.mismatches.length > 0 ? (
                <p className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  The amount differs from the file’s Amount column for {parse.mismatches.length}{" "}
                  {parse.mismatches.length === 1 ? "person" : "people"} — check before importing:{" "}
                  {parse.mismatches.join(" · ")}.
                </p>
              ) : null}
              {invalidList.length > 0 ? (
                <p className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  Some cells could not be read and were left out:{" "}
                  {invalidList.map(([k, n]) => `${k} (${n})`).join(", ")}.
                </p>
              ) : null}

              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="imp-update"
                    checked={updateExisting}
                    onCheckedChange={(v) => setUpdateExisting(v === true)}
                  />
                  <Label htmlFor="imp-update" className="text-[12px]">
                    Update people who are already on this sheet (only the values the file has)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="imp-create"
                    checked={createMissing && canCreateStaff}
                    disabled={!canCreateStaff}
                    onCheckedChange={(v) => setCreateMissing(v === true)}
                  />
                  <Label htmlFor="imp-create" className="text-[12px]">
                    Create staff records for people not found yet
                    {!canCreateStaff ? " (needs Staff › Create permission)" : ""}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="imp-fill"
                    checked={fillDetails && canEditStaff}
                    disabled={!canEditStaff}
                    onCheckedChange={(v) => setFillDetails(v === true)}
                  />
                  <Label htmlFor="imp-fill" className="text-[12px]">
                    Fill empty personal / banking / contract fields of existing staff (never
                    overwrites)
                    {!canEditStaff ? " (needs Staff › Edit permission)" : ""}
                  </Label>
                </div>
              </div>
            </>
          ) : null}

          {previewing && !preview ? (
            <p className="text-[12px] text-muted-foreground">Checking against your data…</p>
          ) : null}

          {preview ? (
            <div className="space-y-3">
              <div className="grid gap-2 text-[12px] sm:grid-cols-4">
                <Stat label="To add" value={preview.added} />
                <Stat label="To update" value={preview.updated} />
                <Stat label="New staff" value={preview.created} />
                <Stat
                  label="Staff fields filled"
                  value={preview.filledFields}
                  hint={`${preview.filledStaff} people`}
                />
              </div>
              <p className="text-[12px] text-muted-foreground">
                Hours written: <b className="text-foreground">{num(preview.writtenHours)}</b> ·
                Amount: <b className="text-foreground">{formatMoney(preview.writtenAmount)}</b> — compare
                with “Total Working hours” / “Total Amount” at the top of your Excel file.
                {preview.unchanged > 0 ? ` ${preview.unchanged} already match.` : ""}
                {preview.skipped > 0 ? ` ${preview.skipped} left as they are.` : ""}
              </p>
              {preview.noRate > 0 ? (
                <p className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  {preview.noRate} line{preview.noRate === 1 ? "" : "s"} will have a rate of 0 (no rate in
                  the file and no company default) — their amount will show 0 until you set a rate.
                </p>
              ) : null}
              {problems.length > 0 ? (
                <p className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  {problems.length} row{problems.length === 1 ? "" : "s"} will be skipped:{" "}
                  {problems
                    .slice(0, 6)
                    .map((p) => `${p.name} (${MATCH_LABEL[p.match]})`)
                    .join(", ")}
                  {problems.length > 6 ? "…" : ""}
                </p>
              ) : null}

              <div className="max-h-64 overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[560px] border-collapse text-[12px]">
                  <thead className="sticky top-0 bg-surface-muted text-left">
                    <tr className="h-8">
                      <th className="px-2 font-medium">Name</th>
                      <th className="px-2 font-medium">Staff</th>
                      <th className="px-2 font-medium">Sheet line</th>
                      <th className="px-2 text-right font-medium">Units</th>
                      <th className="px-2 text-right font-medium">Bank hol.</th>
                      <th className="px-2 text-right font-medium">Total</th>
                      <th className="px-2 text-right font-medium">Rate</th>
                      <th className="px-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={`${r.name}-${i}`} className="h-8 border-t border-border">
                        <td className="px-2">{r.name}</td>
                        <td className="px-2">{MATCH_LABEL[r.match]}</td>
                        <td className="px-2">{LINE_LABEL[r.line]}</td>
                        <td className="px-2 text-right">{r.line === "none" ? "—" : num(r.unitsHours)}</td>
                        <td className="px-2 text-right">
                          {r.line === "none" ? "—" : num(r.bankHolidayHours)}
                        </td>
                        <td className="px-2 text-right">{r.line === "none" ? "—" : num(r.totalHours)}</td>
                        <td className="px-2 text-right">{r.line === "none" ? "—" : num(r.rate)}</td>
                        <td className="px-2 text-right">
                          {r.line === "none" ? "—" : formatMoney(r.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={doImport} disabled={!preview || previewing || importing || writes === 0}>
            {importing ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-[15px] font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}