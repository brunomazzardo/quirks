import { BARE_PREFIX, goalIdOfTask, isValidGoalId, mintTaskId } from "../store/ids.ts";
import { block, claim, complete, release } from "../store/transitions.ts";
import { loadTasks, makeSourceRef, openStore, saveTasks, type Store } from "../store/store.ts";
import type { Task } from "../store/types.ts";
import { CliError, emitJson, emitRead, table } from "./output.ts";

function findTask(tasks: Task[], id: string): Task {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new CliError(`no task ${id} — quirks task list shows what exists`);
  return task;
}

/** Load → check → transition → save. `--if-revision` is the optimistic check the
 *  CLI derives; nobody hand-authors request files against a schema anymore. */
function mutate(
  store: Store,
  id: string,
  ifRevision: string | undefined,
  fn: (task: Task) => Task,
): void {
  const tasks = loadTasks(store);
  const task = findTask(tasks, id);
  if (ifRevision !== undefined) {
    const expected = Number.parseInt(ifRevision, 10);
    if (Number.isNaN(expected)) {
      throw new CliError(`--if-revision wants a number, got ${JSON.stringify(ifRevision)}`);
    }
    if (task.revision !== expected) {
      throw new CliError(
        `${id} is at revision ${task.revision}, not ${expected} — it changed underneath you`,
      );
    }
  }
  const next = fn(task);
  saveTasks(store, tasks.map((t) => (t.id === id ? next : t)));
  emitJson(next);
}

function flagMarks(t: Task): string {
  return [
    t.needsDesign ? "design?" : "",
    t.needsBreakdown ? "breakdown?" : "",
    t.future ? "future" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function taskPropose(opts: {
  title: string;
  goal?: string;
  dependsOn: string[];
  deliverable: string[];
  criterion: string[];
  verify: string[];
  source: string[];
  effort?: string;
  risk?: string;
  needsDesign: boolean;
  needsBreakdown: boolean;
  future: boolean;
}): void {
  if (opts.goal !== undefined && !isValidGoalId(opts.goal)) {
    throw new CliError(`--goal wants a goal id like QK-SRV, got ${JSON.stringify(opts.goal)}`);
  }
  const store = openStore();
  const tasks = loadTasks(store);
  const dependsOn = opts.dependsOn
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  for (const dep of dependsOn) {
    if (!tasks.some((t) => t.id === dep)) {
      throw new CliError(`dependency ${dep} does not exist — propose in dependency order`);
    }
  }
  const now = new Date().toISOString();
  const task: Task = {
    id: mintTaskId(tasks, opts.goal ?? BARE_PREFIX),
    title: opts.title,
    status: "open",
    dependsOn,
    deliverables: opts.deliverable,
    acceptanceCriteria: opts.criterion,
    verification: opts.verify,
    sourceRefs: opts.source.map((p) => makeSourceRef(store, p)),
    needsDesign: opts.needsDesign,
    needsBreakdown: opts.needsBreakdown,
    ...(opts.future ? { future: true } : {}),
    ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
    ...(opts.risk !== undefined ? { risk: opts.risk } : {}),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    statusDetail: {},
  };
  tasks.push(task);
  saveTasks(store, tasks);
  emitJson(task);
}

export function taskList(opts: { json: boolean; goal?: string; status?: string }): void {
  const store = openStore();
  let tasks = loadTasks(store);
  if (opts.goal !== undefined) {
    tasks = tasks.filter((t) => (goalIdOfTask(t.id) ?? "(no goal)") === opts.goal);
  }
  if (opts.status !== undefined) {
    tasks = tasks.filter((t) => t.status === opts.status);
  }
  tasks = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  emitRead(tasks, opts.json, () =>
    tasks.length === 0
      ? "no tasks"
      : table(
          ["task", "status", "flags", "title"],
          tasks.map((t) => [t.id, t.status, flagMarks(t), t.title]),
        ),
  );
}

export function taskShow(id: string): void {
  const store = openStore();
  // The detail view is the JSON either way — every field matters and a table hides some.
  emitJson(findTask(loadTasks(store), id));
}

export function taskClaim(
  id: string,
  opts: { by?: string; force: boolean; ifRevision?: string },
): void {
  const store = openStore();
  const tasks = loadTasks(store);
  const task = findTask(tasks, id);
  const unmet = task.dependsOn.filter(
    (dep) => tasks.find((t) => t.id === dep)?.status !== "completed",
  );
  if (unmet.length > 0 && !opts.force) {
    throw new CliError(
      `${id} has incomplete dependencies: ${unmet.join(", ")} (--force to claim anyway)`,
    );
  }
  mutate(store, id, opts.ifRevision, (t) => claim(t, opts.by));
}

export function taskBlock(
  id: string,
  opts: { reason?: string; until?: string; ifRevision?: string },
): void {
  if (!opts.reason) throw new CliError("--reason is required to block");
  mutate(openStore(), id, opts.ifRevision, (t) => block(t, opts.reason!, opts.until));
}

export function taskComplete(id: string, opts: { evidence?: string; ifRevision?: string }): void {
  mutate(openStore(), id, opts.ifRevision, (t) => complete(t, opts.evidence));
}

export function taskRelease(id: string, opts: { ifRevision?: string }): void {
  mutate(openStore(), id, opts.ifRevision, release);
}
