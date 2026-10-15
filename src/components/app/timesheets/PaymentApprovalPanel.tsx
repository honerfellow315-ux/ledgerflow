import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getTimesheetPayment, saveTimesheetPayment } from "@/lib/actions/timesheets";
import { unwrap } from "@/lib/unwrap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const gbp = (n: number | null | undefined) => n == null ? "Not available" : new Intl.NumberFormat("en-GB", {style:"currency",currency:"GBP"}).format(n);
export function PaymentApprovalPanel({sheetId, month, canApprove}:{sheetId:string;month:string;canApprove:boolean}) {
  const qc=useQueryClient();
  const q=useQuery({queryKey:["timesheet-payment",sheetId],queryFn:()=>unwrap(getTimesheetPayment({data:{id:sheetId}}))});
  const [mode,setMode]=useState<"full"|"deduct"|"custom">("full");
  const [custom,setCustom]=useState("");
  const [note,setNote]=useState("");
  const [saving,setSaving]=useState(false);
  const d=q.data;
  const salary=d?.salaryAmount ?? 0;
  const due=Math.max(0,d?.outstanding ?? 0);
  const short=Math.max(0,(d?.recordedHours ?? 0)-(d?.sheetHours ?? 0));
  const deduction=(d?.salaryHours ?? 0)>0?Math.min(due,short*salary/(d?.salaryHours ?? 1)):0;
  const proposed=mode==="full"?due:mode==="deduct"?Math.max(0,due-deduction):Number(custom);
  return <section className="rounded-xl border border-border bg-surface p-4 space-y-4">
    <div><h2 className="font-semibold text-lg">Salary payment review</h2><p className="text-sm text-muted-foreground">{month} · Salary Sheet is the source of truth. Approval does not mark payment as paid.</p></div>
    {q.isError?<p className="text-sm text-destructive">Payment information unavailable. Check salary access and the payment migration.</p>:q.isLoading?<p>Loading salary details…</p>:<>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <div><p className="text-muted-foreground">Salary Sheet total</p><strong>{gbp(d?.salaryAmount)}</strong></div>
        <div><p className="text-muted-foreground">Outstanding balance</p><strong>{gbp(d?.outstanding)}</strong></div>
        <div><p className="text-muted-foreground">Hours difference (recorded minus sheet)</p><strong>{short.toFixed(2)} h short</strong></div>
        <div><p className="text-muted-foreground">Suggested hours deduction</p><strong>{gbp(deduction)}</strong></div>
      </div>
      {d?.decision?<div className="rounded-lg border border-primary/30 p-3 text-sm"><strong>Approved payment: {gbp(Number(d.decision.final_amount))}</strong><p>Decision: {String(d.decision.mode)} · {String(d.decision.note)}</p><p className="text-muted-foreground">Approved, not paid. Edit the decision below while the month is open.</p></div>:null}
      {canApprove && !d?.salaryClosed && d?.salaryAmount!=null?<div className="space-y-3">
        <label className="block text-sm font-medium" htmlFor="payment-mode">Accept with note · Payment decision</label>
        <select id="payment-mode" className="w-full rounded-md border border-border bg-background p-2" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}>
          <option value="full">Pay full outstanding salary</option><option value="deduct">Deduct short hours (estimated proportional amount)</option><option value="custom">Custom approved amount</option>
        </select>
        {mode==="custom"?<Input aria-label="Custom amount in GBP" type="number" min="0" max={due} step="0.01" value={custom} onChange={e=>setCustom(e.target.value)} placeholder="Final amount in GBP"/>:null}
        <p className="text-sm">Proposed approval: <strong>{Number.isFinite(proposed)?gbp(proposed):"Enter a valid amount"}</strong></p>
        <Input aria-label="Reason for payment decision" value={note} onChange={e=>setNote(e.target.value)} placeholder="Required reason for approval or deduction" maxLength={500}/>
        <Button disabled={saving||note.trim().length<3||!Number.isFinite(proposed)||proposed<0||proposed>due} onClick={async()=>{setSaving(true);try{await unwrap(saveTimesheetPayment({data:{id:sheetId,mode,adjustment:mode==="custom"?Number(custom):0,note:note.trim()}}));await qc.invalidateQueries({queryKey:["timesheet-payment",sheetId]});toast.success("Payment approval saved (not marked paid).");}catch(e){toast.error(e instanceof Error?e.message:"Could not save payment approval.");}finally{setSaving(false);}}}>Save payment approval</Button>
      </div>:<p className="text-sm text-muted-foreground">Payment decisions require approval permission, an open month and a matching Salary Sheet entry.</p>}
    </>}
  </section>;
}
