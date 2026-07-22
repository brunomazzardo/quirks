import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { QuirksError } from "../core/errors.js";
import { sha256 } from "../core/hash.js";
import { loadProjectContext } from "../project/config.js";
import { loadRunnerProfiles } from "../runner/profiles.js";
import type { RunnerProfile } from "../runner/types.js";
import { createTaskSource } from "../task-source/factory.js";
import { disposeTaskSource, type TaskSource } from "../task-source/task-source.js";
import type { TaskSourceResponse } from "../task-source/types.js";
import { validateSchema } from "../schema/validate.js";
import { syncBoundary, type SyncBoundaryResult } from "../sync/boundaries.js";
import type { OutboxPort, SyncIntent, SyncState } from "../sync/types.js";
import { finalizeEnvelope } from "./envelope.js";
import { inspectGit } from "./git-inspect.js";
import { requiredTierForRole, resolveRoute, type RoutableProfile } from "./routing.js";
import type { CampaignEnvelope, CampaignRoute, JudgmentTier } from "./types.js";

type NormalizedTask = {
  id: string;
  kind: "design" | "plan" | "implementation" | "review" | "verification" | "documentation" | "operations";
  nativeRevision: string;
  dependsOn: string[];
  status: string;
  workflow: {
    designGate: { required: false } | {
      required: true;
      defaultApproval: "human" | "delegated";
      delegable: boolean;
      judgmentTier: JudgmentTier;
      decisionEnvelope: string[];
    };
  };
  execution: { effort: JudgmentTier; risk: string[]; completionBoundary: string };
  verification: string[];
};

const DEFAULT_MAX_RETRIES = 1;

export interface RunPreflightInput {
  repositoryRoot: string;
  selectedTaskIds: readonly string[];
  externalRoutingEnabled: boolean;
  campaignId?: string;
  mode?: "inspection" | "unattended";
  configDir?: string;
  push?: { enabled: boolean; remote?: string; branch?: string };
  maxConcurrency?: number;
}

export interface PreflightProposal {
  schemaVersion: 1;
  campaignId: string;
  taskIds: string[];
  blockers: string[];
  routing: CampaignEnvelope["routing"];
  dirtyRepository: boolean;
}

export interface PreflightResult {
  envelope: CampaignEnvelope;
  blockers: string[];
  proposal: PreflightProposal;
  syncHealth: SyncBoundaryResult;
  mutatedRepository: false;
}

class ReadOnlyOutbox implements OutboxPort {
  async enqueue(_intent: SyncIntent): Promise<void> { throw new QuirksError("PROTOCOL_VIOLATION", "Preflight cannot enqueue sync intents"); }
  async transition(_intentId: string, _state: SyncState, _acknowledgement?: TaskSourceResponse): Promise<void> {
    throw new QuirksError("PROTOCOL_VIOLATION", "Preflight cannot change sync intents");
  }
  async get(_intentId: string): Promise<SyncIntent | undefined> { return undefined; }
  async listPending(_campaignId?: string): Promise<SyncIntent[]> { return []; }
}

function isNormalizedTask(value: unknown): value is NormalizedTask {
  try {
    validateSchema<NormalizedTask>("normalized-task-v1", value);
    return true;
  } catch {
    return false;
  }
}

async function showTask(source: TaskSource, taskId: string): Promise<NormalizedTask> {
  const response = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  if (!response.ok) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Cannot include task ${taskId}: ${response.error.message}`);
  }
  if (!isNormalizedTask(response.data)) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Task source returned an invalid normalized task for ${taskId}`);
  }
  return response.data;
}

async function dependencyClosure(source: TaskSource, selectedTaskIds: readonly string[]): Promise<NormalizedTask[]> {
  if (selectedTaskIds.length === 0) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Preflight requires at least one selected task");
  }
  const tasks = new Map<string, NormalizedTask>();
  const visiting = new Set<string>();
  const visited = new Set<string>();

  async function visit(taskId: string): Promise<void> {
    if (visiting.has(taskId)) throw new QuirksError("PROTOCOL_VIOLATION", `Dependency cycle includes ${taskId}`);
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    const task = await showTask(source, taskId);
    tasks.set(task.id, task);
    for (const dependencyId of task.dependsOn) await visit(dependencyId);
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const taskId of selectedTaskIds) await visit(taskId);
  return [...tasks.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

function designMode(task: NormalizedTask): CampaignEnvelope["designModes"][string] {
  const gate = task.workflow.designGate;
  if (!gate.required) return { mode: "human-after-draft", envelope: [] };
  if (gate.defaultApproval === "delegated" && gate.delegable) return { mode: "delegated", envelope: [...gate.decisionEnvelope] };
  return { mode: "human", envelope: [...gate.decisionEnvelope] };
}

function placeholderRoute(task: NormalizedTask): { primary: CampaignRoute; fallbacks: CampaignRoute[] } {
  const { effort, risk } = task.execution;
  const implementerTier = requiredTierForRole("implementer", effort, risk);
  const reviewerTier = requiredTierForRole("reviewer", effort, risk);
  return {
    primary: { profileId: "placeholder", tier: implementerTier, effort },
    fallbacks: [{ profileId: "placeholder-reviewer", tier: reviewerTier, effort }],
  };
}

async function isProfileHealthy(profile: RunnerProfile): Promise<boolean> {
  try {
    await access(profile.executable, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function toRoutableProfiles(profiles: readonly RunnerProfile[]): Promise<RoutableProfile[]> {
  const routable: RoutableProfile[] = [];
  for (const profile of profiles) {
    routable.push({
      profileId: profile.profileId,
      runnerType: profile.runnerType,
      tier: profile.tier,
      effort: profile.effort,
      quotaPoolId: profile.quotaPoolId,
      healthy: await isProfileHealthy(profile),
      remainingAllocation: profile.wallClockMs,
    });
  }
  return routable;
}

function routeFromResolved(
  implementer: ReturnType<typeof resolveRoute>,
  reviewer: ReturnType<typeof resolveRoute>,
): { primary: CampaignRoute; fallbacks: CampaignRoute[] } {
  return {
    primary: {
      profileId: implementer.profileId,
      tier: implementer.tier,
      effort: implementer.effort,
    },
    fallbacks: [{
      profileId: reviewer.profileId,
      tier: reviewer.tier,
      effort: reviewer.effort,
    }],
  };
}

function resolveExternalRouting(
  tasks: readonly NormalizedTask[],
  routableProfiles: readonly RoutableProfile[],
  blockers: string[],
): Record<string, { primary: CampaignRoute; fallbacks: CampaignRoute[] }> {
  const routing: Record<string, { primary: CampaignRoute; fallbacks: CampaignRoute[] }> = {};
  for (const task of tasks) {
    if (task.status === "completed") {
      routing[task.id] = placeholderRoute(task);
      continue;
    }
    const taskShape = { id: task.id, effort: task.execution.effort, risk: task.execution.risk };
    try {
      const implementer = resolveRoute(taskShape, routableProfiles, { role: "implementer" });
      const reviewer = resolveRoute(taskShape, routableProfiles, {
        role: "reviewer",
        implementerRunnerType: implementer.runnerType,
      });
      routing[task.id] = routeFromResolved(implementer, reviewer);
    } catch (error) {
      if (error instanceof QuirksError && error.message === "NO_COMPATIBLE_ROUTE") {
        blockers.push(`No compatible runner profile for task ${task.id}`);
        routing[task.id] = placeholderRoute(task);
        continue;
      }
      throw error;
    }
  }
  return routing;
}

async function resolveRouting(
  input: RunPreflightInput,
  tasks: readonly NormalizedTask[],
  blockers: string[],
): Promise<Record<string, { primary: CampaignRoute; fallbacks: CampaignRoute[] }>> {
  if (!input.externalRoutingEnabled) {
    return Object.fromEntries(tasks.map((task) => [task.id, placeholderRoute(task)]));
  }

  try {
    const profiles = await loadRunnerProfiles(input.configDir ? { configDir: input.configDir } : {});
    const routableProfiles = await toRoutableProfiles(profiles);
    const unhealthy = routableProfiles.filter((profile) => !profile.healthy);
    for (const profile of unhealthy) {
      blockers.push(`Runner profile ${profile.profileId} is unhealthy or not executable`);
    }
    return resolveExternalRouting(tasks, routableProfiles, blockers);
  } catch (error) {
    if (error instanceof QuirksError && error.message.includes("Missing user configuration file profiles.json")) {
      blockers.push(error.message);
      return Object.fromEntries(tasks.map((task) => [task.id, placeholderRoute(task)]));
    }
    throw error;
  }
}

function preflightBlockers(tasks: readonly NormalizedTask[]): string[] {
  const blockers: string[] = [];
  for (const task of tasks) {
    if (task.kind === "design" && task.status !== "completed") {
      blockers.push(`Task ${task.id} is a required design dependency without an approved plan dependency`);
    }
    if (task.workflow.designGate.required && task.workflow.designGate.defaultApproval === "delegated" && !task.workflow.designGate.delegable) {
      blockers.push(`Task ${task.id} is non-delegable and cannot use delegated design mode`);
    }
  }
  return blockers;
}

export async function runPreflight(input: RunPreflightInput): Promise<PreflightResult> {
  const mode = input.mode ?? "inspection";
  const maxConcurrency = input.maxConcurrency ?? 1;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 1000) {
    throw new QuirksError("PROTOCOL_VIOLATION", "maxConcurrency must be an integer between 1 and 1000");
  }
  const context = await loadProjectContext(input.repositoryRoot, { mode });
  const source = await createTaskSource(context);
  try {
    const tasks = await dependencyClosure(source, input.selectedTaskIds);
    const campaignId = input.campaignId ?? `cmp-${sha256({ repositoryId: context.repositoryId, taskIds: tasks.map((task) => task.id) }).slice(7, 19)}`;
    const syncHealth = await syncBoundary({
      boundary: "preflight",
      campaignId,
      outbox: new ReadOnlyOutbox(),
      source,
      taskIds: tasks.map((task) => task.id),
    });
    const git = await inspectGit(context.root, { mode });
    const blockers = preflightBlockers(tasks);
    if (syncHealth.pendingIntents.length > 0) blockers.push("Pending sync intents must be reconciled before campaign approval");
    const routing = await resolveRouting(input, tasks, blockers);
    const envelope = finalizeEnvelope({
      schemaVersion: 1,
      campaignId,
      repositoryId: context.repositoryId,
      createdAt: new Date().toISOString(),
      taskIds: tasks.map((task) => task.id),
      taskRevisions: Object.fromEntries(tasks.map((task) => [task.id, task.nativeRevision])),
      designModes: Object.fromEntries(tasks.map((task) => [task.id, designMode(task)])),
      git: {
        baseCommit: git.baseCommit,
        campaignBranch: `quirks/${campaignId}/integration`,
        targetBranch: git.branch ?? "main",
        push: input.push ?? { enabled: false },
      },
      authority: ["repository", "task-source", "operator", "git"],
      routing,
      // The supervisor charges every dispatch attempt (including retries) against
      // maxTasks, so the budget reserves maxRetries slots of headroom beyond the
      // first attempts; retry frequency itself stays bounded by maxRetries.
      budgets: {
        maxTasks: Math.min(10_000, Math.max(1, tasks.length) + DEFAULT_MAX_RETRIES),
        maxConcurrency,
        maxWallClockMs: 3_600_000,
        maxRetries: DEFAULT_MAX_RETRIES,
        laneFailureThreshold: 2,
      },
      verification: [...new Set(tasks.flatMap((task) => task.verification))],
      hashes: {
        config: context.configHash,
        workflowPolicy: sha256(context.effectiveWorkflowPolicy),
        instructions: sha256(context.config.workflowPolicy.skills),
      },
      externalRoutingEnabled: input.externalRoutingEnabled,
    });
    return {
      envelope,
      blockers,
      proposal: { schemaVersion: 1, campaignId, taskIds: envelope.taskIds, blockers, routing, dirtyRepository: git.dirty },
      syncHealth,
      mutatedRepository: false,
    };
  } finally {
    await disposeTaskSource(source);
  }
}
