/**
 * Tasks: types and small helpers for the screens. The real data comes from
 * src/lib/actions/tasks.ts.
 */
import type { TaskStatus } from "./rules";

export type { TaskStatus };

export interface TaskEvent {
  id: string;
  at: string;
  by: string;
  text: string;
}

export interface Task {
  id: string;
  /** Free text typed by whoever creates the task. No fixed list. */
  text: string;
  notes: string;
  assignee: string;
  /** null when that user account was deleted. */
  assigneeId: string | null;
  createdBy: string;
  /** The day the task is for (yyyy-mm-dd). Can be today, yesterday or any day. */
  date: string;
  status: TaskStatus;
  events: TaskEvent[];
}

export const STATUS_META: Record<TaskStatus, { label: string; tone: "good" | "warn" | "mute" }> = {
  todo: { label: "To do", tone: "mute" },
  in_progress: { label: "In progress", tone: "warn" },
  completed: { label: "Done, waiting for check", tone: "warn" },
  verified: { label: "Verified", tone: "good" },
};

export function dayIso(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function dayLabel(iso: string): string {
  if (iso === dayIso(0)) return "Today";
  if (iso === dayIso(-1)) return "Yesterday";
  if (iso === dayIso(1)) return "Tomorrow";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const isOverdue = (t: Task) =>
  (t.status === "todo" || t.status === "in_progress") && t.date < dayIso(0);
