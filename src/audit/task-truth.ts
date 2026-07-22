import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadProjectContext } from "../project/config.js";
import { resolveAppPaths } from "../state/app-paths.js";
import { SyncOutbox } from "../sync/outbox.js";
import { validateSchema } from "../schema/validate.js";

const execFileAsync = promisify(execFile);

const WAVE7_FALSE_COMPLETION_IDS = [
  "QK-HOST-004A",
  "QK-HOST-004B",
  "QK-HOST-004C",
  "QK-HOST-005A",
  "QK-HOST-005B",
  "QK-RELEASE-REV",
] as const;

const DGF_REPAIR_SEQUENCE = [
  "QK-DGF-002A",
  "QK-DGF-002B",
  "QK-DGF-002C",
  "QK-DGF-002D",
  "QK-DGF-002E",
  "QK-DGF-002F",
  "QK-DGF-002G",
] as const;

type TaskRecord = {
  id: string;
  status: string;
  dependsOn?: string[];
  kind?: string;
  provenance?: {
    iterations?: Array<{
      id?: string;
      outcome?: string;
      acceptedCommit?: string;
      landedCommit?: string;
      commitRefs?: string[];
    }>;
  };
};

type TaskEnvelope = {
  schemaVersion: 1;
  tasks: TaskRecord[];
};

export interface TaskTruthAuditOptions {
  repositoryRoot: string;
  targetRef?: string;
}

export interface TaskTruthAuditResult {
  errors: string[];
}

async function readTaskEnvelope(repositoryRoot: string): Promise<TaskEnvelope> {
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  if (context.config.taskSource.driver !== "json") {
    throw new Error("Task truth audit requires a JSON task source");
  }
  const raw = await readFile(path.join(repositoryRoot, context.config.taskSource.path), "utf8");
  return validateSchema<TaskEnvelope>("json-task-file-v1", JSON.parse(raw) as unknown);
}

async function readPendingSyncCount(repositoryRoot: string): Promise<number> {
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  const appPaths = resolveAppPaths(context.repositoryId);
  const outbox = SyncOutbox.open(path.join(appPaths.repository, "sync-outbox.jsonl"));
  const intents = await outbox.listAll();
  return intents.filter((intent) => intent.state === "pending").length;
}

async function isReachable(repositoryRoot: string, commit: string, targetRef: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", commit, targetRef], { cwd: repositoryRoot });
    return true;
  } catch {
    return false;
  }
}

function latestAuthoritativeOutcome(task: TaskRecord): string | undefined {
  const iterations = task.provenance?.iterations ?? [];
  for (let index = iterations.length - 1; index >= 0; index -= 1) {
    const outcome = iterations[index]?.outcome;
    if (outcome && outcome !== "superseded") return outcome;
  }
  return undefined;
}

function collectAcceptedCommits(task: TaskRecord): string[] {
  const commits = new Set<string>();
  for (const iteration of task.provenance?.iterations ?? []) {
    if (iteration.outcome === "superseded") continue;
    if (typeof iteration.acceptedCommit === "string") commits.add(iteration.acceptedCommit);
    if (typeof iteration.landedCommit === "string") commits.add(iteration.landedCommit);
    for (const commit of iteration.commitRefs ?? []) {
      if (typeof commit === "string") commits.add(commit);
    }
  }
  return [...commits];
}

const AGGREGATE_PARENTS: Readonly<Record<string, readonly string[]>> = {
  "QK-HOST-004": ["QK-HOST-004A", "QK-HOST-004B", "QK-HOST-004C"],
  "QK-HOST-005": ["QK-HOST-005A", "QK-HOST-005B"],
  "QK-DGF-002": ["QK-DGF-002G"],
};

function aggregateChildStatuses(parentId: string, tasksById: Map<string, TaskRecord>): string[] {
  const childIds = AGGREGATE_PARENTS[parentId] ?? [];
  return childIds
    .map((childId) => tasksById.get(childId))
    .filter((child): child is TaskRecord => Boolean(child))
    .map((child) => child.status);
}

export async function auditTaskTruth(options: TaskTruthAuditOptions): Promise<TaskTruthAuditResult> {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const targetRef = options.targetRef ?? "codex/qk-dgf-002";
  const errors: string[] = [];

  const pending = await readPendingSyncCount(repositoryRoot);
  if (pending > 0) {
    errors.push(`pending_sync=${pending}`);
  }

  const envelope = await readTaskEnvelope(repositoryRoot);
  const tasksById = new Map(envelope.tasks.map((task) => [task.id, task]));

  for (const taskId of WAVE7_FALSE_COMPLETION_IDS) {
    const task = tasksById.get(taskId);
    if (!task) {
      errors.push(`missing wave7 task ${taskId}`);
      continue;
    }
    if (task.status === "completed") {
      errors.push(`${taskId} is completed but overnight release evidence is blocked`);
      continue;
    }
    if (task.status !== "blocked") {
      errors.push(`${taskId} must be blocked after corrective reconciliation`);
    }
    const latest = latestAuthoritativeOutcome(task);
    if (latest !== "blocked") {
      errors.push(`${taskId} lacks corrective blocked provenance`);
    }
  }

  for (const taskId of DGF_REPAIR_SEQUENCE) {
    const task = tasksById.get(taskId);
    if (!task) {
      errors.push(`missing repair task ${taskId}`);
      continue;
    }
    if (task.status !== "completed") {
      errors.push(`${taskId} must be completed after repair reconciliation`);
      continue;
    }
    const latest = latestAuthoritativeOutcome(task);
    if (latest !== "completed") {
      errors.push(`${taskId} lacks completed provenance`);
    }
    for (const commit of collectAcceptedCommits(task)) {
      if (!(await isReachable(repositoryRoot, commit, targetRef))) {
        errors.push(`${taskId} accepted commit ${commit} is not reachable from ${targetRef}`);
      }
    }
  }

  const umbrella = tasksById.get("QK-DGF-002");
  if (!umbrella) {
    errors.push("missing umbrella task QK-DGF-002");
  } else if (umbrella.status !== "completed") {
    errors.push("QK-DGF-002 umbrella must be completed after repair reconciliation");
  }

  for (const [aggregateParentId, childStatuses] of Object.entries(AGGREGATE_PARENTS).map(([id]) => {
    const parent = tasksById.get(id);
    if (!parent) return [id, [] as string[]] as const;
    return [id, aggregateChildStatuses(id, tasksById)] as const;
  })) {
    if (childStatuses.length === 0) continue;
    const parent = tasksById.get(aggregateParentId);
    if (!parent) continue;
    const allChildrenCompleted = childStatuses.every((status) => status === "completed");
    if (allChildrenCompleted && (parent.status === "proposed" || parent.status === "ready")) {
      errors.push(`${aggregateParentId} aggregate parent is ${parent.status} after all children completed`);
    }
  }

  return { errors };
}
