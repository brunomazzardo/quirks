// The ledger pane's row model — a port of apps/workbench/src/core.ts
// (QK-NAT-007 / 011 / 012) off Uint8Array scanning and onto the typed wire
// contract. Everything here is pure so it can be tested without a DOM; the
// component in ../components/ledger-pane.tsx only renders what these return.
//
// Rules kept verbatim from the native workbench, including the ones that look
// arbitrary — they are the behavior QK-WB-003 is asked to match:
//   statusTone / taskIsActive / goalIsProgress  (substring classification)
//   ordering: updated → updatedAt DESC, status → status DESC, both tie-broken
//             by id DESC
//   the trailing "Other" bucket for goal-less tasks, unfiltered by goal state
//
// Deliberate divergences are marked DIVERGES.

import type { GoalRollup, Task } from "@quirks/contracts";

export type StatusTone = "neutral" | "live" | "done";
export type StatusFilter = "active" | "done" | "all";
export type GoalFilter = "progress" | "idle" | "all";
export type Ordering = "updated" | "status";

/** The three View-menu axes, exactly the native workbench's (core.ts Model). */
export interface LedgerView {
  readonly statusFilter: StatusFilter;
  readonly goalFilter: GoalFilter;
  readonly ordering: Ordering;
}

/** core.ts initialModel(): Status=Active, Goals=In progress, Ordering=Updated. */
export const DEFAULT_VIEW: LedgerView = {
  statusFilter: "active",
  goalFilter: "progress",
  ordering: "updated",
};

/** True when the view has left its defaults — drives the header's `filt` mark. */
export function viewDirty(view: LedgerView): boolean {
  return (
    view.statusFilter !== DEFAULT_VIEW.statusFilter ||
    view.goalFilter !== DEFAULT_VIEW.goalFilter ||
    view.ordering !== DEFAULT_VIEW.ordering
  );
}

/** The id the "no goal" bucket carries in a goal rollup (ops/Goals.ts). */
export const NO_GOAL_ID = "(no goal)";

/** The section id the goal-less group collapses under (core.ts headerId). */
export const OTHER_SECTION_ID = "h:other";

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

/** core.ts statusTone — substring matching, so it survives label changes. */
export function statusTone(label: string): StatusTone {
  const s = label.toLowerCase();
  if (s.includes("done") || s.includes("completed") || s.includes("closed")) return "done";
  if (
    s.includes("progress") ||
    s.includes("claimed") ||
    s.includes("running") ||
    s.includes("live") ||
    s.includes("blocked")
  ) {
    return "live";
  }
  return "neutral";
}

/** core.ts taskIsActive — open / claimed / blocked are active, completed is not. */
export function taskIsActive(status: string): boolean {
  const s = status.toLowerCase();
  if (s.includes("completed")) return false;
  if (s.includes("closed")) return false;
  if (s === "done") return false;
  return true;
}

export function taskIsDone(status: string): boolean {
  return !taskIsActive(status);
}

/**
 * core.ts goalIsProgress. Rollup states are "in progress" / "not started" /
 * "tasks done" for recorded active goals, "implied" for goals that exist only
 * as a task-id prefix, and "done" / "abandoned" once `?all=true` includes them.
 *
 * DIVERGES: "abandoned" is treated as not-in-progress. The native list could
 * never contain one (it never asked for `?all=true`), so its final
 * "unknown stays visible" fallback would have swept abandoned goals into the
 * default view here. "implied" still falls through to visible, as intended.
 */
export function goalIsProgress(state: string): boolean {
  const s = state.toLowerCase();
  if (s.includes("progress")) return true;
  if (s.includes("not started")) return false;
  if (s.includes("tasks done")) return false;
  if (s === "done" || s === "closed" || s === "abandoned") return false;
  return true;
}

export function goalIsIdle(state: string): boolean {
  return !goalIsProgress(state);
}

/**
 * core.ts goalIdOfTask, and the same rule as apps/server's store/Ids.ts:
 * QK-NAT-012 → QK-NAT; a bare QK-001 has no goal.
 */
export function goalIdOfTask(taskId: string): string | null {
  return /^(QK-[A-Z][A-Z0-9]*)-\d+$/.exec(taskId)?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// filtering and ordering
// ---------------------------------------------------------------------------

/** Descending compare — core.ts compareBytesDesc, on strings. */
function compareDesc(a: string, b: string): number {
  if (a < b) return 1;
  if (a > b) return -1;
  return 0;
}

export function filterTasks(tasks: readonly Task[], statusFilter: StatusFilter): Task[] {
  return tasks.filter((t) => {
    if (statusFilter === "active") return taskIsActive(t.status);
    if (statusFilter === "done") return taskIsDone(t.status);
    return true;
  });
}

/**
 * core.ts sortTasks. Both orderings are DESCENDING with an id-descending
 * tie-break — "status" reads oddly (open, completed, claimed, blocked) but it
 * is what the native double-negated comparator computed, and it does group
 * like with like, which is the point of the option.
 */
export function sortTasks(tasks: readonly Task[], ordering: Ordering): Task[] {
  if (ordering === "updated") {
    return [...tasks].sort(
      (a, b) => compareDesc(a.updatedAt, b.updatedAt) || compareDesc(a.id, b.id),
    );
  }
  return [...tasks].sort(
    (a, b) =>
      compareDesc(a.status.toLowerCase(), b.status.toLowerCase()) || compareDesc(a.id, b.id),
  );
}

/**
 * Goals for the Goals accordion: the goal-state filter applied, and the
 * rollup's synthetic "(no goal)" row dropped — it is not a goal, it is the
 * inbox's Other bucket, and core.ts parseGoals skipped it by the same name.
 */
export function filterGoals(goals: readonly GoalRollup[], goalFilter: GoalFilter): GoalRollup[] {
  return goals.filter((g) => {
    if (g.id === NO_GOAL_ID) return false;
    if (goalFilter === "progress") return goalIsProgress(g.state);
    if (goalFilter === "idle") return goalIsIdle(g.state);
    return true;
  });
}

// ---------------------------------------------------------------------------
// the inbox
// ---------------------------------------------------------------------------

export interface InboxTask {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly tone: StatusTone;
  /** Advisory "deliberately not now" — excluded from the rollup's open count. */
  readonly future: boolean;
}

export interface InboxGroup {
  /** Section id for collapse state: the goal id, or "h:other". */
  readonly id: string;
  readonly goalId: string | null;
  readonly title: string;
  /** The goal's rollup state, or "no goal" for the Other bucket. */
  readonly state: string;
  readonly tone: StatusTone;
  readonly tasks: readonly InboxTask[];
}

function toInboxTask(task: Task): InboxTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    tone: statusTone(task.status),
    future: task.future === true,
  };
}

/**
 * core.ts rebuildInbox: filtered tasks grouped under their goal, plus a
 * trailing "Other" bucket for goal-less tasks. Groups with no surviving tasks
 * are dropped, so Other only appears when it has rows (QK-NAT-012).
 *
 * DIVERGES: groups follow the order of `goals` — which the daemon already
 * sorts by open work descending (ops/Goals.ts) — instead of the native's
 * first-appearance-in-the-task-array order, which was an artifact of scanning
 * the JSON body byte by byte. Goals absent from the rollup (impossible in
 * practice: the rollup mints an "implied" row for every prefix it sees) fall
 * to the end in first-appearance order, so no task can go missing.
 */
export function buildInbox(
  goals: readonly GoalRollup[],
  tasks: readonly Task[],
  view: LedgerView,
): InboxGroup[] {
  const filtered = filterTasks(tasks, view.statusFilter);

  const byGoal = new Map<string, Task[]>();
  const orphans: Task[] = [];
  for (const task of filtered) {
    const goalId = goalIdOfTask(task.id);
    if (goalId === null) {
      orphans.push(task);
      continue;
    }
    const bucket = byGoal.get(goalId);
    if (bucket === undefined) byGoal.set(goalId, [task]);
    else bucket.push(task);
  }

  const ordered: string[] = [];
  for (const goal of goals) {
    if (goal.id !== NO_GOAL_ID && byGoal.has(goal.id)) ordered.push(goal.id);
  }
  for (const goalId of byGoal.keys()) {
    if (!ordered.includes(goalId)) ordered.push(goalId);
  }

  const rollupById = new Map(goals.map((g) => [g.id, g]));
  const groups: InboxGroup[] = [];

  for (const goalId of ordered) {
    const group = byGoal.get(goalId);
    if (group === undefined || group.length === 0) continue;
    const rollup = rollupById.get(goalId);
    // core.ts defaulted an unknown goal's state to "in progress" so its tasks
    // stayed visible under the default view.
    const state = rollup?.state ?? "in progress";
    if (view.goalFilter === "progress" && !goalIsProgress(state)) continue;
    if (view.goalFilter === "idle" && !goalIsIdle(state)) continue;
    groups.push({
      id: goalId,
      goalId,
      title: rollup?.title ?? goalId,
      state,
      tone: statusTone(state),
      tasks: sortTasks(group, view.ordering).map(toInboxTask),
    });
  }

  // The Other bucket is appended whatever the goal filter says — a task with
  // no goal has no goal state to filter on (core.ts did the same).
  if (orphans.length > 0) {
    groups.push({
      id: OTHER_SECTION_ID,
      goalId: null,
      title: "Other",
      state: "no goal",
      tone: "neutral",
      tasks: sortTasks(orphans, view.ordering).map(toInboxTask),
    });
  }

  return groups;
}

/** core.ts inboxCount — task rows only, headers excluded. */
export function inboxCount(groups: readonly InboxGroup[]): number {
  let n = 0;
  for (const group of groups) n += group.tasks.length;
  return n;
}
