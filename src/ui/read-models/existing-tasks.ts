import path from "node:path";
import { requiredTierForRole } from "../../campaign/routing.js";
import type { JudgmentTier } from "../../campaign/types.js";
import type { ProjectContext } from "../../project/types.js";
import { validateSchema } from "../../schema/validate.js";
import { resolveAppPaths } from "../../state/app-paths.js";
import { syncBoundary } from "../../sync/boundaries.js";
import { SyncOutbox } from "../../sync/outbox.js";
import type { SyncIntent } from "../../sync/types.js";
import { createTaskSource } from "../../task-source/factory.js";
import { disposeTaskSource } from "../../task-source/task-source.js";
import type { TaskSourceCapabilities } from "../../task-source/types.js";

type NormalizedTask = {
  id: string;
  title: string;
  kind: "design" | "plan" | "implementation" | "review" | "verification" | "documentation" | "operations";
  priority: "P0" | "P1" | "P2" | "P3";
  status: string;
  nativeRevision: string;
  dependsOn: string[];
  source: { driver: string; nativeId: string; webUrl: string | null };
  workflow: {
    phase: "brainstorm" | "plan" | "execute" | "review" | "verification";
    designGate:
      | { required: false }
      | {
          required: true;
          defaultApproval: "human" | "delegated";
          delegable: boolean;
        };
  };
  execution: { effort: JudgmentTier; risk: string[] };
  coordination:
    | null
    | { scope: "local-clone"; campaignId: string; owner: string; claimedAt?: string };
  statusDetail?: { reason?: string } | null;
};

export type UiExistingTasksV1 = {
  schemaVersion: 1;
  refreshedAt: string;
  source: {
    driver: string;
    protocol: string;
    syncHealth: "fresh" | "stale" | "unavailable";
    pendingWrites: number;
    conflicts: number;
    lastError?: string;
  };
  coordinationNotice: "Local coordination only";
  leaseNotice: "No shared lease";
  tasks: Array<{
    id: string;
    title: string;
    kind: NormalizedTask["kind"];
    priority: NormalizedTask["priority"];
    status: "proposed" | "ready" | "claimed" | "in_review" | "blocked" | "completed" | "cancelled";
    readiness: "ready" | "blocked" | "claimed" | "ineligible" | "conflict";
    blockers: string[];
    workflowPhase: NormalizedTask["workflow"]["phase"];
    designGate: { required: boolean; mode: "human" | "delegated"; delegable: boolean };
    risk: string[];
    effort: JudgmentTier;
    suggestedRoute: { tier: JudgmentTier; label: string };
    source: { driver: string; nativeId: string; webUrl: string | null };
    nativeRevision: string;
    dependsOn: string[];
    coordination: { scope: "local-clone"; campaignId: string; owner: string } | null;
  }>;
};

const ROUTE_LABELS: Record<JudgmentTier, string> = {
  mechanical: "Mechanical",
  standard: "Composer 2.5",
  high: "High judgment",
  principal: "Principal review",
};

function isNormalizedTask(value: unknown): value is NormalizedTask {
  try {
    validateSchema("normalized-task-v1", value);
    return true;
  } catch {
    return false;
  }
}

function projectDesignGate(task: NormalizedTask) {
  const gate = task.workflow.designGate;
  if (!gate.required) return { required: false as const, mode: "human" as const, delegable: false };
  if (gate.defaultApproval === "delegated" && gate.delegable) {
    return { required: true as const, mode: "delegated" as const, delegable: true };
  }
  return { required: true as const, mode: "human" as const, delegable: gate.delegable };
}

function suggestedRoute(task: NormalizedTask) {
  const tier = requiredTierForRole("implementer", task.execution.effort, task.execution.risk);
  return { tier, label: ROUTE_LABELS[tier] };
}

function projectCoordination(task: NormalizedTask) {
  if (!task.coordination) return null;
  return {
    scope: task.coordination.scope,
    campaignId: task.coordination.campaignId,
    owner: task.coordination.owner,
  };
}

function dependencyBlockers(task: NormalizedTask, tasksById: ReadonlyMap<string, NormalizedTask>): string[] {
  const blockers: string[] = [];
  for (const dependencyId of task.dependsOn) {
    const dependency = tasksById.get(dependencyId);
    if (!dependency) blockers.push(`Missing dependency ${dependencyId}`);
    else if (dependency.status !== "completed") blockers.push(`Depends on ${dependencyId}`);
  }
  return blockers;
}

function designBlockers(task: NormalizedTask): string[] {
  const gate = task.workflow.designGate;
  if (!gate.required || task.status === "completed") return [];
  if (gate.defaultApproval === "delegated" && !gate.delegable) {
    return ["Design gate is non-delegable"];
  }
  return ["Design gate approval required"];
}

function readinessForTask(
  task: NormalizedTask,
  tasksById: ReadonlyMap<string, NormalizedTask>,
  conflictTaskIds: ReadonlySet<string>,
): { readiness: "ready" | "blocked" | "claimed" | "ineligible" | "conflict"; blockers: string[] } {
  if (task.status === "cancelled" || task.status === "completed") {
    return { readiness: "ineligible", blockers: [] };
  }
  if (task.status === "claimed") {
    return { readiness: "claimed", blockers: [] };
  }
  if (conflictTaskIds.has(task.id)) {
    return { readiness: "conflict", blockers: ["Sync conflict pending resolution"] };
  }
  const blockers = [
    ...dependencyBlockers(task, tasksById),
    ...designBlockers(task),
    ...(task.status === "blocked" && task.statusDetail?.reason ? [task.statusDetail.reason] : []),
    ...(task.status === "blocked" && !task.statusDetail?.reason ? ["Task is blocked"] : []),
  ];
  if (blockers.length > 0) return { readiness: "blocked", blockers };
  if (task.status === "proposed") return { readiness: "ineligible", blockers: [] };
  if (task.status === "ready" || task.status === "in_review") return { readiness: "ready", blockers: [] };
  return { readiness: "ineligible", blockers: [] };
}

function syncHealthFromIntents(intents: readonly SyncIntent[]): "fresh" | "stale" | "unavailable" {
  if (intents.some((intent) => intent.state === "failed")) return "unavailable";
  if (intents.some((intent) => intent.state === "pending" || intent.state === "conflict")) return "stale";
  return "fresh";
}

function projectTask(
  task: NormalizedTask,
  tasksById: ReadonlyMap<string, NormalizedTask>,
  conflictTaskIds: ReadonlySet<string>,
) {
  const { readiness, blockers } = readinessForTask(task, tasksById, conflictTaskIds);
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    priority: task.priority,
    status: task.status as UiExistingTasksV1["tasks"][number]["status"],
    readiness,
    blockers,
    workflowPhase: task.workflow.phase,
    designGate: projectDesignGate(task),
    risk: [...task.execution.risk],
    effort: task.execution.effort,
    suggestedRoute: suggestedRoute(task),
    source: {
      driver: task.source.driver,
      nativeId: task.source.nativeId,
      webUrl: task.source.webUrl,
    },
    nativeRevision: task.nativeRevision,
    dependsOn: [...task.dependsOn],
    coordination: projectCoordination(task),
  };
}

export async function buildExistingTasksProjection(
  context: ProjectContext,
  options: { now?: () => string; campaignId?: string } = {},
): Promise<UiExistingTasksV1> {
  const source = await createTaskSource(context);
  const now = options.now?.() ?? new Date().toISOString();
  try {
    const capabilities = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
    if (!capabilities.ok) {
      return validateSchema("ui-existing-tasks-v1", {
        schemaVersion: 1,
        refreshedAt: now,
        source: {
          driver: context.config.taskSource.driver,
          protocol: "task-source-v1",
          syncHealth: "unavailable",
          pendingWrites: 0,
          conflicts: 0,
          lastError: capabilities.error.message,
        },
        coordinationNotice: "Local coordination only",
        leaseNotice: "No shared lease",
        tasks: [],
      });
    }

    const capabilityData = capabilities.data as TaskSourceCapabilities;

    const listed = await source.execute({ schemaVersion: 1, operation: "list", input: {} });
    if (!listed.ok || listed.operation !== "list") {
      return validateSchema("ui-existing-tasks-v1", {
        schemaVersion: 1,
        refreshedAt: now,
        source: {
          driver: capabilityData.driver,
          protocol: capabilityData.protocol,
          syncHealth: "unavailable",
          pendingWrites: 0,
          conflicts: 0,
          lastError: listed.ok ? undefined : listed.error.message,
        },
        coordinationNotice: "Local coordination only",
        leaseNotice: "No shared lease",
        tasks: [],
      });
    }

    const summaries = (listed.data as { tasks: { id: string }[] }).tasks;
    const tasks: NormalizedTask[] = [];
    for (const summary of summaries) {
      const response = await source.execute({ schemaVersion: 1, operation: "show", taskId: summary.id, input: {} });
      if (!response.ok || !isNormalizedTask(response.data)) continue;
      tasks.push(response.data);
    }

    const appPaths = resolveAppPaths(context.repositoryId);
    const outbox = SyncOutbox.open(path.join(appPaths.repository, "sync", "outbox.jsonl"));
    await syncBoundary({
      boundary: "preflight",
      campaignId: options.campaignId ?? "ui-existing-tasks",
      outbox,
      source,
      taskIds: tasks.map((task) => task.id),
    });
    const intents = await outbox.listAll();
    const conflictTaskIds = new Set(intents.filter((intent) => intent.state === "conflict").map((intent) => intent.taskId));
    const tasksById = new Map(tasks.map((task) => [task.id, task]));

    return validateSchema("ui-existing-tasks-v1", {
      schemaVersion: 1,
      refreshedAt: now,
      source: {
        driver: capabilityData.driver,
        protocol: capabilityData.protocol,
        syncHealth: syncHealthFromIntents(intents),
        pendingWrites: intents.filter((intent) => intent.state === "pending").length,
        conflicts: intents.filter((intent) => intent.state === "conflict").length,
      },
      coordinationNotice: "Local coordination only",
      leaseNotice: "No shared lease",
      tasks: tasks
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .map((task) => projectTask(task, tasksById, conflictTaskIds)),
    });
  } finally {
    await disposeTaskSource(source);
  }
}
