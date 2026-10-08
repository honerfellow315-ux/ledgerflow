import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList, Clock, Info, Plus, Search } from "@/lib/icons";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/app/timesheets/badges";
import {
  NewTaskDialog,
  TaskActions,
  TaskDetailDialog,
  TaskStatusBadge,
  type NewTaskInput,
} from "@/components/app/tasks/TaskDialogs";
import {
  ADMIN,
  MEMBER,
  PEOPLE,
  buildMockTasks,
  dayIso,
  dayLabel,
  isOverdue,
  type Task,
  type TaskStatus,
} from "@/lib/tasks/data";

export const Route = createFileRoute("/tasks/")({
  head: () => ({
    meta: [
      { title: "Tasks — LedgerFlow" },
      { name: "description", content: "Give out tasks, tick them off and check the finished ones." },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  // Admin-only while this is a preview, same pattern as Timesheet Check.
  return (
    <RequireView module="dashboard">
      <TasksContent />
    </RequireView>
  );
}

const ALL = "all";

function TasksContent() {
  const { isAdmin, ready } = usePermissions();
  const [tasks, setTasks] = useState<Task[]>(() => buildMockTasks());
  const [adminView, setAdminView] = useState(true);
  const [q, setQ] = useState("");
  const [who, setWho] = useState(ALL);
  const [when, setWhen] = useState(ALL);
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const actor = adminView ? ADMIN : MEMBER;

  const mine = useMemo(
    () => (adminView ? tasks : tasks.filter((t) => t.assignee === MEMBER)),
    [tasks, adminView],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const today = dayIso(0);
    return mine
      .filter((t) => (status ? t.status === status : true))
      .filter((t) => (who === ALL ? true : t.assignee === who))
      .filter((t) => {
        if (when === "today") return t.date === today;
        if (when === "yesterday") return t.date === dayIso(-1);
        if (when === "earlier") return t.date < dayIso(-1);
        if (when === "later") return t.date > today;
        return true;
      })
      .filter((t) => (needle ? t.text.toLowerCase().includes(needle) : true))
      .sort((a, b) => {
        const av = a.status === "verified" ? 1 : 0;
        const bv = b.status === "verified" ? 1 : 0;
        return av - bv || a.date.localeCompare(b.date);
      });
  }, [mine, status, who, when, q]);

  if (!ready) return null;
  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Only administrators can open Tasks for now."
        />
      </Panel>
    );
  }

  const move = (id: string, to: TaskStatus, text: string) =>
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status: to,
              events: [...t.events, { id: `n${Date.now()}`, at: new Date().toISOString(), by: actor, text }],
            }
          : t,
      ),
    );

  const create = (input: NewTaskInput) => {
    const now = new Date().toISOString();
    const events = [{ id: `c${Date.now()}`, at: now, by: actor, text: "Created the task" }];
    if (input.alreadyDone)
      events.push({ id: `d${Date.now()}`, at: now, by: actor, text: "Marked the task as done" });
    setTasks((prev) => [
      {
        id: `t${Date.now()}`,
        text: input.text,
        notes: input.notes,
        assignee: adminView ? input.assignee : actor,
        createdBy: actor,
        date: input.date,
        status: input.alreadyDone ? "completed" : "todo",
        events,
      },
      ...prev,
    ]);
    setNewOpen(false);
    toast.success("Task added. This is a preview, so it is not saved.");
  };

  const count = (s: TaskStatus) => mine.filter((t) => t.status === s).length;
  const openTask = tasks.find((t) => t.id === openId) ?? null;
  const filtered = status !== null || who !== ALL || when !== ALL || q !== "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {adminView
              ? "Give tasks to your team, log your own, and check the ones that are finished."
              : "Your tasks. Start them, mark them done, and the admin will check them."}
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="size-4" /> New task
        </Button>
      </div>

      <div
        role="note"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-[13px] text-foreground"
      >
        <span className="flex items-start gap-2.5">
          <Info className="mt-0.5 size-4 text-primary" aria-hidden="true" />
          Preview with sample people. Nothing here is saved yet.
        </span>
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">See it as</span>
          <Button size="sm" variant={adminView ? "default" : "outline"} onClick={() => setAdminView(true)}>
            Admin
          </Button>
          <Button size="sm" variant={adminView ? "outline" : "default"} onClick={() => setAdminView(false)}>
            Team member
          </Button>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="To do"
          value={String(count("todo"))}
          sublabel="Not started"
          icon={ClipboardList}
          active={status === "todo"}
          onClick={() => setStatus(status === "todo" ? null : "todo")}
        />
        <SummaryCard
          label="In progress"
          value={String(count("in_progress"))}
          sublabel="Being worked on"
          icon={Clock}
          active={status === "in_progress"}
          onClick={() => setStatus(status === "in_progress" ? null : "in_progress")}
        />
        <SummaryCard
          label="Waiting for check"
          value={String(count("completed"))}
          sublabel="Done, not yet verified"
          icon={CheckCircle2}
          tone={count("completed") ? "warning" : "default"}
          active={status === "completed"}
          onClick={() => setStatus(status === "completed" ? null : "completed")}
        />
        <SummaryCard
          label="Verified"
          value={String(count("verified"))}
          sublabel="Checked and correct"
          icon={CheckCircle2}
          tone="success"
          active={status === "verified"}
          onClick={() => setStatus(status === "verified" ? null : "verified")}
        />
      </div>

      <Panel>
        <PanelHeader
          title="All tasks"
          description={`${rows.length} of ${mine.length} shown`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search tasks"
                  className="h-9 w-44 pl-8"
                />
              </div>
              {adminView ? (
                <Select value={who} onValueChange={setWho}>
                  <SelectTrigger className="h-9 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Everyone</SelectItem>
                    {PEOPLE.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Select value={when} onValueChange={setWhen}>
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any day</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="earlier">Earlier</SelectItem>
                  <SelectItem value="later">Coming up</SelectItem>
                </SelectContent>
              </Select>
              {filtered ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQ("");
                    setWho(ALL);
                    setWhen(ALL);
                    setStatus(null);
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="No tasks here" description="Change the filters or add a new task." />
        ) : (
          <TableWrap>
            <Table className="min-w-[900px]">
              <THead>
                <TR>
                  <TH>Task</TH>
                  <TH>For</TH>
                  <TH>Day</TH>
                  <TH>Status</TH>
                  <TH>Created by</TH>
                  <TH align="right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((t) => (
                  <TR key={t.id} onClick={() => setOpenId(t.id)}>
                    <TD className="max-w-[360px]">
                      <span className="line-clamp-2 font-medium">{t.text}</span>
                    </TD>
                    <TD>{t.assignee}</TD>
                    <TD>
                      <span className="flex items-center gap-2">
                        {dayLabel(t.date)}
                        {isOverdue(t) ? <Pill tone="bad">Overdue</Pill> : null}
                      </span>
                    </TD>
                    <TD>
                      <TaskStatusBadge status={t.status} />
                    </TD>
                    <TD className="text-muted-foreground">{t.createdBy}</TD>
                    <TD align="right">
                      <div onClick={(e) => e.stopPropagation()}>
                        <TaskActions task={t} canVerify={adminView} onMove={move} />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      <NewTaskDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        actor={actor}
        canAssign={adminView}
        onCreate={create}
      />
      <TaskDetailDialog
        task={openTask}
        canVerify={adminView}
        onClose={() => setOpenId(null)}
        onMove={move}
      />
    </div>
  );
}