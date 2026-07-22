import { QuirksError } from "../core/errors.js";

export interface ExecutionTask {
  id: string;
  dependsOn: readonly string[];
  parallelismKeys: readonly string[];
  status: string;
}

export interface ExecutionLane {
  key: string;
  taskOrder: readonly string[];
}

export interface ExecutionWave {
  index: number;
  taskIds: readonly string[];
}

export interface ExecutionPlan {
  waves: readonly ExecutionWave[];
  lanes: readonly ExecutionLane[];
  tasks: readonly ExecutionTask[];
  maxConcurrency: number;
}

export function buildExecutionPlan(
  tasks: readonly ExecutionTask[],
  budgets: { maxConcurrency: number; maxTasks: number },
): ExecutionPlan {
  if (tasks.length > budgets.maxTasks) {
    throw new QuirksError("PROTOCOL_VIOLATION", "TASK_BUDGET_EXCEEDED", { maxTasks: String(budgets.maxTasks), taskCount: String(tasks.length) });
  }
  const waves: ExecutionWave[] = [];
  const scheduled = new Set<string>();
  let index = 0;
  while (scheduled.size < tasks.length) {
    const ready = tasks
      .filter((task) => !scheduled.has(task.id) && task.dependsOn.every((dep) => scheduled.has(dep)))
      .map((task) => task.id);
    if (ready.length === 0) throw new QuirksError("PROTOCOL_VIOLATION", "DEPENDENCY_CYCLE");
    waves.push({ index: index++, taskIds: ready });
    for (const id of ready) scheduled.add(id);
  }
  const laneMap = new Map<string, string[]>();
  for (const task of tasks) {
    for (const key of task.parallelismKeys.length > 0 ? task.parallelismKeys : [`task:${task.id}`]) {
      const order = laneMap.get(key) ?? [];
      order.push(task.id);
      laneMap.set(key, order);
    }
  }
  const lanes = [...laneMap.entries()].map(([key, taskOrder]) => ({ key, taskOrder }));
  return {
    waves,
    lanes,
    tasks: tasks.map((task) => ({ ...task, dependsOn: [...task.dependsOn], parallelismKeys: [...task.parallelismKeys] })),
    maxConcurrency: Math.max(1, Math.min(budgets.maxConcurrency, tasks.length)),
  };
}

// Selection is dependency-driven rather than wave-driven: any task whose
// dependencies are all completed may run, so a paused or failing lane cannot
// starve dependency-satisfied tasks on other lanes in later waves.
export function selectRunnableTasks(
  plan: ExecutionPlan,
  completed: ReadonlySet<string>,
  activeLanes: ReadonlySet<string>,
  activeTasks: ReadonlySet<string> = new Set(),
): readonly string[] {
  const runnable = plan.tasks.filter((task) => {
    if (completed.has(task.id) || activeTasks.has(task.id)) return false;
    if (!task.dependsOn.every((dependencyId) => completed.has(dependencyId))) return false;
    const lanesForTask = plan.lanes.filter((lane) => lane.taskOrder.includes(task.id));
    const isLaneHead = lanesForTask.every((lane) => lane.taskOrder.find((entry) => !completed.has(entry)) === task.id);
    if (!isLaneHead) return false;
    return lanesForTask.every((lane) => !activeLanes.has(lane.key));
  }).map((task) => task.id);
  const budget = Math.max(0, plan.maxConcurrency - activeTasks.size);
  return [...runnable].toSorted((a, b) => a.localeCompare(b)).slice(0, budget);
}
