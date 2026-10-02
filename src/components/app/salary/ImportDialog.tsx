import { useEffect, useMemo, useState } from "react";
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
  importStaffDetails,
  recomputeSheetFromShifts,
} from "@/lib/actions/salary";
import { parseStaffDetails, type StaffDetailsParse } from "@/lib/payroll/detailsImport";
import { STAFF_FIELD_LABEL } from "@/lib/payroll/staffFields";
import {
  parseMasterSheet,
  parseShiftWorkbook,
  parseTable,
  readFileToSheets,
  toNumber,
  toText,
  type MasterParse,
  type SheetMatrix,
  type TableParse,
} from "@/lib/payroll/excel";
import { computeEntry, formatMonthLabel } from "@/lib/payroll/calc";
import { detectFileKind, guessShiftCompany, type FileKind } from "@/lib/payroll/detect";
import { errorMessage, useRefreshSalary, useShiftCompanies } from "@/lib/payroll/queries";
import { ShiftCompaniesDialog } from "@/components/app/salary/ShiftCompaniesDialog";
import { usePermissions } from "@/lib/ledger/permissions";
import { formatMoney } from "@/lib/ledger/calc";
import type { PayrollCompany, ShiftSource, StaffDetailsImportRow } from "@/lib/payroll/types";

type TabKind = Exclude<FileKind, "unknown">;
const TAB_NAME: Record<TabKind, string> = {
  shifts: "Shift export",
  master: "Excel salary sheet",
  details: "Employee details",
};
/** Passed to every file tab: lets it hand a file to the tab it really belongs to. */
interface TabProps {
  /** A file moved here from the wrong tab; read it as soon as the tab opens. */
  initialFile?: File | null;
  onWrongTab: (kind: TabKind, file: File) => void;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  periodId: string;
  month: string;
  companies: PayrollCompany[];
}

export function ImportDialog({ open, onOpenChange, periodId, month, companies }: Props) {
  const [tab, setTab] = useState("shifts");
  // A file dropped into the wrong tab is moved to the right one, not rejected.
  const [handoff, setHandoff] = useState<{ tab: TabKind; file: File } | null>(null);
  const onWrongTab = (kind: TabKind, file: File) => {
    toast.info(`That file is a ${TAB_NAME[kind]} file. Moved it to the ${TAB_NAME[kind]} tab.`);
    setHandoff({ tab: kind, file });
    setTab(kind);
  };
  const initialFor = (k: TabKind) => (handoff?.tab === k ? handoff.file : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import into {formatMonthLabel(month)}</DialogTitle>
          <DialogDescription>
            Files are read in your browser — nothing is saved until you press Import.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setHandoff(null);
            setTab(v);
          }}
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="shifts">Shift export</TabsTrigger>
            <TabsTrigger value="payroll">Payroll file</TabsTrigger>
            <TabsTrigger value="master">Excel salary sheet</TabsTrigger>
            <TabsTrigger value="details">Employee details</TabsTrigger>
          </TabsList>
          <TabsContent value="shifts" className="pt-3">
            <ShiftImport
              periodId={periodId}
              month={month}
              initialFile={initialFor("shifts")}
              onWrongTab={onWrongTab}
            />
          </TabsContent>
          <TabsContent value="payroll" className="pt-3">
            <PayrollImport periodId={periodId} companies={companies} />
          </TabsContent>
          <TabsContent value="master" className="pt-3">
            <MasterImport periodId={periodId} initialFile={initialFor("master")} onWrongTab={onWrongTab} />
          </TabsContent>
          <TabsContent value="details" className="pt-3">
            <DetailsImport initialFile={initialFor("details")} onWrongTab={onWrongTab} />
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

function ShiftImport({
  periodId,
  month,
  initialFile,
  onWrongTab,
}: { periodId: string; month: string } & TabProps) {
  const refresh = useRefreshSalary();
  const { can } = usePermissions();
  const canCreateStaff = can("staff", "create");
  const [source, setSource] = useState<ShiftSource>("RSS");
  const { data: allCompanies = [] } = useShiftCompanies(true);
  // Only switched-on companies can be imported. RSS / ESS stay available even
  // if the list can't be loaded.
  const options = useMemo(() => {
    const on = allCompanies.filter((c) => c.active);
    return on.length > 0
      ? on
      : [
          { code: "RSS", name: "RSS" },
          { code: "ESS", name: "ESS" },
        ];
  }, [allCompanies]);
  const [addOpen, setAddOpen] = useState(false);
  const [guessed, setGuessed] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  // The file is read once; what it contains for RSS vs ESS is worked out from
  // the chosen company, so switching "Which company?" re-reads the right tab.
  const [sheets, setSheets] = useState<SheetMatrix[] | null>(null);
  const parse = useMemo(
    () => (sheets ? parseShiftWorkbook(sheets, source) : null),
    [sheets, source],
  );
  const [createMissing, setCreateMissing] = useState(canCreateStaff);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setResult(null);
    setSheets(null);
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const read = await readFileToSheets(file);
      const kind = detectFileKind(read.sheets);
      if (kind !== "unknown" && kind !== "shifts") {
        onWrongTab(kind, file);
        return;
      }
      const g = guessShiftCompany(file.name, read.sheets, options);
      setGuessed(g);
      if (g) setSource(g);
      setSheets(read.sheets);
    } catch (err) {
      toast.error(errorMessage(err, "Could not read that file."));
    } finally {
      setBusy(false);
    }
  }

  // A file moved here from another tab is read as soon as this tab opens.
  useEffect(() => {
    if (initialFile) void onFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noRate = useMemo(() => {
    if (!parse) return { shifts: 0, hours: 0 };
    const bad = parse.rows.filter((r) => r.hours > 0 && r.amount === 0);
    return { shifts: bad.length, hours: Math.round(bad.reduce((t, r) => t + r.hours, 0) * 100) / 100 };
  }, [parse]);

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
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <Field label="Which company?">
          <Select
            value={source}
            onValueChange={(v) => {
              setSource(v);
              setGuessed(null);
              setResult(null);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name && c.name !== c.code ? `${c.code} · ${c.name}` : c.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            className="mt-1 text-[11px] font-medium text-primary hover:underline"
            onClick={() => setAddOpen(true)}
          >
            + Add new company
          </button>
        </Field>
        <Field label="Shift export (.xlsx / .csv)">
          <Input type="file" accept={FILE_ACCEPT} onChange={(e) => onFile(e.target.files?.[0])} />
        </Field>
      </div>

      <ShiftCompaniesDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(code) => {
          setSource(code);
          setGuessed(null);
        }}
      />

      {parse ? (
        <div className="space-y-2">
          {guessed ? (
            <Notice tone="info">
              Company set to <strong className="text-foreground">{guessed}</strong> from the file
              name. Change it above if that's wrong.
            </Notice>
          ) : null}
          {parse.rows.length > 0 && parse.layout === "tabs" ? (
            <Notice tone="info">
              Read from the <strong className="text-foreground">{parse.sheetName}</strong> tab
              (RSS / ESS company sheet layout). Its ID column is treated as the{" "}
              <strong className="text-foreground">{source} ID</strong>, and hours are the Clock
              In/Clock Out hours. Shifts are added to <strong className="text-foreground">{source}</strong>{" "}
              for each person.
            </Notice>
          ) : null}
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
          {noRate.shifts > 0 ? (
            <Notice tone="warn">
              {noRate.shifts} shifts ({noRate.hours} hours) have no pay rate, so they will pay £0.
              Ask for the rate to be filled in the file, then import again.
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
        People are matched on their {source} ID, then NI number, then a unique name (a name match is
        ignored if the two NI numbers differ). Importing {source} again for the same month{" "}
        <strong>replaces</strong> the earlier {source} shifts.
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

function MasterImport({ periodId, initialFile, onWrongTab }: { periodId: string } & TabProps) {
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
      const kind = detectFileKind(sheets);
      if (kind !== "unknown" && kind !== "master") {
        onWrongTab(kind, file);
        return;
      }
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

  useEffect(() => {
    if (initialFile) void onFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          extra: {},
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

/* ------------------------- 4) employee details ------------------------- */

const DETAILS_CHUNK = 200;

/**
 * Reads a file in the All Payroll Format layout and FILLS empty staff fields.
 * It never overwrites a value, never creates staff, and shows a preview
 * (matched / not matched / fields that would be filled) before anything is saved.
 */
function DetailsImport({ initialFile, onWrongTab }: TabProps) {
  const refresh = useRefreshSalary();
  const { can } = usePermissions();
  const canEditStaff = can("staff", "edit");
  const [fileName, setFileName] = useState("");
  const [parse, setParse] = useState<StaffDetailsParse | null>(null);
  const [preview, setPreview] = useState<StaffDetailsImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<string | null>(null);

  /** Sends the rows in chunks; apply=false only reads (the preview). */
  async function send(rows: StaffDetailsParse["rows"], apply: boolean) {
    const all: StaffDetailsImportRow[] = [];
    for (let i = 0; i < rows.length; i += DETAILS_CHUNK) {
      setProgress(
        `${apply ? "Saving" : "Checking"} ${Math.min(i + DETAILS_CHUNK, rows.length)} / ${rows.length}…`,
      );
      const r = await importStaffDetails({
        data: { rows: rows.slice(i, i + DETAILS_CHUNK), apply },
      });
      all.push(...r.rows);
    }
    return all;
  }

  useEffect(() => {
    if (initialFile) void onFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFile(file: File | undefined) {
    setResult(null);
    setParse(null);
    setPreview(null);
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const { sheets } = await readFileToSheets(file);
      const kind = detectFileKind(sheets);
      if (kind !== "unknown" && kind !== "details") {
        onWrongTab(kind, file);
        return;
      }
      const parsed =
        sheets
          .map((sh) => parseStaffDetails(sh.matrix))
          .find((p) => p.found && p.rows.length > 0) ??
        sheets.map((sh) => parseStaffDetails(sh.matrix)).find((p) => p.found) ??
        null;
      if (!parsed) {
        toast.error("Couldn't find the All Payroll Format header (Employee Name, NI Number…).");
        return;
      }
      setParse(parsed);
      if (parsed.rows.length > 0) setPreview(await send(parsed.rows, false));
    } catch (err) {
      toast.error(errorMessage(err, "Could not read that file."));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function save() {
    if (!parse || parse.rows.length === 0) return;
    setBusy(true);
    try {
      const done = await send(parse.rows, true);
      const staff = done.filter((r) => r.fills.length > 0).length;
      const fields = done.reduce((n, r) => n + r.fills.length, 0);
      await refresh();
      setPreview(null);
      setParse(null);
      setResult(`Filled ${fields} empty fields on ${staff} staff. Nothing was overwritten.`);
      toast.success("Employee details saved.");
    } catch (err) {
      toast.error(errorMessage(err, "Import failed."));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const matched = preview?.filter((r) => r.status === "matched") ?? [];
  const willFill = matched.filter((r) => r.fills.length > 0);
  const nothingNew = matched.length - willFill.length;
  const notFound = preview?.filter((r) => r.status === "notFound") ?? [];
  const ambiguous = preview?.filter((r) => r.status === "ambiguous") ?? [];
  const conflict = preview?.filter((r) => r.status === "niConflict") ?? [];
  const totalFields = willFill.reduce((n, r) => n + r.fills.length, 0);
  const invalid = parse ? Object.entries(parse.invalid) : [];

  return (
    <div className="space-y-3">
      {!canEditStaff ? (
        <Notice tone="warn">This import needs the Staff › Edit permission.</Notice>
      ) : null}
      <Field label="Payroll report file (All Payroll Format, .xlsx / .csv)">
        <Input
          type="file"
          accept={FILE_ACCEPT}
          disabled={!canEditStaff || busy}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </Field>
      <p className="text-[11px] text-muted-foreground">
        People are matched on their NI number, then a unique name (a name match is ignored if the
        two NI numbers differ). Only fields that are <strong>empty</strong> on the staff record are
        filled — nothing is overwritten and no new staff are created. Template placeholder rows are
        skipped.
      </p>

      {parse ? (
        <div className="space-y-2">
          <Notice tone="info">
            <strong className="text-foreground">{fileName}</strong>: {parse.rows.length} people read
            {parse.skippedRows > 0 ? `, ${parse.skippedRows} placeholder / empty rows skipped` : ""}
            .
          </Notice>
          {invalid.length > 0 ? (
            <Notice tone="warn">
              Some values couldn't be read and will be ignored:{" "}
              {invalid
                .map(
                  ([k, n]) =>
                    `${STAFF_FIELD_LABEL[k as keyof typeof STAFF_FIELD_LABEL] ?? k} (${n})`,
                )
                .join(", ")}
              .
            </Notice>
          ) : null}
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <Notice tone={willFill.length ? "ok" : "info"}>
              <strong className="text-foreground">{willFill.length}</strong> staff will get{" "}
              <strong className="text-foreground">{totalFields}</strong> fields filled
            </Notice>
            <Notice tone="info">
              <strong className="text-foreground">{nothingNew}</strong> matched, nothing new to fill
            </Notice>
            <Notice tone={notFound.length + ambiguous.length + conflict.length ? "warn" : "info"}>
              <strong className="text-foreground">
                {notFound.length + ambiguous.length + conflict.length}
              </strong>{" "}
              not matched
            </Notice>
          </div>

          {willFill.length > 0 ? (
            <div className="max-h-56 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-surface-muted text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-semibold">Person</th>
                    <th className="px-2 py-1.5 font-semibold">Fields that will be filled</th>
                  </tr>
                </thead>
                <tbody>
                  {willFill.map((r, i) => (
                    <tr key={`${r.name}-${i}`} className="border-t border-border align-top">
                      <td className="px-2 py-1.5 font-medium">{r.name}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {r.fills.map((f) => STAFF_FIELD_LABEL[f]).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {notFound.length > 0 ? (
            <Notice tone="warn">
              No staff record found for:{" "}
              {notFound
                .slice(0, 15)
                .map((r) => r.name)
                .join(", ")}
              {notFound.length > 15 ? ` and ${notFound.length - 15} more` : ""}. (Add them on the
              Staff page first — this import never creates staff.)
            </Notice>
          ) : null}
          {ambiguous.length > 0 ? (
            <Notice tone="warn">
              Name matches more than one staff record, so skipped:{" "}
              {ambiguous
                .slice(0, 15)
                .map((r) => r.name)
                .join(", ")}
              {ambiguous.length > 15 ? ` and ${ambiguous.length - 15} more` : ""}. Put their NI
              number in the file to match them.
            </Notice>
          ) : null}
          {conflict.length > 0 ? (
            <Notice tone="warn">
              Same name but a different NI number than on the staff record, so skipped:{" "}
              {conflict
                .slice(0, 15)
                .map((r) => r.name)
                .join(", ")}
              {conflict.length > 15 ? ` and ${conflict.length - 15} more` : ""}.
            </Notice>
          ) : null}
        </div>
      ) : null}

      {result ? <Notice tone="ok">{result}</Notice> : null}
      <div className="flex items-center justify-end gap-3">
        {progress ? <span className="text-[12px] text-muted-foreground">{progress}</span> : null}
        <Button onClick={save} disabled={busy || !canEditStaff || !preview || totalFields === 0}>
          {busy ? "Working…" : "Fill empty fields"}
        </Button>
      </div>
    </div>
  );
}
