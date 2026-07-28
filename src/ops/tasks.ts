// Task operations — the logic both the CLI and the service routes call.

import { BARE_PREFIX, goalIdOfTask, isValidGoalId, mintTaskId } from "../store/ids.ts";
import { block, claim, complete, release } from "../store/transitions.ts";
import { loadTasks, makeSourceRef, saveTasks, type Store } from "../store/store.ts";
import type { Task } from "../store/types.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";

export function getTask(store: Store, id: string): Task {
  const task = loadTasks(store).find((t) => t.id === id);
  if (!task) throw new NotFoundError(`no task ${id} — quirks task list shows what exists`);
  return task;
}

export interface TaskFilter {
  goal?: string | undefined;
  status?: string | undefined;
}

export function listTasks(store: Store, filter: TaskFilter = {}): Task[] {
  let tasks = loadTasks(store);
  if (filter.goal !== undefined) {
    tasks = tasks.filter((t) => (goalIdOfTask(t.id) ?? "(no goal)") === filter.goal);
  }
  if (filter.status !== undefined) {
    tasks = tasks.filter((t) => t.status === filter.status);
  }
  return [...tasks].sort((a, b) => a.id.localeCompare(b.id));
}

export interface ProposeInput {
  title: string;
  goal?: string | undefined;
  dependsOn: string[];
  deliverables: string[];
  criteria: string[];
  verify: string[];
  sources: string[];
  effort?: string | undefined;
  risk?: string | undefined;
  needsDesign: boolean;
  needsBreakdown: boolean;
  future: boolean;
}

export function proposeTask(store: Store, input: ProposeInput): Task {
  if (!input.title) throw new ValidationError("--title is required");
  if (input.goal !== undefined && !isValidGoalId(input.goal)) {
    throw new ValidationError(`--goal wants a goal id like QK-SRV, got ${JSON.stringify(input.goal)}`);
  }
  const tasks = loadTasks(store);
  const dependsOn = input.dependsOn
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  for (const dep of dependsOn) {
    if (!tasks.some((t) => t.id === dep)) {
      throw new ValidationError(`dependency ${dep} does not exist — propose in dependency order`);
    }
  }
  const now = new Date().toISOString();
  const task: Task = {
    id: mintTaskId(tasks, input.goal ?? BARE_PREFIX),
    title: input.title,
    status: "open",
    dependsOn,
    deliverables: input.deliverables,
    acceptanceCriteria: input.criteria,
    verification: input.verify,
    sourceRefs: input.sources.map((p) => makeSourceRef(store, p)),
    needsDesign: input.needsDesign,
    needsBreakdown: input.needsBreakdown,
    ...(input.future ? { future: true } : {}),
    ...(input.effort !== undefined ? { effort: input.effort } : {}),
    ...(input.risk !== undefined ? { risk: input.risk } : {}),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    statusDetail: {},
  };
  tasks.push(task);
  saveTasks(store, tasks);
  return task;
}

/** Load → check → transition → save. `ifRevision` is the optimistic check the
 *  surfaces derive; nobody hand-authors request files against a schema anymore. */
function mutate(
  store: Store,
  id: string,
  ifRevision: number | undefined,
  fn: (task: Task) => Task,
): Task {
  const tasks = loadTasks(store);
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new NotFoundError(`no task ${id} — quirks task list shows what exists`);
  if (ifRevision !== undefined) {
    if (!Number.isInteger(ifRevision)) {
      throw new ValidationError(`--if-revision wants a number, got ${JSON.stringify(ifRevision)}`);
    }
    if (task.revision !== ifRevision) {
      throw new ConflictError(
        `${id} is at revision ${task.revision}, not ${ifRevision} — it changed underneath you`,
      );
    }
  }
  const next = fn(task);
  saveTasks(store, tasks.map((t) => (t.id === id ? next : t)));
  return next;
}

export interface ClaimInput {
  by?: string | undefined;
  force?: boolean | undefined;
  ifRevision?: number | undefined;
}

export function claimTask(store: Store, id: string, input: ClaimInput = {}): Task {
  const tasks = loadTasks(store);
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new NotFoundError(`no task ${id} — quirks task list shows what exists`);
  const unmet = task.dependsOn.filter(
    (dep) => tasks.find((t) => t.id === dep)?.status !== "completed",
  );
  if (unmet.length > 0 && !input.force) {
    throw new ConflictError(
      `${id} has incomplete dependencies: ${unmet.join(", ")} (--force to claim anyway)`,
    );
  }
  return mutate(store, id, input.ifRevision, (t) => claim(t, input.by));
}

export function blockTask(
  store: Store,
  id: string,
  input: { reason?: string | undefined; until?: string | undefined; ifRevision?: number | undefined },
): Task {
  if (!input.reason) throw new ValidationError("--reason is required to block");
  return mutate(store, id, input.ifRevision, (t) => block(t, input.reason!, input.until));
}

export function completeTask(
  store: Store,
  id: string,
  input: { evidence?: string | undefined; ifRevision?: number | undefined } = {},
): Task {
  return mutate(store, id, input.ifRevision, (t) => complete(t, input.evidence));
}

export function releaseTask(store: Store, id: string, input: { ifRevision?: number | undefined } = {}): Task {
  return mutate(store, id, input.ifRevision, release);
}
