// Task operations — the logic every surface calls.
// Ported from the bun-era src/ops/tasks.ts (QK-MONO-003).

import * as Effect from "effect/Effect";
import type { Task } from "@quirks/contracts";
import { BARE_PREFIX, goalIdOfTask, isValidGoalId, mintTaskId } from "../store/Ids.ts";
import { block, claim, complete, release, type TransitionError } from "../store/Transitions.ts";
import { Ledger, Store } from "../store/Store.ts";
import type { StoreError } from "../store/JsonFile.ts";
import { conflict, invalid, missing, type OpError } from "./Errors.ts";

export const getTask = (id: string): Effect.Effect<Task, StoreError | OpError, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const task = (yield* ledger.loadTasks).find((t) => t.id === id);
    if (!task) return yield* missing(`no task ${id} — quirks task list shows what exists`);
    return task;
  });

export interface TaskFilter {
  readonly goal?: string | undefined;
  readonly status?: string | undefined;
}

export const listTasks = (filter: TaskFilter = {}): Effect.Effect<Task[], StoreError, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    let tasks = yield* ledger.loadTasks;
    if (filter.goal !== undefined) {
      tasks = tasks.filter((t) => (goalIdOfTask(t.id) ?? "(no goal)") === filter.goal);
    }
    if (filter.status !== undefined) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    return [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  });

export interface ProposeInput {
  readonly title: string;
  readonly goal?: string | undefined;
  readonly dependsOn: string[];
  readonly deliverables: string[];
  readonly criteria: string[];
  readonly verify: string[];
  readonly sources: string[];
  readonly effort?: string | undefined;
  readonly risk?: string | undefined;
  readonly needsDesign: boolean;
  readonly needsBreakdown: boolean;
  readonly future: boolean;
}

export const proposeTask = (
  input: ProposeInput,
): Effect.Effect<Task, StoreError | OpError, Ledger | Store> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const store = yield* Store;
    if (!input.title) return yield* invalid("--title is required");
    if (input.goal !== undefined && !isValidGoalId(input.goal)) {
      return yield* invalid(
        `--goal wants a goal id like QK-SRV, got ${JSON.stringify(input.goal)}`,
      );
    }
    const tasks = yield* ledger.loadTasks;
    const dependsOn = input.dependsOn
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean);
    for (const dep of dependsOn) {
      if (!tasks.some((t) => t.id === dep)) {
        return yield* invalid(`dependency ${dep} does not exist — propose in dependency order`);
      }
    }
    const sourceRefs = yield* Effect.forEach(input.sources, (p) => store.makeSourceRef(p));
    const now = new Date().toISOString();
    const task: Task = {
      id: mintTaskId(tasks, input.goal ?? BARE_PREFIX),
      title: input.title,
      status: "open",
      dependsOn,
      deliverables: input.deliverables,
      acceptanceCriteria: input.criteria,
      verification: input.verify,
      sourceRefs,
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
    yield* ledger.saveTasks(tasks);
    return task;
  });

/** Load → check → transition → save. `ifRevision` is the optimistic check the
 *  surfaces derive; nobody hand-authors request files against a schema anymore. */
const mutate = <E>(
  id: string,
  ifRevision: number | undefined,
  fn: (task: Task) => Effect.Effect<Task, E>,
): Effect.Effect<Task, StoreError | OpError | E, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const tasks = yield* ledger.loadTasks;
    const task = tasks.find((t) => t.id === id);
    if (!task) return yield* missing(`no task ${id} — quirks task list shows what exists`);
    if (ifRevision !== undefined) {
      if (!Number.isInteger(ifRevision)) {
        return yield* invalid(`--if-revision wants a number, got ${JSON.stringify(ifRevision)}`);
      }
      if (task.revision !== ifRevision) {
        return yield* conflict(
          `${id} is at revision ${task.revision}, not ${ifRevision} — it changed underneath you`,
        );
      }
    }
    const next = yield* fn(task);
    yield* ledger.saveTasks(tasks.map((t) => (t.id === id ? next : t)));
    return next;
  });

export interface ClaimInput {
  readonly by?: string | undefined;
  readonly force?: boolean | undefined;
  readonly ifRevision?: number | undefined;
}

export const claimTask = (
  id: string,
  input: ClaimInput = {},
): Effect.Effect<Task, StoreError | OpError | TransitionError, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const tasks = yield* ledger.loadTasks;
    const task = tasks.find((t) => t.id === id);
    if (!task) return yield* missing(`no task ${id} — quirks task list shows what exists`);
    const unmet = task.dependsOn.filter(
      (dep) => tasks.find((t) => t.id === dep)?.status !== "completed",
    );
    if (unmet.length > 0 && !input.force) {
      return yield* conflict(
        `${id} has incomplete dependencies: ${unmet.join(", ")} (--force to claim anyway)`,
      );
    }
    return yield* mutate(id, input.ifRevision, (t) => claim(t, input.by));
  });

export interface BlockInput {
  readonly reason?: string | undefined;
  readonly until?: string | undefined;
  readonly ifRevision?: number | undefined;
}

export const blockTask = (
  id: string,
  input: BlockInput,
): Effect.Effect<Task, StoreError | OpError | TransitionError, Ledger> => {
  const reason = input.reason;
  if (!reason) return invalid("--reason is required to block");
  return mutate(id, input.ifRevision, (t) => block(t, reason, input.until));
};

export interface CompleteInput {
  readonly evidence?: string | undefined;
  readonly ifRevision?: number | undefined;
}

export const completeTask = (
  id: string,
  input: CompleteInput = {},
): Effect.Effect<Task, StoreError | OpError | TransitionError, Ledger> =>
  mutate(id, input.ifRevision, (t) => complete(t, input.evidence));

export interface ReleaseInput {
  readonly ifRevision?: number | undefined;
}

export const releaseTask = (
  id: string,
  input: ReleaseInput = {},
): Effect.Effect<Task, StoreError | OpError | TransitionError, Ledger> =>
  mutate(id, input.ifRevision, release);
