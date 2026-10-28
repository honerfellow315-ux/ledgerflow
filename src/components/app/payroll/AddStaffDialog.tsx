import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, UserPlus, X } from "@/lib/icons";
import { addStaffToSheet } from "@/lib/actions/payroll";
import { errorMessage } from "@/lib/payroll/queries";
import { formatNi, normNi } from "@/lib/payroll/calc";
import {
  useAssignableStaff,
  useReferrerOptions,
  useRefreshPayroll,
} from "@/lib/payroll/sheetQueries";
import { StaffDialog } from "@/components/app/salary/StaffDialog";

/**
 * Adds a person to this company's sheet: pick an existing staff member (also works for
 * someone who is already in another payroll company — same record, same ID), or create
 * a brand-new one, who is attached straight away with the "New Staff" comment.
 * The list can be searched by name or NI number (NI only for users allowed to see staff
 * details), and an optional "Referred by" staff member can be recorded on the new line.
 */
export function AddStaffDialog({
  open,
  onOpenChange,
  sheetId,
  companyName,
  defaultRate,
  canCreateStaff,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sheetId: string;
  companyName: string;
  defaultRate: number;
  canCreateStaff: boolean;
}) {
  const refresh = useRefreshPayroll();
  const q = useAssignableStaff(sheetId, open);
  const refQ = useReferrerOptions(sheetId, open);
  const [search, setSearch] = useState("");
  // "Referred by" picker: free-text search + the chosen staff member (if any)
  const [refSearch, setRefSearch] = useState("");
  const [referrer, setReferrer] = useState<{ id: string; name: string } | null>(null);
  const [rate, setRate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  // Start clean every time the dialog is closed, so a referrer never carries over to the next person.
  useEffect(() => {
    if (!open) {
      setReferrer(null);
      setRefSearch("");
    }
  }, [open]);

  const rateNum = rate.trim() === "" ? undefined : Number(rate);
  const rateBad = rateNum !== undefined && (!Number.isFinite(rateNum) || rateNum < 0);

  // NI numbers are only sent by the server to users who may see staff details.
  const niSearchable = (q.data ?? []).some((s) => !!s.ni);

  /** True when the typed text matches the name, or (when present) the NI number ignoring spaces/case. */
  function matches(s: { name: string; ni?: string | undefined }, text: string): boolean {
    const needle = text.trim().toLowerCase();
    if (!needle) return true;
    if (s.name.toLowerCase().includes(needle)) return true;
    const niNeedle = normNi(text);
    return !!s.ni && niNeedle.length > 0 && normNi(s.ni).includes(niNeedle);
  }

  const list = useMemo(
    () => (q.data ?? []).filter((s) => matches(s, search)).slice(0, 200),
    [q.data, search],
  );

  const refMatches = useMemo(() => {
    if (!refSearch.trim()) return [];
    return (refQ.data ?? []).filter((s) => matches(s, refSearch)).slice(0, 6);
  }, [refQ.data, refSearch]);

  async function add(staffId: string, comment?: string) {
    if (rateBad) {
      toast.error("Enter a valid rate or leave it blank.");
      return;
    }
    setBusyId(staffId);
    try {
      await addStaffToSheet({
        data: {
          sheetId,
          staffId,
          ...(comment ? { comment } : {}),
          ...(rateNum !== undefined ? { rate: rateNum } : {}),
          ...(referrer ? { referredByStaffId: referrer.id } : {}),
        },
      });
      await refresh();
      toast.success("Added to the sheet.");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not add."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Dialog open={open && !showNew} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add staff to {companyName}</DialogTitle>
            <DialogDescription>
              Choose someone already on file — they can be in several payroll companies at once.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  autoFocus
                  className="pl-8"
                  placeholder={
                    niSearchable ? "Search by name or NI number" : "Search staff by name"
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Input
                inputMode="decimal"
                placeholder={`Rate (default ${defaultRate})`}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                aria-label="Hourly rate for this person (optional)"
              />
            </div>

            {/* Optional: who referred this person */}
            <div className="space-y-1.5">
              {referrer ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[13px]">
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground">Referred by: </span>
                    <span className="font-medium">{referrer.name}</span>
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remove referrer"
                    onClick={() => setReferrer(null)}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder={
                      niSearchable
                        ? "Referred by (optional) — search by name or NI number"
                        : "Referred by (optional) — search by name"
                    }
                    value={refSearch}
                    onChange={(e) => setRefSearch(e.target.value)}
                    aria-label="Staff member who referred this person (optional)"
                  />
                  {refSearch.trim() ? (
                    <div className="divide-y divide-border rounded-md border border-border">
                      {refMatches.length === 0 ? (
                        <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                          No one matches.
                        </p>
                      ) : (
                        refMatches.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-muted"
                            onClick={() => {
                              setReferrer({ id: s.id, name: s.name });
                              setRefSearch("");
                            }}
                          >
                            {s.name}
                            {s.ni ? (
                              <span className="ml-2 text-[11px] text-muted-foreground">
                                {formatNi(s.ni)}
                              </span>
                            ) : null}
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {q.isLoading ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : list.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {search ? "No one matches." : "Everyone is already on this sheet."}
                </p>
              ) : (
                list.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{s.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[
                          s.ni ? formatNi(s.ni) : "",
                          !s.active ? "Inactive" : "",
                          s.contractStatus === "P45" ? "P45" : "",
                          s.alsoIn.length ? `Also in ${s.alsoIn.join(", ")}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId !== null}
                      onClick={() => add(s.id)}
                    >
                      {busyId === s.id ? "Adding…" : "Add"}
                    </Button>
                  </div>
                ))
              )}
            </div>

            {canCreateStaff ? (
              <Button variant="secondary" className="w-full" onClick={() => setShowNew(true)}>
                <UserPlus className="size-4" /> New staff member…
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <StaffDialog
        open={showNew}
        onOpenChange={(v) => {
          setShowNew(v);
          if (!v) onOpenChange(false);
        }}
        staff={null}
        canEdit
        onSaved={async (saved, isNew) => {
          if (!saved || !isNew || saved instanceof Response) return;
          await addStaffToSheet({
            data: {
              sheetId,
              staffId: saved.id,
              comment: "New Staff",
              ...(rateNum !== undefined && !rateBad ? { rate: rateNum } : {}),
              ...(referrer ? { referredByStaffId: referrer.id } : {}),
            },
          });
          await refresh();
        }}
      />
    </>
  );
}
