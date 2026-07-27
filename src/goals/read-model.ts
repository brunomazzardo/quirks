/**
 * Goals, derived from the task ids that already carry them.
 *
 * 138 tasks grew 20 distinct id prefixes because the task schema has nowhere
 * to put a grouping. `QK-SRV-003` belongs to goal `QK-SRV` — this reads what
 * is already there rather than introducing a parallel scheme, so there is
 * nothing to migrate.
 *
 * This layer is read-only and stores nothing. Goal metadata (`why`,
 * `doneWhen`, an asserted `done`) arrives in 0a.2; until then a goal is
 * exactly what its member tasks say it is.
 */

export interface GoalMemberTask {
  readonly id: string;
  readonly status: string;
  readonly title: string;
  readonly priority?: string;
}

/**
 * What a goal is doing, derived from its members alone.
 *
 * `done` here means every member finished — NOT that the goal was achieved.
 * Those are different claims and 0a.2 separates them: a goal reaches a real
 * `done` only when someone asserts its `doneWhen` criteria are met, because
 * every task can complete while the thing is not built.
 */
export type DerivedGoalState =
  | "not_started"   // nothing finished yet
  | "in_progress"   // some finished, some open
  | "stalled"       // open work exists and every bit of it is blocked
  | "all_tasks_done";

export interface Goal {
  readonly id: string;
  readonly total: number;
  readonly done: number;
  readonly open: number;
  readonly blocked: number;
  readonly state: DerivedGoalState;
  readonly tasks: readonly GoalMemberTask[];
}

const OPEN_STATUSES = new Set(["ready", "proposed", "claimed", "in_review", "blocked"]);

/**
 * `QK-SRV-003` → `QK-SRV`. Ids that carry no third segment are their own goal,
 * so nothing is silently dropped from the rollup.
 */
export function goalIdForTask(taskId: string): string {
  const parts = taskId.split("-");
  return parts.length >= 3 ? parts.slice(0, 2).join("-") : taskId;
}

function deriveState(done: number, open: number, blocked: number): DerivedGoalState {
  if (open === 0) return "all_tasks_done";
  if (open > 0 && blocked === open) return "stalled";
  return done > 0 ? "in_progress" : "not_started";
}

export function deriveGoals(tasks: readonly GoalMemberTask[]): readonly Goal[] {
  const grouped = new Map<string, GoalMemberTask[]>();
  for (const task of tasks) {
    const goalId = goalIdForTask(task.id);
    const members = grouped.get(goalId);
    if (members) members.push(task);
    else grouped.set(goalId, [task]);
  }

  const goals: Goal[] = [];
  for (const [id, members] of grouped) {
    const done = members.filter((t) => t.status === "completed").length;
    const open = members.filter((t) => OPEN_STATUSES.has(t.status)).length;
    const blocked = members.filter((t) => t.status === "blocked").length;
    goals.push({
      id,
      total: members.length,
      done,
      open,
      blocked,
      state: deriveState(done, open, blocked),
      tasks: members.toSorted((a, b) => a.id.localeCompare(b.id)),
    });
  }

  // Goals with open work first, most open first — the rollup exists to show
  // what is unfinished, so finished goals sort to the bottom rather than
  // pushing live work off the first screen.
  return goals.toSorted((a, b) => b.open - a.open || b.total - a.total || a.id.localeCompare(b.id));
}

export function findGoal(goals: readonly Goal[], goalId: string): Goal | undefined {
  return goals.find((g) => g.id.toLowerCase() === goalId.toLowerCase());
}
