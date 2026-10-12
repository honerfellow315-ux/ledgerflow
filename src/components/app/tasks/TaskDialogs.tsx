import { useState } from "react";
import { Check } from "@/lib/icons";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pill } from "@/components/app/timesheets/badges";
import type { TaskPerson } from "@/lib/actions/tasks";
import {
  STATUS_META,
  dayIso,
  dayLabel,
  fmtWhen,
  isOverdue,
  type Task,
  type TaskStatus,
} from "@/lib/tasks/data";

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const m = STATUS_META[status];
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

export type Move = (id: string, to: TaskStatus, text: string) => void;

/** The buttons that fit the task's current status. */
export function TaskActions({
  task,
  canVerify,
  onMove,
  disabled = false,
}: {
  task: Task;
  canVerify: boolean;
  onMove: Move;
  disabled?: boolean;
}) {
  const go = (to: TaskStatus, text: string) => onMove(task.id, to, text);
  if (task.status === "todo")
    return (
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => go("in_progress", "Started the task")}
        >
          Start
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => go("completed", "Marked the task as done")}
        >
          Mark done
        </Button>
      </div>
    );
  if (task.status === "in_progress")
    return (
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => go("completed", "Marked the task as done")}
        >
          Mark done
        </Button>
      </div>
    );
  if (task.status === "completed")
    return canVerify ? (
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => go("in_progress", "Sent back for more work")}
        >
          Send back
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => go("verified", "Verified as correct")}>
          <Check className="size-3.5" /> Verify
        </Button>
      </div>
    ) : (
      <p className="text-right text-xs text-muted-foreground">Waiting for the admin to check</p>
    );
  return null;
}

/* ------------------------------------------------------------- details */

export function TaskDetailDialog({
  task,
  canVerify,
  onClose,
  onMove,
  onDelete,
  busy = false,
}: {
  task: Task | null;
  canVerify: boolean;
  onClose: () => void;
  onMove: Move;
  /** Admin only. */
  onDelete?: (task: Task) => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={Boolean(task)} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {task ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-base leading-snug">{task.text}</DialogTitle>
              <DialogDescription>
                For {task.assignee}, {dayLabel(task.date).toLowerCase()}. Created by{" "}
                {task.createdBy}.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={task.status} />
              {isOverdue(task) ? <Pill tone="bad">Overdue</Pill> : null}
            </div>
            {task.notes ? (
              <p className="rounded-md border border-border bg-surface-muted/50 px-3 py-2 text-[13px] text-foreground">
                {task.notes}
              </p>
            ) : null}
            <TaskActions task={task} canVerify={canVerify} onMove={onMove} disabled={busy} />
            {onDelete ? (
              <div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onDelete(task)}>
                  Delete this task
                </Button>
              </div>
            ) : null}
            <div>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                Activity
              </h3>
              <ol className="space-y-2.5 border-l border-border pl-4">
                {[...task.events].reverse().map((e) => (
                  <li key={e.id} className="text-[13px]">
                    <span className="font-medium text-foreground">{e.by}</span>{" "}
                    <span className="text-muted-foreground">{e.text.toLowerCase()}</span>
                    <div className="num text-xs text-muted-foreground">{fmtWhen(e.at)}</div>
                  </li>
                ))}
              </ol>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- new */

export interface NewTaskInput {
  text: string;
  notes: string;
  /** User id of the person the task is for (only used when an admin picks someone). */
  assigneeId: string;
  date: string;
  alreadyDone: boolean;
}

function NewTaskForm({
  meId,
  people,
  canAssign,
  busy,
  onCancel,
  onCreate,
}: {
  meId: string;
  people: TaskPerson[];
  canAssign: boolean;
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: NewTaskInput) => void;
}) {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState(meId);
  const [date, setDate] = useState(dayIso(0));
  const [alreadyDone, setAlreadyDone] = useState(false);

  return (
    <>
      <DialogHeader>
        <DialogTitle>New task</DialogTitle>
        <DialogDescription>
          Write the task in your own words. Pick any day, including yesterday for work already done.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="task-text">What needs to be done?</Label>
          <Textarea
            id="task-text"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="For example: Call the client about the unpaid September invoice"
          />
        </div>
        {canAssign ? (
          <div className="space-y-1.5">
            <Label>Assign to</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.id === meId ? `${p.name} (me)` : p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="task-date">Day</Label>
          <div className="flex flex-wrap items-center gap-2">
            {[-1, 0, 1].map((o) => (
              <Button
                key={o}
                type="button"
                size="sm"
                variant={date === dayIso(o) ? "default" : "outline"}
                onClick={() => setDate(dayIso(o))}
              >
                {dayLabel(dayIso(o))}
              </Button>
            ))}
            <Input
              id="task-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-40"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-notes">Notes (optional)</Label>
          <Input id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-foreground">
          <Checkbox checked={alreadyDone} onCheckedChange={(v) => setAlreadyDone(v === true)} />
          This is already done
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={busy || text.trim().length === 0 || !date}
          onClick={() =>
            onCreate({
              text: text.trim(),
              notes: notes.trim(),
              assigneeId: assignee,
              date,
              alreadyDone,
            })
          }
        >
          Add task
        </Button>
      </DialogFooter>
    </>
  );
}

export function NewTaskDialog({
  open,
  onOpenChange,
  meId,
  people,
  canAssign,
  busy = false,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meId: string;
  people: TaskPerson[];
  canAssign: boolean;
  busy?: boolean;
  onCreate: (input: NewTaskInput) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        {open ? (
          <NewTaskForm
            meId={meId}
            people={people}
            canAssign={canAssign}
            busy={busy}
            onCancel={() => onOpenChange(false)}
            onCreate={onCreate}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
