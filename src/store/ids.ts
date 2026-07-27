import type { Task } from "./types.ts";

/** The namespace bare (goal-less) task ids mint under: QK-001, QK-014, … */
export const BARE_PREFIX = "QK";

/** Goal ids are the task-id prefix: QK-SRV, QK-NAT. The tag must start with a
 *  letter so a goal can never collide with the bare-number task namespace. */
const GOAL_ID = /^QK-[A-Z][A-Z0-9]*$/;

export function isValidGoalId(id: string): boolean {
  return GOAL_ID.test(id);
}

export function goalIdOfTask(taskId: string): string | null {
  const m = /^(QK-[A-Z][A-Z0-9]*)-\d+$/.exec(taskId);
  return m ? m[1]! : null;
}

/** Next id under a prefix: max existing number + 1, zero-padded to 3. */
export function mintTaskId(tasks: Task[], prefix: string): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const t of tasks) {
    const m = pattern.exec(t.id);
    if (m) max = Math.max(max, Number.parseInt(m[1]!, 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}
