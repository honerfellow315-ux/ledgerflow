/**
 * Who may move a task from one status to another. Used by the server (the real check)
 * and by the screen (to show the right buttons).
 *
 *   To do  -> In progress           the person the task is for, or an admin
 *   To do / In progress -> Done     the person the task is for, or an admin
 *   Done -> Verified                admin only
 *   Done -> In progress (send back) admin only
 */
export type TaskStatus = "todo" | "in_progress" | "completed" | "verified";

export interface TaskMove {
  from: readonly TaskStatus[];
  to: TaskStatus;
  text: string;
  adminOnly: boolean;
}

export const TASK_MOVES: readonly TaskMove[] = [
  { from: ["todo"], to: "in_progress", text: "Started the task", adminOnly: false },
  {
    from: ["todo", "in_progress"],
    to: "completed",
    text: "Marked the task as done",
    adminOnly: false,
  },
  { from: ["completed"], to: "verified", text: "Verified as correct", adminOnly: true },
  { from: ["completed"], to: "in_progress", text: "Sent back for more work", adminOnly: true },
];

export function findMove(from: TaskStatus, to: TaskStatus): TaskMove | undefined {
  return TASK_MOVES.find((m) => m.to === to && m.from.includes(from));
}

/** yyyy-mm-dd that is a real calendar day. */
export function isRealDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === s &&
    s >= "2000-01-01" &&
    s <= "2100-12-31"
  );
}
