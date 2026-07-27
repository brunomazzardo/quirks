// The one boundary that touches the JSON files. At bootstrap step 4 the Hono routes
// take this module over and the CLI stops importing it; nothing else ever grows a
// second path in.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ABSENT, loadJsonFile, saveJsonFile, StoreCorruptError } from "./json-file.ts";
import type { Goal, GoalsFile, SourceRef, Task, TasksFile } from "./types.ts";

const TASK_STATUSES = new Set(["open", "claimed", "blocked", "completed"]);
const GOAL_STATES = new Set(["active", "done", "abandoned"]);

export interface Store {
  root: string;
  dir: string;
}

/** The store lives in .quirks/ at the repo root; cwd when not in a git repo. */
export function openStore(cwd = process.cwd()): Store {
  let root = cwd;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not a git repo — the store still works; pins are just null.
  }
  return { root, dir: join(root, ".quirks") };
}

/** The commit a source is being read at, or null when there is none to pin. */
export function pinCommit(store: Store): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: store.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function makeSourceRef(store: Store, path: string): SourceRef {
  return { path, pinnedCommit: pinCommit(store) };
}

function tasksPath(store: Store): string {
  return join(store.dir, "tasks.json");
}

function goalsPath(store: Store): string {
  return join(store.dir, "goals.json");
}

export function loadTasks(store: Store): Task[] {
  const path = tasksPath(store);
  const data = loadJsonFile(path);
  if (data === ABSENT) return [];
  const file = data as TasksFile;
  if (file?.version !== 1 || !Array.isArray(file.tasks)) {
    throw new StoreCorruptError(path, "not a version-1 tasks file");
  }
  for (const t of file.tasks) {
    if (typeof t?.id !== "string" || !TASK_STATUSES.has(t?.status)) {
      throw new StoreCorruptError(path, `task ${JSON.stringify(t?.id)} has no valid id/status`);
    }
  }
  return file.tasks;
}

export function saveTasks(store: Store, tasks: Task[]): void {
  const file: TasksFile = { version: 1, tasks };
  saveJsonFile(tasksPath(store), file);
}

export function loadGoals(store: Store): Goal[] {
  const path = goalsPath(store);
  const data = loadJsonFile(path);
  if (data === ABSENT) return [];
  const file = data as GoalsFile;
  if (file?.version !== 1 || !Array.isArray(file.goals)) {
    throw new StoreCorruptError(path, "not a version-1 goals file");
  }
  for (const g of file.goals) {
    if (typeof g?.id !== "string" || !GOAL_STATES.has(g?.state)) {
      throw new StoreCorruptError(path, `goal ${JSON.stringify(g?.id)} has no valid id/state`);
    }
  }
  return file.goals;
}

export function saveGoals(store: Store, goals: Goal[]): void {
  const file: GoalsFile = { version: 1, goals };
  saveJsonFile(goalsPath(store), file);
}
