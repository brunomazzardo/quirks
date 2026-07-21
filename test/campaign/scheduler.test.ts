import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionPlan, selectRunnableTasks } from "../../src/campaign/scheduler.js";
import type { ExecutionTask } from "../../src/campaign/scheduler.js";

const tasks: ExecutionTask[] = [
  { id: "A", dependsOn: [], parallelismKeys: ["shared"], status: "ready" },
  { id: "B", dependsOn: ["A"], parallelismKeys: ["shared"], status: "ready" },
  { id: "C", dependsOn: [], parallelismKeys: ["other"], status: "ready" },
];

test("serializes parallelism key conflicts and respects dependency waves", () => {
  const plan = buildExecutionPlan(tasks, { maxConcurrency: 3, maxTasks: 3 });
  assert.deepEqual(plan.waves[0]?.taskIds.toSorted(), ["A", "C"]);
  assert.deepEqual(plan.waves[1]?.taskIds, ["B"]);
  assert.equal(plan.lanes.some((lane) => lane.key === "shared" && lane.taskOrder.join(",") === "A,B"), true);
});

test("cycles throw DEPENDENCY_CYCLE", () => {
  const cyclic: ExecutionTask[] = [
    { id: "X", dependsOn: ["Y"], parallelismKeys: [], status: "ready" },
    { id: "Y", dependsOn: ["X"], parallelismKeys: [], status: "ready" },
  ];
  assert.throws(() => buildExecutionPlan(cyclic, { maxConcurrency: 2, maxTasks: 2 }), /DEPENDENCY_CYCLE/);
});

test("rejects plans over the task-count budget", () => {
  assert.throws(() => buildExecutionPlan(tasks, { maxConcurrency: 3, maxTasks: 2 }), /TASK_BUDGET_EXCEEDED/);
});

test("selectRunnableTasks withholds a lane-conflicted task until its lane is free", () => {
  const plan = buildExecutionPlan(tasks, { maxConcurrency: 3, maxTasks: 3 });
  const runnable = selectRunnableTasks(plan, new Set(), new Set());
  assert.deepEqual(runnable.toSorted(), ["A", "C"]);
});

test("selectRunnableTasks withholds a task whose parallelism lane is already active", () => {
  const plan = buildExecutionPlan(tasks, { maxConcurrency: 3, maxTasks: 3 });
  const runnable = selectRunnableTasks(plan, new Set(), new Set(["other"]));
  assert.deepEqual(runnable, ["A"]);
});

test("selectRunnableTasks withholds later waves until earlier waves fully complete", () => {
  const plan = buildExecutionPlan(tasks, { maxConcurrency: 3, maxTasks: 3 });
  const runnable = selectRunnableTasks(plan, new Set(["A"]), new Set());
  assert.deepEqual(runnable, ["C"]);
});

test("selectRunnableTasks admits the next wave once its predecessor wave completes", () => {
  const plan = buildExecutionPlan(tasks, { maxConcurrency: 3, maxTasks: 3 });
  const runnable = selectRunnableTasks(plan, new Set(["A", "C"]), new Set());
  assert.deepEqual(runnable, ["B"]);
});
