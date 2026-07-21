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
  return { waves, lanes, maxConcurrency: Math.max(1, Math.min(budgets.maxConcurrency, tasks.length)) };
}

export function selectRunnableTasks(
  plan: ExecutionPlan,
  completed: ReadonlySet<string>,
  activeLanes: ReadonlySet<string>,
): readonly string[] {
  const currentWave = plan.waves.find((wave) => wave.taskIds.some((id) => !completed.has(id)));
  if (!currentWave) return [];
  return currentWave.taskIds.filter((id) => {
    if (completed.has(id)) return false;
    const lanesForTask = plan.lanes.filter((lane) => lane.taskOrder.includes(id));
    const isLaneHead = lanesForTask.every((lane) => lane.taskOrder.find((entry) => !completed.has(entry)) === id);
    if (!isLaneHead) return false;
    return lanesForTask.every((lane) => !activeLanes.has(lane.key));
  });
}
