import { TaskWorkload } from "@/components/app/tasks/TaskWorkload";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Plus,
  Search,
} from "@/lib/icons";
import { RequireView } from "@/components/app/RequireView";
import { EmptyState, Panel, PanelHeader, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { SummaryCard } from "@/components/app/SummaryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pill } from "@/components/app/timesheets/badges";
import {
  NewTaskDialog,
  TaskActions,
  TaskDetailDialog,
  TaskStatusBadge,
  type NewTaskInput,
} from "@/components/app/tasks/TaskDialogs";
import { createTask, deleteTask, listTasks, moveTask } from "@/lib/actions/tasks";
import { errorMessage } from "@/lib/payroll/queries";
import { unwrap } from "@/lib/unwrap";
import { dayIso, dayLabel, isOverdue, type Task, type TaskStatus } from "@/lib/tasks/data";

export const Route = createFileRoute("/tasks/")({
  head: () => ({
    meta: [
      { title: "Tasks — LedgerFlow" },
      {
        name: "description",
        content: "Give out tasks, tick them off and check the finished ones.",
      },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  return (
    <RequireView module="tasks">
      <TasksContent />
    </RequireView>
  );
}

const ALL = "all";
const PAGE_SIZE = 50;

/** The day range the "Any day / Today / ..." filter means, worked out in the browser. */
function dayRange(when: string): { dateFrom: string | null; dateTo: string | null } {
  if (when === "today") return { dateFrom: dayIso(0), dateTo: dayIso(0) };
  if (when === "yesterday") return { dateFrom: dayIso(-1), dateTo: dayIso(-1) };
  if (when === "earlier") return { dateFrom: null, dateTo: dayIso(-2) };
  if (when === "later") return { dateFrom: dayIso(1), dateTo: null };
  return { dateFrom: null, dateTo: null };
}

function TasksContent() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [who, setWho] = useState(ALL);
  const [when, setWhen] = useState(ALL);
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<Task | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const range = dayRange(when);
  const filter = {
    search,
    status,
    assigneeId: who === ALL ? null : who,
    ...range,
  };
  const listQ = useQuery({
    queryKey: ["tasks", filter, page],
    queryFn: () => unwrap(listTasks({ data: { ...filter, page, pageSize: PAGE_SIZE } })),
    placeholderData: keepPreviousData,
  });
  const data = listQ.data;
  const rows = data?.tasks ?? [];
  const isAdmin = data?.isAdmin ?? false;
  const counts = data?.counts ?? { todo: 0, in_progress: 0, completed: 0, verified: 0 };
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allCount = counts.todo + counts.in_progress + counts.completed + counts.verified;

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err, fallback));
      await qc.invalidateQueries({ queryKey: ["tasks"] });
    } finally {
      setBusy(false);
    }
  }

  const move = (id: string, to: TaskStatus) =>
    void run(async () => {
      await unwrap(moveTask({ data: { id, to } }));
      await qc.invalidateQueries({ queryKey: ["tasks"] });
    }, "The task could not be changed.");

  const create = (input: NewTaskInput) =>
    void run(async () => {
      await unwrap(
        createTask({
          data: {
            text: input.text,
            notes: input.notes,
            assigneeId: isAdmin ? input.assigneeId : null,
            date: input.date,
            alreadyDone: input.alreadyDone,
          },
        }),
      );
      setNewOpen(false);
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task added.");
    }, "The task could not be added.");

  const remove = (t: Task) =>
    void run(async () => {
      await unwrap(deleteTask({ data: { id: t.id } }));
      setToDelete(null);
      setOpenId(null);
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task deleted.");
    }, "The task could not be deleted.");

  const openTask = rows.find((t) => t.id === openId) ?? null;
  const filtered = status !== null || who !== ALL || when !== ALL || q !== "";

  if (listQ.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (listQ.isError || !data) {
    return (
      <Panel>
        <EmptyState
          title="Tasks could not be loaded"
          description={errorMessage(listQ.error, "Please try again.")}
        />
      </Panel>
    );
  }
  const people = data.people;
  const me = data.me;

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="Task totals by user" />
        <div className="p-4">
          <TaskWorkload />
        </div>
      </Panel>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Give tasks to your team, log your own, and check the ones that are finished."
              : "Your tasks. Start them, mark them done, and the admin will check them."}
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="size-4" /> New task
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="To do"
          value={String(counts.todo)}
          sublabel="Not started"
          icon={ClipboardList}
          active={status === "todo"}
          onClick={() => {
            setStatus(status === "todo" ? null : "todo");
            setPage(1);
          }}
        />
        <SummaryCard
          label="In progress"
          value={String(counts.in_progress)}
          sublabel="Being worked on"
          icon={Clock}
          active={status === "in_progress"}
          onClick={() => {
            setStatus(status === "in_progress" ? null : "in_progress");
            setPage(1);
          }}
        />
        <SummaryCard
          label="Waiting for check"
          value={String(counts.completed)}
          sublabel="Done, not yet verified"
          icon={CheckCircle2}
          tone={counts.completed ? "warning" : "default"}
          active={status === "completed"}
          onClick={() => {
            setStatus(status === "completed" ? null : "completed");
            setPage(1);
          }}
        />
        <SummaryCard
          label="Verified"
          value={String(counts.verified)}
          sublabel="Checked and correct"
          icon={CheckCircle2}
          tone="success"
          active={status === "verified"}
          onClick={() => {
            setStatus(status === "verified" ? null : "verified");
            setPage(1);
          }}
        />
      </div>

      <Panel>
        <PanelHeader
          title="All tasks"
          description={`${total} of ${allCount} shown`}
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
              {isAdmin ? (
                <Select
                  value={who}
                  onValueChange={(v) => {
                    setWho(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-9 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Everyone</SelectItem>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Select
                value={when}
                onValueChange={(v) => {
                  setWhen(v);
                  setPage(1);
                }}
              >
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
                    setPage(1);
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
                  <TH>Completed by</TH>
                  <TH>Last action by</TH>
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
                    <TD>
                      {t.status === "completed" || t.status === "verified"
                        ? ([...t.events].reverse().find((e) => e.text === "Marked the task as done")
                            ?.by ?? "—")
                        : "—"}
                    </TD>
                    <TD className="text-muted-foreground">{t.events.at(-1)?.by ?? "—"}</TD>
                    <TD align="right">
                      <div onClick={(e) => e.stopPropagation()}>
                        <TaskActions task={t} canVerify={isAdmin} onMove={move} disabled={busy} />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
        {pages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
            <span>
              Page {page} of {pages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-4" /> Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <NewTaskDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        meId={me.id}
        people={people}
        canAssign={isAdmin}
        busy={busy}
        onCreate={create}
      />
      <TaskDetailDialog
        task={openTask}
        canVerify={isAdmin}
        busy={busy}
        onClose={() => setOpenId(null)}
        onMove={(id, to) => move(id, to)}
        {...(isAdmin ? { onDelete: (t: Task) => setToDelete(t) } : {})}
      />
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(o) => (o ? undefined : setToDelete(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              The task and its activity history are removed for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove(toDelete)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
