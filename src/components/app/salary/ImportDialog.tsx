import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  importMasterSheet,
  importPayrollAmounts,
  importShiftsChunk,
  recomputeSheetFromShifts,
} from "@/lib/actions/salary";
import {
  parseMasterSheet,
  parseShiftExport,
  parseTable,
  readFileToSheets,
  toNumber,
  toText,
  type MasterParse,
  type ShiftParse,
  type TableParse,
} from "@/lib/payroll/excel";
import { computeEntry, formatMonthLabel } from "@/lib/payroll/calc";
import { errorMessage, useRefreshSalary } from "@/lib/payroll/queries";
import { usePermissions } from "@/lib/ledger/permissions";
import { formatMoney } from "@/lib/ledger/calc";
import type { PayrollCompany, ShiftSource } from "@/lib/payroll/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  periodId: string;
  month: string;
  companies: PayrollCompany[];
}

export function ImportDialog({ open, onOpenChange, periodId, month, companies }: Props) {
  const [tab, setTab] = useState("shifts");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import into {formatMonthLabel(month)}</DialogTitle>
          <DialogDescription>
            Files are read in your browser — nothing is saved until you press Import.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="shifts">Shift export</TabsTrigger>
            <TabsTrigger value="payroll">Payroll file</TabsTrigger>
            <TabsTrigger value="master">Excel salary sheet</TabsTrigger>
          </TabsList>
          <TabsContent value="shifts" className="pt-3">
            <ShiftImport periodId={periodId} month={month} />
          </TabsContent>
          <TabsContent value="payroll" className="pt-3">
            <PayrollImport periodId={periodId} companies={companies} />
          </TabsContent>
          <TabsContent value="master" className="pt-3">
            <MasterImport periodId={periodId} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

const FILE_ACCEPT = ".xlsx,.csv";

function Notice({ tone, children }: { tone: "warn" | "ok" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-warning/30 bg-warning-soft text-warning"
      : tone === "ok"
        ? "border-success/30 bg-success-soft text-success"
        : "border-border bg-surface-muted/60 text-muted-foreground";
  return <div className={`rounded-md border px-3 py-2 text-[12px] ${cls}`}>{children}</div>;
}

/* ------------------------------ 1) shifts ------------------------------ */

function ShiftImport({ periodId, month }: { periodId: string; month: string }) {
  const refresh = useRefreshSalary();
  const { can } = usePermissions();
  const canCreateStaff = can("staff", "create");
  const [source, setSource] = useState<ShiftSource>("RSS");
  const [fileName, setFileName] = useState("");
  const [parse, setParse] = useState<ShiftParse | null>(null);
  const [createMissing, setCreateMissing] = useState(canCreateStaff);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setResult(null);
    setParse(null);
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const { sheets } = await readFileToSheets(file);
      let best: ShiftParse | null = null;
      for (const s of sheets) {
        const p = parseShiftExport(s.matrix);
        if (p.rows.length > (best?.rows.length ?? -1)) best = p;
      }
      setParse(best);
    } catch (err) {
      toast.error(errorMessage(err, "Could not read that file."));
    } finally {
      setBusy(false);
    }
  }

  const outside = useMemo(() => {
    if (!parse) return 0;
    return Object.entries(parse.months)
      .filter(([m]) => m !== month)
      .reduce((s, [, n]) => s + n, 0);
  }, [parse, month]);

  async function run() {
    if (!parse || parse.rows.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const SIZE = 1000;
      let matched = 0;
      let created = 0;
      let unmatched = 0;
      for (let i = 0; i < parse.rows.length; i += SIZE) {
        setProgress(
          `Uploading shifts ${Math.min(i + SIZE, parse.rows.length)} / ${parse.rows.length}…`,
        );
        const r = await importShiftsChunk({
          data: {
            periodId,
            source,
            rows: parse.rows.slice(i, i + SIZE),
            reset: i === 0,
            createMissingStaff: createMissing && canCreateStaff,
          },
        });
        matched += r.matched;
        created += r.created;
        unmatched += r.unmatched;
      }
      setProgress("Building each person's totals…");
      const done = await recomputeSheetFromShifts({ data: { periodId, source, fileName } });
      await refresh();
      setResult(
        `Imported ${parse.rows.length} ${source} shifts. ${matched} matched existing staff, ${created} new staff created` +
          (done.unmatched > 0
            ? `, ${done.unmatched} shifts could not be matched to anyone (see the warning on the sheet).`
            : "."),
      );
      toast.success("Shifts imported.");
    } catch (err) {
      toast.error(errorMessage(err, "Import failed."));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Which system?">
          <Select value={source} onValueChange={(v) => setSource(v as ShiftSource)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="RSS">RSS</SelectItem>
              <SelectItem value="ESS">ESS</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Shift export (.xlsx / .csv)">
          <Input type="file" accept={FILE_ACCEPT} onChange={(e) => onFile(e.target.files?.[0])} />
        </Field>
      </div>

      {parse ? (
        <div className="space-y-2">
          {parse.warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
          {parse.rows.length > 0 ? (
            <Notice tone="info">
              <strong className="text-foreground">{parse.rows.length}</strong> shifts ·{" "}
              <strong className="text-foreground">{parse.totals.hours}</strong> hours ·{" "}
              <strong className="text-foreground">{formatMoney(parse.totals.amount)}</strong> total.
              Dates found:{" "}
              {Object.entries(parse.months)
                .map(([m, n]) => `${formatMonthLabel(m)} (${n})`)
                .join(", ") || "none"}
              .
            </Notice>
          ) : null}
          {outside > 0 ? (
            <Notice tone="warn">
              {outside} of {parse.rows.length} shifts are dated outside {formatMonthLabel(month)}.
              Check you picked the right month.
            </Notice>
          ) : null}
          {parse.skipped > 0 ? (
            <Notice tone="info">{parse.skipped} rows without an employee were skipped.</Notice>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Checkbox
          id="create-missing"
          checked={createMissing && canCreateStaff}
          disabled={!canCreateStaff}
          onCheckedChange={(v) => setCreateMissing(v === true)}
        />
        <Label htmlFor="create-missing" className="text-[12px]">
          Create staff records for people not found yet
          {!canCreateStaff ? " (needs Staff › Create permission)" : ""}
        </Label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        People are matched on their {source} ID, then NI number, then a unique name. Importing{" "}
        {source} again for the same month <strong>replaces</strong> the earlier {source} shifts.
      </p>

      {result ? <Notice tone="ok">{result}</Notice> : null}
      <div className="flex items-center justify-end gap-3">
        {progress ? <span className="text-[12px] text-muted-foreground">{progress}</span> : null}
        <Button onClick={run} disabled={busy || !parse || parse.rows.length === 0}>
          {busy ? "Working…" : "Import shifts"}
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------- 2) payroll file ----------------------------- */

type KeyKind = "ni" | "rssId" | "essId" | "name";
const KEY_LABEL: Record<KeyKind, string> = {
  ni: "NI number",
  rssId: "RSS ID",
  essId: "ESS ID",
  name: "Name",
};
const NONE = "__none";

function guessColumn(headers: string[], patterns: RegExp[]) {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return String(i);
  }
  return NONE;
}

function PayrollImport({ periodId, companies }: { periodId: string; companies: PayrollCompany[] }) {
  const refresh = useRefreshSalary();
  const [companyId, setCompanyId] = useState("");
  const [table, setTable] = useState<TableParse | null>(null);
  const [fileName, setFileName] = useState("");
  const [keyKind, setKeyKind] = useState<KeyKind>("ni");
  const [keyCol, setKeyCol] = useState(NONE);
  const [amountCol, setAmountCol] = useState(NONE);
  const [taxCol, setTaxCol] = useState(NONE);
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; notFound: string[] } | null>(null);

  const guessKey = (headers: string[], kind: KeyKind) =>
    guessColumn(
      headers,
      kind === "ni"
        ? [/^ni\b/i, /national\s*ins/i, /\bni\b/i]
        : kind === "rssId"
          ? [/rss/i]
          : kind === "essId"
            ? [/ess/i]
            : [/name/i],
    );

  async function onFile(file: File | undefined) {
    setResult(null);
    setTable(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const { sheets } = await readFileToSheets(file);
      const first = sheets.map((s) => parseTable(s.matrix)).find((t) => t.rows.length > 0);
      if (!first) {
        toast.error("No data rows found in that file.");
        return;
      }
      setTable(first);
      setKeyCol(guessKey(first.headers, keyKind));
      setAmountCol(guessColumn(first.headers, [/amount/i, /net\s*pay/i, /\bpay\b/i, /total/i]));
      setTaxCol(guessColumn(first.headers, [/tax/i, /paye/i]));
    } catch (err) {
      toast.error(errorMessage(err, "Could not read that file."));
    }
  }

  const rows = useMemo(() => {
    if (!table || keyCol === NONE || amountCol === NONE) return [];
    const k = Number(keyCol);
    const a = Number(amountCol);
    const t = taxCol === NONE ? -1 : Number(taxCol);
    return table.rows
      .map((r) => ({
        key: toText(r[k] ?? null),
        amount: toNumber(r[a] ?? null),
        tax: t >= 0 ? toNumber(r[t] ?? null) : 0,
      }))
      .filter((r) => r.key && (r.amount !== 0 || r.tax !== 0));
  }, [table, keyCol, amountCol, taxCol]);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const company = companies.find((c) => c.id === companyId);

  async function run() {
    if (!companyId || rows.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await importPayrollAmounts({
        data: { periodId, companyId, keyKind, mode, rows, fileName },
      });
      await refresh();
      setResult({
        text:
          `${r.matched} staff updated for ${company?.name ?? "payroll"}.` +
          (r.notFoundCount ? ` ${r.notFoundCount} rows had no matching staff.` : ""),
        notFound: r.notFound,
      });
      toast.success("Payroll amounts imported.");
    } catch (err) {
      toast.error(errorMessage(err, "Import failed."));
    } finally {
      setBusy(false);
    }
  }

  const colOptions = (allowNone: boolean) => (
    <SelectContent>
      {allowNone ? <SelectItem value={NONE}>— none —</SelectItem> : null}
      {(table?.headers ?? []).map((h, i) => (
        <SelectItem key={i} value={String(i)}>
          {h}
        </SelectItem>
      ))}
    </SelectContent>
  );

  return (
    <div className="space-y-3">
      {companies.length === 0 ? (
        <Notice tone="warn">
          Add the payroll companies first (Payroll columns button on the sheet), then import their
          files here.
        </Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Payroll company">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Their file (.xlsx / .csv)">
          <Input type="file" accept={FILE_ACCEPT} onChange={(e) => onFile(e.target.files?.[0])} />
        </Field>
      </div>

      {table ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Match staff by">
              <Select
                value={keyKind}
                onValueChange={(v) => {
                  setKeyKind(v as KeyKind);
                  setKeyCol(guessKey(table.headers, v as KeyKind));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KEY_LABEL) as KeyKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KEY_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Column holding the ${KEY_LABEL[keyKind]}`}>
              <Select value={keyCol} onValueChange={setKeyCol}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                {colOptions(true)}
              </Select>
            </Field>
            <Field label="Amount column">
              <Select value={amountCol} onValueChange={setAmountCol}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                {colOptions(true)}
              </Select>
            </Field>
            <Field label="Tax column (optional)" hint="Added to each person's Tax deduction">
              <Select value={taxCol} onValueChange={setTaxCol}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                {colOptions(true)}
              </Select>
            </Field>
            <Field label="If they already have an amount">
              <Select value={mode} onValueChange={(v) => setMode(v as "replace" | "add")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replace">Replace it</SelectItem>
                  <SelectItem value="add">Add to it</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Notice tone="info">
            {rows.length} rows with an amount · total{" "}
            <strong className="text-foreground">{formatMoney(total)}</strong>
            {rows[0] ? ` · first: ${rows[0].key} → ${formatMoney(rows[0].amount)}` : ""}
          </Notice>
        </>
      ) : null}

      {result ? (
        <div className="space-y-2">
          <Notice tone="ok">{result.text}</Notice>
          {result.notFound.length > 0 ? (
            <Notice tone="warn">
              Not found: {result.notFound.slice(0, 15).join(", ")}
              {result.notFound.length > 15 ? "…" : ""}
            </Notice>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={run} disabled={busy || !companyId || rows.length === 0}>
          {busy ? "Importing…" : "Import payroll amounts"}
        </Button>
      </div>
    </div>
  );
}

/* --------------------------- 3) Excel salary sheet --------------------------- */

function MasterImport({ periodId }: { periodId: string }) {
  const refresh = useRefreshSalary();
  const [parse, setParse] = useState<MasterParse | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setResult(null);
    setParse(null);
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const { sheets } = await readFileToSheets(file);
      let best: MasterParse | null = null;
      for (const s of sheets) {
        const p = parseMasterSheet(s.matrix);
        if (p.rows.length > (best?.rows.length ?? -1)) best = p;
      }
      setParse(best);
    } catch (err) {
      toast.error(errorMessage(err, "Could not read that file."));
    } finally {
      setBusy(false);
    }
  }

  // Cross-check: recompute every line with our formulas and compare with the
  // Outstanding the Excel file itself showed.
  const check = useMemo(() => {
    if (!parse) return null;
    let ok = 0;
    let compared = 0;
    for (const r of parse.rows) {
      if (r.fileOutstanding === null) continue;
      compared++;
      const c = computeEntry(
        {
          id: "x",
          periodId: "x",
          staffId: "x",
          rssAmount: r.rssAmount,
          rssHours: r.rssHours,
          essAmount: r.essAmount,
          essHours: r.essHours,
          carryForward: r.carryForward,
          taxDeduction: r.taxDeduction,
          deduction: r.deduction,
          checkStatus: r.checkStatus,
          flag: r.flag,
          payroll: r.payroll,
        },
        r.payments.map((amount, i) => ({
          id: String(i),
          entryId: "x",
          date: "",
          amount,
          method: "",
          reference: "",
        })),
      );
      if (Math.abs(c.outstanding - r.fileOutstanding) < 0.01) ok++;
    }
    return { ok, compared };
  }, [parse]);

  async function run() {
    if (!parse || parse.rows.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      let lines = 0;
      let newStaff = 0;
      let existing = 0;
      let skipped = 0;
      let payments = 0;
      const SIZE = 600;
      for (let i = 0; i < parse.rows.length; i += SIZE) {
        const part = parse.rows.slice(i, i + SIZE).map((r) => {
          const { fileOutstanding: _ignored, ...rest } = r;
          void _ignored;
          return rest;
        });
        const r = await importMasterSheet({ data: { periodId, rows: part, fileName } });
        lines += r.lines;
        newStaff += r.newStaff;
        existing += r.existingStaff;
        skipped += r.skipped;
        payments += r.payments;
      }
      await refresh();
      setResult(
        `Imported ${lines} lines (${newStaff} new staff, ${existing} existing) and ${payments} cash payments.` +
          (skipped ? ` ${skipped} duplicate/blank rows skipped.` : ""),
      );
      toast.success("Excel salary sheet imported.");
    } catch (err) {
      toast.error(errorMessage(err, "Import failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field
        label="Your existing Salary Sheet (.xlsx)"
        hint="Staff records, payroll amounts and P1–P4 cash payments are brought in."
      >
        <Input type="file" accept={FILE_ACCEPT} onChange={(e) => onFile(e.target.files?.[0])} />
      </Field>

      {parse ? (
        <div className="space-y-2">
          {parse.warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
          {parse.rows.length > 0 ? (
            <Notice tone="info">
              <strong className="text-foreground">{parse.rows.length}</strong> staff lines · payroll
              columns: {parse.payrollCompanies.join(", ") || "none"} · up to {parse.maxPayments}{" "}
              cash payments each.
            </Notice>
          ) : null}
          {check && check.compared > 0 ? (
            <Notice tone={check.ok === check.compared ? "ok" : "warn"}>
              Cross-check: LedgerFlow's formulas give the same Outstanding as your Excel file for{" "}
              <strong>
                {check.ok} of {check.compared}
              </strong>{" "}
              lines.
              {check.ok !== check.compared
                ? " Lines that differ usually had a typed-over formula in Excel."
                : ""}
            </Notice>
          ) : null}
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        Lines for people already in this month are overwritten with the file's values. Matching is
        by NI number, then RSS / ESS ID, then unique name. Missing payroll companies are created for
        you.
      </p>
      {result ? <Notice tone="ok">{result}</Notice> : null}
      <div className="flex justify-end">
        <Button onClick={run} disabled={busy || !parse || parse.rows.length === 0}>
          {busy ? "Importing…" : "Import salary sheet"}
        </Button>
      </div>
    </div>
  );
}
