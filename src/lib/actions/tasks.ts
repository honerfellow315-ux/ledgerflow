/**
 * Task server functions.
 *  - Anyone with Tasks "view" sees ONLY the tasks that are for them; an admin sees all.
 *  - Anyone with Tasks "create" can add a task for themselves; only an admin can give a
 *    task to someone else, verify, send back or delete.
 * The rules for moving a task live in src/lib/tasks/rules.ts and are checked here.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { taskEvents, tasks, users } from "../../../drizzle/schema";
import { requirePermission } from "../server/auth";
import { recordActivity } from "../server/activity";
import { uid } from "../server/id";
import { findMove, isRealDay, type TaskStatus } from "../tasks/rules";
import type { Task } from "../tasks/data";

const statusEnum = z.enum(["todo", "in_progress", "completed", "verified"]);
const day = z.string().refine(isRealDay, "That is not a real date.");

const nameOf = (u: { displayName: string; username: string }) => u.displayName || u.username;
const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

export interface TaskPerson {
  id: string;
  name: string;
}

export interface TaskListResult {
  me: TaskPerson;
  isAdmin: boolean;
  /** Everyone a task can be given to (admin only, empty for other users). */
  people: TaskPerson[];
  tasks: Task[];
  /** Tasks matching the filters (for the pager). */
  total: number;
  /** Counts per status for everything this person may see, whatever the filters say. */
  counts: Record<TaskStatus, number>;
}

export const listTasks = createServerFn({ method: "GET" })
  .validator(
    z.object({
      search: z.string().trim().max(80).default(""),
      status: statusEnum.nullable().default(null),
      assigneeId: z.string().max(100).nullable().default(null),
      dateFrom: day.nullable().default(null),
      dateTo: day.nullable().default(null),
      page: z.number().int().min(1).max(10000).default(1),
      pageSize: z.number().int().min(5).max(100).default(50),
    }),
  )
  .handler(async ({ data }): Promise<TaskListResult> => {
    const user = await requirePermission("tasks", "view");
    const isAdmin = user.role === "admin";

    const scope: SQL[] = [];
    if (!isAdmin) scope.push(eq(tasks.assigneeId, user.id));

    const parts: SQL[] = [...scope];
    if (data.status) parts.push(eq(tasks.status, data.status));
    if (isAdmin && data.assigneeId) parts.push(eq(tasks.assigneeId, data.assigneeId));
    if (data.dateFrom) parts.push(gte(tasks.date, data.dateFrom));
    if (data.dateTo) parts.push(lte(tasks.date, data.dateTo));
    if (data.search) parts.push(ilike(tasks.text, likeOf(data.search)));
    const where = parts.length > 0 ? and(...parts) : undefined;

    const rows = await db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(
        sql`(${tasks.status} = 'verified') ASC`,
        asc(tasks.date),
        asc(tasks.createdAt),
        asc(tasks.id),
      )
      .limit(data.pageSize)
      .offset((data.page - 1) * data.pageSize);

    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(where);

    const grouped = await db
      .select({ status: tasks.status, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(scope.length > 0 ? and(...scope) : undefined)
      .groupBy(tasks.status);
    const counts: Record<TaskStatus, number> = {
      todo: 0,
      in_progress: 0,
      completed: 0,
      verified: 0,
    };
    for (const g of grouped) if (g.status in counts) counts[g.status as TaskStatus] = Number(g.n);

    const events =
      rows.length === 0
        ? []
        : await db
            .select()
            .from(taskEvents)
            .where(
              inArray(
                taskEvents.taskId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(asc(taskEvents.at), asc(taskEvents.id));
    const byTask = new Map<string, typeof events>();
    for (const e of events) {
      const list = byTask.get(e.taskId);
      if (list) list.push(e);
      else byTask.set(e.taskId, [e]);
    }

    const people: TaskPerson[] = isAdmin
      ? (
          await db
            .select({ id: users.id, displayName: users.displayName, username: users.username })
            .from(users)
            .orderBy(asc(users.username))
        ).map((u) => ({ id: u.id, name: nameOf(u) }))
      : [];

    return {
      me: { id: user.id, name: nameOf(user) },
      isAdmin,
      people,
      tasks: rows.map((r) => ({
        id: r.id,
        text: r.text,
        notes: r.notes,
        assignee: r.assigneeName,
        assigneeId: r.assigneeId,
        createdBy: r.createdByName,
        date: r.date,
        status: r.status as TaskStatus,
        events: (byTask.get(r.id) ?? []).map((e) => ({
          id: e.id,
          at: e.at.toISOString(),
          by: e.byName,
          text: e.text,
        })),
      })),
      total: count?.n ?? 0,
      counts,
    };
  });

export const createTask = createServerFn({ method: "POST" })
  .validator(
    z.object({
      text: z.string().trim().min(1).max(500),
      notes: z.string().trim().max(1000).default(""),
      /** Only an admin can name someone else; for everyone else it is ignored. */
      assigneeId: z.string().max(100).nullable().default(null),
      date: day,
      alreadyDone: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requirePermission("tasks", "create");
    const isAdmin = actor.role === "admin";

    let assignee: { id: string; name: string } = { id: actor.id, name: nameOf(actor) };
    if (isAdmin && data.assigneeId && data.assigneeId !== actor.id) {
      const [u] = await db
        .select({ id: users.id, displayName: users.displayName, username: users.username })
        .from(users)
        .where(eq(users.id, data.assigneeId))
        .limit(1);
      if (!u) throw new Error("That person no longer exists.");
      assignee = { id: u.id, name: nameOf(u) };
    }

    const id = uid("task");
    const by = nameOf(actor);
    await db.insert(tasks).values({
      id,
      text: data.text,
      notes: data.notes,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      createdById: actor.id,
      createdByName: by,
      date: data.date,
      status: data.alreadyDone ? "completed" : "todo",
    });
    const events = [{ id: uid("te"), taskId: id, byName: by, text: "Created the task" }];
    if (data.alreadyDone) {
      events.push({ id: uid("te"), taskId: id, byName: by, text: "Marked the task as done" });
    }
    await db.insert(taskEvents).values(events);

    await recordActivity({
      actor,
      action: "created",
      module: "tasks",
      entityId: id,
      label: `Task — ${data.text.slice(0, 80)}`,
      details: assignee.id === actor.id ? "For themselves" : `For ${assignee.name}`,
    });
    return { id };
  });

export const moveTask = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100), to: statusEnum }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("tasks", "view");
    const isAdmin = actor.role === "admin";

    const [task] = await db.select().from(tasks).where(eq(tasks.id, data.id)).limit(1);
    if (!task || (!isAdmin && task.assigneeId !== actor.id))
      throw new Error("That task was not found.");

    const current = task.status as TaskStatus;
    const move = findMove(current, data.to);
    if (!move)
      throw new Error("This task has already been changed by someone else. Refresh and try again.");
    if (move.adminOnly && !isAdmin) throw new Error("Only an admin can do that.");

    // The status is part of the WHERE, so two people clicking at once cannot both win.
    const changed = await db
      .update(tasks)
      .set({ status: move.to, updatedAt: new Date() })
      .where(and(eq(tasks.id, data.id), eq(tasks.status, current)))
      .returning({ id: tasks.id });
    if (changed.length === 0)
      throw new Error("This task has already been changed by someone else. Refresh and try again.");

    await db
      .insert(taskEvents)
      .values({ id: uid("te"), taskId: data.id, byName: nameOf(actor), text: move.text });
    await recordActivity({
      actor,
      action: "updated",
      module: "tasks",
      entityId: data.id,
      label: `Task — ${task.text.slice(0, 80)}`,
      details: move.text,
    });
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const actor = await requirePermission("tasks", "view");
    if (actor.role !== "admin") throw new Response("Forbidden", { status: 403 });
    const [task] = await db.select().from(tasks).where(eq(tasks.id, data.id)).limit(1);
    if (!task) return { ok: true };
    await db.delete(tasks).where(eq(tasks.id, data.id)); // events cascade
    await recordActivity({
      actor,
      action: "deleted",
      module: "tasks",
      entityId: data.id,
      label: `Task — ${task.text.slice(0, 80)}`,
    });
    return { ok: true };
  });

/** Counts come from all visible tasks, rather than just the current page. */
export const taskWorkload = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requirePermission("tasks", "view");
  return db
    .select({
      id: tasks.assigneeId,
      name: tasks.assigneeName,
      total: sql<number>`count(*)::int`,
      todo: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'todo')::int`,
      inProgress: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'in_progress')::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'completed')::int`,
      verified: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'verified')::int`,
    })
    .from(tasks)
    .where(actor.role === "admin" ? undefined : eq(tasks.assigneeId, actor.id))
    .groupBy(tasks.assigneeId, tasks.assigneeName)
    .orderBy(asc(tasks.assigneeName));
});
