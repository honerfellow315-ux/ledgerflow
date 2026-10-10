import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/app/timesheets/badges";
import { formatDate, formatMoney } from "@/lib/ledger/calc";
import {
  METHODS,
  clientTotals,
  dayIso,
  daysOverdue,
  type OverdueClient,
} from "@/lib/followUps/data";

export interface FollowUpInput {
  method: string;
  note: string;
  promisedDate: string | null;
  nextFollowUp: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export const ageTone = (days: number): "warn" | "bad" => (days > 60 ? "bad" : "warn");

/* ------------------------------------------------------------- log */

function LogForm({
  client,
  onCancel,
  onSave,
}: {
  client: OverdueClient;
  onCancel: () => void;
  onSave: (input: FollowUpInput) => void;
}) {
  const [method, setMethod] = useState(METHODS[0]!);
  const [note, setNote] = useState("");
  const [promised, setPromised] = useState("");
  const [next, setNext] = useState(dayIso(3));
  return (
    <>
      <DialogHeader>
        <DialogTitle>Log a follow-up</DialogTitle>
        <DialogDescription>
          {client.client}, {formatMoney(clientTotals(client).overdue)} overdue. Write what happened in your own words.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>How did you chase?</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fu-note">What happened?</Label>
          <Textarea
            id="fu-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For example: Spoke to accounts, they will pay on Friday"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fu-promised">Promised to pay on (optional)</Label>
            <Input id="fu-promised" type="date" value={promised} onChange={(e) => setPromised(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fu-next">Follow up again on</Label>
            <Input id="fu-next" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={note.trim().length === 0}
          onClick={() =>
            onSave({ method, note: note.trim(), promisedDate: promised || null, nextFollowUp: next || null })
          }
        >
          Save follow-up
        </Button>
      </DialogFooter>
    </>
  );
}

export function LogFollowUpDialog({
  client,
  onClose,
  onSave,
}: {
  client: OverdueClient | null;
  onClose: () => void;
  onSave: (id: string, input: FollowUpInput) => void;
}) {
  return (
    <Dialog open={client !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        {client ? <LogForm key={client.id} client={client} onCancel={onClose} onSave={(i) => onSave(client.id, i)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------- details */

export function ClientDetailDialog({
  client,
  onClose,
  onLog,
}: {
  client: OverdueClient | null;
  onClose: () => void;
  onLog: (c: OverdueClient) => void;
}) {
  return (
    <Dialog open={client !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {client ? (
          <>
            <DialogHeader>
              <DialogTitle>{client.client}</DialogTitle>
              <DialogDescription>
                {formatMoney(clientTotals(client).overdue)} overdue across {client.invoices.length}{" "}
                {client.invoices.length === 1 ? "invoice" : "invoices"}.
              </DialogDescription>
            </DialogHeader>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/50 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Invoice</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 font-medium">Late by</th>
                    <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {client.invoices.map((i) => (
                    <tr key={i.number} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium">{i.number}</td>
                      <td className="px-3 py-2">{formatDate(i.dueDate)}</td>
                      <td className="px-3 py-2">
                        <Pill tone={ageTone(daysOverdue(i))}>{daysOverdue(i)} days</Pill>
                      </td>
                      <td className="num px-3 py-2 text-right">{formatMoney(i.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Contact history
                </h3>
                <Button size="sm" onClick={() => onLog(client)}>
                  Log follow-up
                </Button>
              </div>
              {client.contacts.length === 0 ? (
                <p className="rounded-md border border-border bg-surface-muted/50 px-3 py-2.5 text-[13px] text-muted-foreground">
                  This client has never been chased.
                </p>
              ) : (
                <ol className="space-y-2.5 border-l border-border pl-4">
                  {[...client.contacts]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((c) => (
                      <li key={c.id} className="text-[13px]">
                        <span className="font-medium text-foreground">{c.method}</span>{" "}
                        <span className="text-muted-foreground">by {c.by}</span>
                        <p className="mt-0.5 text-foreground">{c.note}</p>
                        <div className="num text-xs text-muted-foreground">{when(c.at)}</div>
                      </li>
                    ))}
                </ol>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
