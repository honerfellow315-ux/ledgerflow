import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pill } from "@/components/app/timesheets/badges";
import { getClientFollowUp } from "@/lib/actions/followUps";
import { formatDate, formatMoney } from "@/lib/ledger/calc";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import { METHODS, ageTone, dayIso, type OverdueClient } from "@/lib/followUps/data";

export interface FollowUpInput {
  method: string;
  note: string;
  promisedDate: string | null;
  nextFollowUp: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/* ------------------------------------------------------------- log */

function LogForm({
  client,
  busy,
  onCancel,
  onSave,
}: {
  client: OverdueClient;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: FollowUpInput) => void;
}) {
  const [method, setMethod] = useState(METHODS[0]!);
  const [note, setNote] = useState("");
  const [promised, setPromised] = useState(client.promisedDate ?? "");
  const [next, setNext] = useState(dayIso(3));
  return (
    <>
      <DialogHeader>
        <DialogTitle>Log a follow-up</DialogTitle>
        <DialogDescription>
          {client.client}, {formatMoney(client.overdue)} overdue. Write what happened in your own
          words.
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
            <Label htmlFor="fu-promised">Promised to pay on (empty = no promise)</Label>
            <Input
              id="fu-promised"
              type="date"
              value={promised}
              onChange={(e) => setPromised(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fu-next">Follow up again on</Label>
            <Input
              id="fu-next"
              type="date"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={busy || note.trim().length === 0}
          onClick={() =>
            onSave({
              method,
              note: note.trim(),
              promisedDate: promised || null,
              nextFollowUp: next || null,
            })
          }
        >
          {busy ? "Saving…" : "Save follow-up"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function LogFollowUpDialog({
  client,
  busy,
  onClose,
  onSave,
}: {
  client: OverdueClient | null;
  busy: boolean;
  onClose: () => void;
  onSave: (id: string, input: FollowUpInput) => void;
}) {
  return (
    <Dialog open={client !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        {client ? (
          <LogForm
            key={client.id}
            client={client}
            busy={busy}
            onCancel={onClose}
            onSave={(i) => onSave(client.id, i)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------- details */

export function ClientDetailDialog({
  client,
  onClose,
  onLog,
  canLog,
}: {
  client: OverdueClient | null;
  onClose: () => void;
  onLog: (c: OverdueClient) => void;
  canLog: boolean;
}) {
  const detailQ = useQuery({
    queryKey: ["followUps", "detail", client?.id, client?.contactCount, client?.overdue],
    queryFn: () => unwrap(getClientFollowUp({ data: { clientId: client?.id ?? "" } })),
    enabled: client !== null,
  });
  const d = detailQ.data;
  return (
    <Dialog open={client !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {client ? (
          <>
            <DialogHeader>
              <DialogTitle>{client.client}</DialogTitle>
              <DialogDescription>
                {formatMoney(client.overdue)} overdue across {client.invoiceCount}{" "}
                {client.invoiceCount === 1 ? "invoice" : "invoices"}.
              </DialogDescription>
            </DialogHeader>

            {detailQ.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
            {detailQ.isError ? (
              <p className="text-sm text-destructive">
                {errorMessage(detailQ.error, "The details could not be loaded.")}
              </p>
            ) : null}

            {d ? (
              <>
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
                      {d.invoices.map((i) => (
                        <tr key={i.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 font-medium">{i.number}</td>
                          <td className="px-3 py-2">{formatDate(i.dueDate)}</td>
                          <td className="px-3 py-2">
                            <Pill tone={ageTone(i.daysLate)}>{i.daysLate} days</Pill>
                          </td>
                          <td className="num px-3 py-2 text-right">{formatMoney(i.outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Contact history
                    </h3>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/statements" search={{ client: client.id }}>
                          Open statement
                        </Link>
                      </Button>
                      {canLog ? (
                        <Button size="sm" onClick={() => onLog(client)}>
                          Log follow-up
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {d.contacts.length === 0 ? (
                    <p className="rounded-md border border-border bg-surface-muted/50 px-3 py-2.5 text-[13px] text-muted-foreground">
                      This client has never been chased.
                    </p>
                  ) : (
                    <ol className="space-y-2.5 border-l border-border pl-4">
                      {d.contacts.map((c) => (
                        <li key={c.id} className="text-[13px]">
                          <span className="font-medium text-foreground">{c.method}</span>{" "}
                          <span className="text-muted-foreground">by {c.by || "someone"}</span>
                          <p className="mt-0.5 whitespace-pre-wrap text-foreground">{c.note}</p>
                          <div className="num text-xs text-muted-foreground">{when(c.at)}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                  {d.contactCount > d.contacts.length ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Showing the latest {d.contacts.length} of {d.contactCount}.
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
