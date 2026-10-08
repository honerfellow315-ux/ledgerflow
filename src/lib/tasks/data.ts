/**
 * Tasks — UI only (sample data, nothing is saved).
 * Phase B swaps buildMockTasks() for real data; the types and helpers stay.
 */
export type TaskStatus = "todo" | "in_progress" | "completed" | "verified";

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
  createdBy: string;
  /** The day the task is for (yyyy-mm-dd). Can be today, yesterday or any day. */
  date: string;
  status: TaskStatus;
  events: TaskEvent[];
}

export const ADMIN = "Admin";
export const MEMBER = "Bilal Ahmed";
export const PEOPLE = [ADMIN, "Ayesha Khan", MEMBER, "Sara Malik", "Omar Farooq"];

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
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const isOverdue = (t: Task) =>
  (t.status === "todo" || t.status === "in_progress") && t.date < dayIso(0);

let seq = 0;
const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
const ev = (by: string, text: string, hours: number): TaskEvent => ({
  id: `m${++seq}`,
  at: ago(hours),
  by,
  text,
});

function mk(
  id: string,
  text: string,
  assignee: string,
  createdBy: string,
  offset: number,
  status: TaskStatus,
  notes = "",
): Task {
  const events = [ev(createdBy, "Created the task", 60)];
  if (status !== "todo") events.push(ev(assignee, "Started the task", 40));
  if (status === "completed" || status === "verified") events.push(ev(assignee, "Marked the task as done", 20));
  if (status === "verified") events.push(ev(ADMIN, "Verified as correct", 5));
  return { id, text, notes, assignee, createdBy, date: dayIso(offset), status, events };
}

export function buildMockTasks(): Task[] {
  return [
    mk("t1", "Call Northgate Retail about the missing hours on the August invoice and write down what they say", MEMBER, ADMIN, 0, "in_progress", "Ask for the manager, not reception."),
    mk("t2", "Chase the three unpaid invoices for Marsh Lane and update the notes on each one", "Sara Malik", ADMIN, 0, "todo"),
    mk("t3", "Check the September payroll sheet and list everyone still showing on a P45", "Ayesha Khan", ADMIN, -1, "completed"),
    mk("t4", "Send the corrected statement to Docklands", "Omar Farooq", ADMIN, -2, "verified"),
    mk("t5", "Upload the signed contract for Riverside Offices", MEMBER, ADMIN, -3, "todo"),
    mk("t6", "Matched the bank balance with the ledger", ADMIN, ADMIN, -1, "completed", "Logged after the fact."),
    mk("t7", "Review the Timesheet Check results and download receipts for staff", ADMIN, ADMIN, 0, "todo"),
    mk("t8", "Fix the wrong rate on the Okafor invoice", "Sara Malik", ADMIN, 1, "todo"),
    mk("t9", "Reconcile the cash payments from last week", "Ayesha Khan", ADMIN, -1, "verified"),
  ];
}