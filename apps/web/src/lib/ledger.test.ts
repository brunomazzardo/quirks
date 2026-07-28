import type { GoalRollup, Task, TaskStatus } from "@quirks/contracts";
import { expect, it } from "vite-plus/test";

import {
  buildInbox,
  DEFAULT_VIEW,
  filterGoals,
  filterTasks,
  goalIdOfTask,
  goalIsIdle,
  goalIsProgress,
  inboxCount,
  type LedgerView,
  NO_GOAL_ID,
  OTHER_SECTION_ID,
  sortTasks,
  statusTone,
  taskIsActive,
  viewDirty,
} from "./ledger";

function task(id: string, status: TaskStatus, updatedAt: string, title = id): Task {
  return {
    id,
    title,
    status,
    dependsOn: [],
    deliverables: [],
    acceptanceCriteria: [],
    verification: [],
    sourceRefs: [],
    needsDesign: false,
    needsBreakdown: false,
    revision: 1,
    createdAt: updatedAt,
    updatedAt,
    statusDetail: {},
  };
}

function goal(id: string, state: string, title: string | null = id): GoalRollup {
  return {
    id,
    title,
    recorded: title !== null,
    state,
    total: 0,
    done: 0,
    open: 0,
    blocked: 0,
    future: 0,
  };
}

function view(overrides: Partial<LedgerView>): LedgerView {
  return { ...DEFAULT_VIEW, ...overrides };
}

// ---- classification (core.ts statusTone / taskIsActive / goalIsProgress) ----

it("tones a status the way the native workbench did", () => {
  expect(statusTone("completed")).toBe("done");
  expect(statusTone("tasks done")).toBe("done");
  expect(statusTone("claimed")).toBe("live");
  expect(statusTone("blocked")).toBe("live");
  expect(statusTone("in progress")).toBe("live");
  expect(statusTone("open")).toBe("neutral");
  expect(statusTone("not started")).toBe("neutral");
  expect(statusTone("implied")).toBe("neutral");
});

it("counts open, claimed and blocked tasks as active — completed is not", () => {
  expect(taskIsActive("open")).toBe(true);
  expect(taskIsActive("claimed")).toBe(true);
  expect(taskIsActive("blocked")).toBe(true);
  expect(taskIsActive("completed")).toBe(false);
});

it("reads goal states the way the native View default did", () => {
  expect(goalIsProgress("in progress")).toBe(true);
  expect(goalIsProgress("not started")).toBe(false);
  expect(goalIsProgress("tasks done")).toBe(false);
  expect(goalIsProgress("done")).toBe(false);
  // Only reachable via ?all=true, which the native never asked for.
  expect(goalIsProgress("abandoned")).toBe(false);
  // Unknown labels stay visible under the default view — including "implied".
  expect(goalIsProgress("implied")).toBe(true);
  expect(goalIsIdle("not started")).toBe(true);
});

it("derives a goal id only from a QK-TAG-nnn task id", () => {
  expect(goalIdOfTask("QK-NAT-012")).toBe("QK-NAT");
  expect(goalIdOfTask("QK-WB-003")).toBe("QK-WB");
  expect(goalIdOfTask("QK-001")).toBe(null);
  expect(goalIdOfTask("QK-NAT-012a")).toBe(null);
  expect(goalIdOfTask("")).toBe(null);
});

// ---- the View axes ----

it("reports a dirty view only when an axis leaves its default", () => {
  expect(viewDirty(DEFAULT_VIEW)).toBe(false);
  expect(viewDirty(view({ statusFilter: "all" }))).toBe(true);
  expect(viewDirty(view({ goalFilter: "idle" }))).toBe(true);
  expect(viewDirty(view({ ordering: "status" }))).toBe(true);
});

it("filters tasks by the status axis", () => {
  const tasks = [
    task("QK-A-001", "open", "2026-07-01"),
    task("QK-A-002", "claimed", "2026-07-02"),
    task("QK-A-003", "blocked", "2026-07-03"),
    task("QK-A-004", "completed", "2026-07-04"),
  ];
  expect(filterTasks(tasks, "active").map((t) => t.id)).toEqual([
    "QK-A-001",
    "QK-A-002",
    "QK-A-003",
  ]);
  expect(filterTasks(tasks, "done").map((t) => t.id)).toEqual(["QK-A-004"]);
  expect(filterTasks(tasks, "all")).toHaveLength(4);
});

it("orders by updatedAt descending, tie-broken by id descending", () => {
  const tasks = [
    task("QK-A-001", "open", "2026-07-01"),
    task("QK-A-003", "open", "2026-07-09"),
    task("QK-A-002", "open", "2026-07-09"),
  ];
  expect(sortTasks(tasks, "updated").map((t) => t.id)).toEqual([
    "QK-A-003",
    "QK-A-002",
    "QK-A-001",
  ]);
});

it("orders by status descending, tie-broken by id descending", () => {
  const tasks = [
    task("QK-A-001", "blocked", "2026-07-01"),
    task("QK-A-002", "open", "2026-07-02"),
    task("QK-A-003", "completed", "2026-07-03"),
    task("QK-A-004", "claimed", "2026-07-04"),
  ];
  // open > completed > claimed > blocked, descending — the native comparator.
  expect(sortTasks(tasks, "status").map((t) => t.status)).toEqual([
    "open",
    "completed",
    "claimed",
    "blocked",
  ]);
});

it("does not mutate the array it sorts", () => {
  const tasks = [task("QK-A-001", "open", "2026-07-01"), task("QK-A-002", "open", "2026-07-09")];
  sortTasks(tasks, "updated");
  expect(tasks.map((t) => t.id)).toEqual(["QK-A-001", "QK-A-002"]);
});

// ---- the Goals accordion ----

it("filters goals by state and never lists the synthetic (no goal) row", () => {
  const goals = [
    goal("QK-A", "in progress"),
    goal("QK-B", "not started"),
    goal("QK-C", "tasks done"),
    goal(NO_GOAL_ID, "implied", null),
  ];
  expect(filterGoals(goals, "progress").map((g) => g.id)).toEqual(["QK-A"]);
  expect(filterGoals(goals, "idle").map((g) => g.id)).toEqual(["QK-B", "QK-C"]);
  expect(filterGoals(goals, "all").map((g) => g.id)).toEqual(["QK-A", "QK-B", "QK-C"]);
});

// ---- the inbox (core.ts rebuildInbox) ----

const GOALS: readonly GoalRollup[] = [
  goal("QK-WB", "in progress", "the workbench"),
  goal("QK-MONO", "not started", "the monorepo"),
];

const TASKS: readonly Task[] = [
  task("QK-MONO-001", "open", "2026-07-05"),
  task("QK-WB-003", "claimed", "2026-07-08"),
  task("QK-WB-001", "completed", "2026-07-02"),
  task("QK-WB-004", "open", "2026-07-06"),
  task("QK-001", "open", "2026-07-07"),
];

it("groups active tasks under in-progress goals by default, Other last", () => {
  const groups = buildInbox(GOALS, TASKS, DEFAULT_VIEW);
  expect(groups.map((g) => g.id)).toEqual(["QK-WB", OTHER_SECTION_ID]);

  const wb = groups[0];
  expect(wb?.title).toBe("the workbench");
  expect(wb?.state).toBe("in progress");
  expect(wb?.tone).toBe("live");
  // completed QK-WB-001 is filtered out; the rest sort by updatedAt desc.
  expect(wb?.tasks.map((t) => t.id)).toEqual(["QK-WB-003", "QK-WB-004"]);

  const other = groups[1];
  expect(other?.goalId).toBe(null);
  expect(other?.title).toBe("Other");
  expect(other?.tasks.map((t) => t.id)).toEqual(["QK-001"]);

  expect(inboxCount(groups)).toBe(3);
});

it("hides the Other bucket when no goal-less task matches", () => {
  const groups = buildInbox(GOALS, TASKS, view({ statusFilter: "done" }));
  expect(groups.some((g) => g.id === OTHER_SECTION_ID)).toBe(false);
});

it("reveals done tasks and idle goals through the View axes without dropping Other", () => {
  const done = buildInbox(GOALS, TASKS, view({ statusFilter: "done", goalFilter: "all" }));
  expect(done.map((g) => g.id)).toEqual(["QK-WB"]);
  expect(done[0]?.tasks.map((t) => t.id)).toEqual(["QK-WB-001"]);

  const idle = buildInbox(GOALS, TASKS, view({ goalFilter: "idle" }));
  // QK-MONO is "not started" — idle — and Other rides along regardless.
  expect(idle.map((g) => g.id)).toEqual(["QK-MONO", OTHER_SECTION_ID]);

  const all = buildInbox(GOALS, TASKS, view({ statusFilter: "all", goalFilter: "all" }));
  expect(all.map((g) => g.id)).toEqual(["QK-WB", "QK-MONO", OTHER_SECTION_ID]);
  expect(inboxCount(all)).toBe(5);
});

it("drops a goal group whose tasks were all filtered away", () => {
  const groups = buildInbox(GOALS, TASKS, view({ statusFilter: "done", goalFilter: "all" }));
  expect(groups.some((g) => g.id === "QK-MONO")).toBe(false);
});

it("orders groups by the rollup, not by first appearance in the task list", () => {
  // QK-MONO-001 appears first among the tasks; QK-WB leads the rollup.
  const groups = buildInbox(GOALS, TASKS, view({ goalFilter: "all" }));
  expect(groups.map((g) => g.id)).toEqual(["QK-WB", "QK-MONO", OTHER_SECTION_ID]);
});

it("keeps tasks whose goal has no rollup row, defaulting it to in progress", () => {
  const groups = buildInbox([], [task("QK-GHOST-001", "open", "2026-07-01")], DEFAULT_VIEW);
  expect(groups.map((g) => g.id)).toEqual(["QK-GHOST"]);
  expect(groups[0]?.title).toBe("QK-GHOST");
  expect(groups[0]?.state).toBe("in progress");
});

it("falls back to the goal id when the rollup row has no title", () => {
  const groups = buildInbox(
    [goal("QK-IMP", "implied", null)],
    [task("QK-IMP-001", "open", "2026-07-01")],
    DEFAULT_VIEW,
  );
  expect(groups[0]?.title).toBe("QK-IMP");
});

it("carries the advisory future flag onto the row", () => {
  const future: Task = { ...task("QK-A-001", "open", "2026-07-01"), future: true };
  const groups = buildInbox([goal("QK-A", "in progress")], [future], DEFAULT_VIEW);
  expect(groups[0]?.tasks[0]?.future).toBe(true);
});

it("counts nothing when there is nothing", () => {
  expect(buildInbox([], [], DEFAULT_VIEW)).toEqual([]);
  expect(inboxCount([])).toBe(0);
});
