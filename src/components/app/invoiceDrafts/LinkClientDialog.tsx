import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { linkShiftClient, listMappableClients } from "@/lib/actions/invoiceDrafts";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import type { UnmatchedName } from "@/lib/invoiceDrafts/data";

/** Links a client name from the shift export to one of our clients (remembered for every month). */
export function LinkClientDialog({
  item,
  onClose,
  onLinked,
}: {
  item: UnmatchedName | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setClientId(""), [item?.name]);

  const clientsQ = useQuery({
    queryKey: ["invoiceDrafts", "clients"],
    queryFn: () => unwrap(listMappableClients()),
    enabled: item !== null,
  });

  async function save() {
    if (!item || !clientId || busy) return;
    setBusy(true);
    try {
      await unwrap(linkShiftClient({ data: { shiftName: item.name, clientId } }));
      toast.success("Linked. This name will now go to that client every month.");
      onLinked();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "The link could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link to a client</DialogTitle>
          <DialogDescription>
            {item
              ? `"${item.name}" appears on ${item.shifts} shifts (${Number(item.hours.toFixed(2))} h) but ${
                  item.reason === "several" ? "matches more than one client" : "matches no client"
                }. Choose which client it belongs to.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger>
            <SelectValue
              placeholder={clientsQ.isLoading ? "Loading clients…" : "Choose a client"}
            />
          </SelectTrigger>
          <SelectContent>
            {(clientsQ.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {clientsQ.isError ? (
          <p className="text-[13px] text-destructive">
            {errorMessage(clientsQ.error, "The clients could not be loaded.")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!clientId || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Link"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
