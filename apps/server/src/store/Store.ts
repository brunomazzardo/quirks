// The one boundary that touches the JSON files.
//
// `Store` is where the ledger lives (repo root + `.quirks/`) plus the git pin a
// SourceRef needs. `Ledger` is the typed read/write surface over the three
// files. Nothing else in apps/server opens a ledger file; ops go through here.
//
// Ported from the bun-era src/store/store.ts (QK-MONO-003).

import { execFileSync } from "node:child_process";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type {
  Goal,
  GoalsFile,
  Run,
  RunMode,
  RunsFile,
  SourceRef,
  Task,
  TasksFile,
} from "@quirks/contracts";
import { loadJsonFile, saveJsonFile, StoreCorruptError, type StoreError } from "./JsonFile.ts";
import { ledgerDir } from "./LedgerPaths.ts";

const TASK_STATUSES = new Set(["open", "claimed", "blocked", "completed"]);
const GOAL_STATES = new Set(["active", "done", "abandoned"]);
const RUN_STATUSES = new Set(["planned", "approved", "running", "completed", "abandoned"]);
/** The run modes, exported because the /v1 boundary must refuse anything this
 *  store would later flag as corrupt — two spellings drift into a route that
 *  accepts a mode the ledger rejects. */
export const RUN_MODES: readonly RunMode[] = ["autonomous", "park-on-issue"];
const RUN_MODE_SET: ReadonlySet<string> = new Set(RUN_MODES);

export interface StoreShape {
  /** The repo root the ledger belongs to. */
  readonly root: string;
  /** `<root>/.quirks` — the committed ledger directory. */
  readonly dir: string;
  /** The commit a source is being read at, or null when there is none to pin. */
  readonly pinCommit: Effect.Effect<string | null>;
  readonly makeSourceRef: (path: string) => Effect.Effect<SourceRef>;
}

export class Store extends Context.Service<Store, StoreShape>()("quirks/Store") {}

function gitOutput(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not a git repo — the store still works; pins are just null.
    return null;
  }
}

/** The store lives in `.quirks/` at the repo root; cwd when not in a git repo. */
export function resolveRoot(cwd: string = process.cwd()): string {
  return gitOutput(cwd, ["rev-parse", "--show-toplevel"]) ?? cwd;
}

function makeStore(root: string): StoreShape {
  const pinCommit = Effect.sync(() => gitOutput(root, ["rev-parse", "HEAD"]));
  return {
    root,
    dir: ledgerDir(root),
    pinCommit,
    makeSourceRef: (path) => Effect.map(pinCommit, (pinnedCommit) => ({ path, pinnedCommit })),
  };
}

/** A store rooted at an explicit directory. Tests use this against temp dirs —
 *  the committed `.quirks/` is never a test target. */
export const layerAt = (root: string): Layer.Layer<Store> => Layer.succeed(Store, makeStore(root));

/** A store discovered from a working directory, the way the CLI and daemon do. */
export const layerFromCwd = (cwd?: string): Layer.Layer<Store> =>
  Layer.sync(Store, () => makeStore(resolveRoot(cwd)));

export interface LedgerShape {
  readonly loadTasks: Effect.Effect<Task[], StoreError>;
  readonly saveTasks: (tasks: readonly Task[]) => Effect.Effect<void, StoreError>;
  readonly loadGoals: Effect.Effect<Goal[], StoreError>;
  readonly saveGoals: (goals: readonly Goal[]) => Effect.Effect<void, StoreError>;
  readonly loadRuns: Effect.Effect<Run[], StoreError>;
  readonly saveRuns: (runs: readonly Run[]) => Effect.Effect<void, StoreError>;
}

export class Ledger extends Context.Service<Ledger, LedgerShape>()("quirks/Ledger") {}

const make = Effect.gen(function* () {
  const store = yield* Store;
  const path = yield* Path.Path;
  // Captured once so the Ledger's own effects carry no requirements: callers ask
  // for a ledger, not for a filesystem.
  const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const on = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    Effect.provideContext(effect, platform);
  const tasksPath = path.join(store.dir, "tasks.json");
  const goalsPath = path.join(store.dir, "goals.json");
  const runsPath = path.join(store.dir, "runs.json");

  const loadTasks = Effect.gen(function* () {
    const data = yield* loadJsonFile(tasksPath);
    if (Option.isNone(data)) return [];
    const file = data.value as TasksFile | null | undefined;
    if (file?.version !== 1 || !Array.isArray(file.tasks)) {
      return yield* Effect.fail(
        new StoreCorruptError({ path: tasksPath, detail: "not a version-1 tasks file" }),
      );
    }
    for (const t of file.tasks as ReadonlyArray<Task | null | undefined>) {
      if (typeof t?.id !== "string" || !TASK_STATUSES.has(t.status)) {
        return yield* Effect.fail(
          new StoreCorruptError({
            path: tasksPath,
            detail: `task ${JSON.stringify(t?.id)} has no valid id/status`,
          }),
        );
      }
    }
    return file.tasks;
  });

  const loadGoals = Effect.gen(function* () {
    const data = yield* loadJsonFile(goalsPath);
    if (Option.isNone(data)) return [];
    const file = data.value as GoalsFile | null | undefined;
    if (file?.version !== 1 || !Array.isArray(file.goals)) {
      return yield* Effect.fail(
        new StoreCorruptError({ path: goalsPath, detail: "not a version-1 goals file" }),
      );
    }
    for (const g of file.goals as ReadonlyArray<Goal | null | undefined>) {
      if (typeof g?.id !== "string" || !GOAL_STATES.has(g.state)) {
        return yield* Effect.fail(
          new StoreCorruptError({
            path: goalsPath,
            detail: `goal ${JSON.stringify(g?.id)} has no valid id/state`,
          }),
        );
      }
    }
    return file.goals;
  });

  const loadRuns = Effect.gen(function* () {
    const data = yield* loadJsonFile(runsPath);
    if (Option.isNone(data)) return [];
    const file = data.value as RunsFile | null | undefined;
    if (file?.version !== 1 || !Array.isArray(file.runs)) {
      return yield* Effect.fail(
        new StoreCorruptError({ path: runsPath, detail: "not a version-1 runs file" }),
      );
    }
    for (const r of file.runs as ReadonlyArray<Run | null | undefined>) {
      if (typeof r?.id !== "string" || !RUN_STATUSES.has(r.status) || !RUN_MODE_SET.has(r.mode)) {
        return yield* Effect.fail(
          new StoreCorruptError({
            path: runsPath,
            detail: `run ${JSON.stringify(r?.id)} has no valid id/status/mode`,
          }),
        );
      }
    }
    return file.runs;
  });

  return {
    loadTasks: on(loadTasks),
    saveTasks: (tasks) =>
      on(saveJsonFile(tasksPath, { version: 1, tasks: [...tasks] } satisfies TasksFile)),
    loadGoals: on(loadGoals),
    saveGoals: (goals) =>
      on(saveJsonFile(goalsPath, { version: 1, goals: [...goals] } satisfies GoalsFile)),
    loadRuns: on(loadRuns),
    saveRuns: (runs) =>
      on(saveJsonFile(runsPath, { version: 1, runs: [...runs] } satisfies RunsFile)),
  } satisfies LedgerShape;
});

export const layer: Layer.Layer<Ledger, never, Store | FileSystem.FileSystem | Path.Path> =
  Layer.effect(Ledger, make);
