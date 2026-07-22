import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { QuirksError } from "../core/errors.js";
import { hasDurableApproval } from "./approval.js";
import { BudgetExceededError, BudgetTracker } from "./budgets.js";
import { evaluateCircuitBreakers, type CircuitBreakerDecision } from "./circuit-breakers.js";
import { classifyFailure, type FailureClass } from "./failures.js";
import { buildExecutionPlan, selectRunnableTasks, type ExecutionPlan } from "./scheduler.js";
import type { RunnerPort, WorktreePort, GitWorktreePort } from "./ports.js";
import type { CampaignStore } from "./store.js";
import type { CampaignApproval, CampaignEnvelope, CampaignStatus } from "./types.js";
import type { RunnerJobResult, RunnerProfile } from "../runner/types.js";
import type { RepositoryLockHandle } from "../state/types.js";
import { RepositoryLock } from "../state/repository-lock.js";
import { SessionRegistry } from "../runner/sessions.js";
import { syncBoundary } from "../sync/boundaries.js";
import { reconcileMutation } from "../sync/reconciler.js";
import type { SyncOutbox } from "../sync/outbox.js";
import type { TaskSource } from "../task-source/task-source.js";
import type { ResolvedRoute } from "./routing.js";

export interface CampaignSupervisorContext {
  store: CampaignStore;
  source: TaskSource;
  outbox: SyncOutbox;
  runner: RunnerPort;
  worktree: WorktreePort;
  lockPath: string;
  repositoryRoot: string;
  profileIndex?: ReadonlyMap<string, RunnerProfile>;
  now?: () => string;
}

export interface DispatchedJob {
  jobId: string;
  taskId: string;
  role: "supervisor" | "implementer" | "reviewer";
}

export interface SupervisorStatus {
  claimedTaskIds: readonly string[];
  dispatchedJobs: readonly DispatchedJob[];
}

export interface RunToCompletionOutcome {
  status: "completed" | "paused" | "hold" | "stopped";
  completedJobs: readonly DispatchedJob[];
  pausedLanes: readonly string[];
  breaker?: CircuitBreakerDecision;
}

function nowIso(context: CampaignSupervisorContext): string {
  return context.now?.() ?? new Date().toISOString();
}

function isGitWorktreePort(worktree: WorktreePort): worktree is GitWorktreePort {
  return typeof (worktree as GitWorktreePort).prepareReviewWorktree === "function";
}

type NormalizedSupervisorTask = {
  id: string;
  status: string;
  dependsOn: readonly string[];
  parallelismKeys: readonly string[];
  nativeRevision: string;
};

interface PreparedRun {
  envelope: CampaignEnvelope;
  plan: ExecutionPlan;
  planTaskIds: readonly string[];
  sessions: SessionRegistry;
}

interface TaskDispatchOutcome {
  taskId: string;
  attempt: number;
  implementer: RunnerJobResult;
  implementerRoute: ResolvedRoute;
  reviewer?: RunnerJobResult;
  reviewerRoute?: ResolvedRoute;
  candidateCommit?: string;
  jobs: readonly DispatchedJob[];
  startedAt: string;
  finishedAt: string;
}

// An attempt is accepted only when the implementer job succeeded AND, whenever a
// reviewer was dispatched for the attempt, the reviewer job succeeded as well.
function attemptSucceeded(outcome: TaskDispatchOutcome | undefined): boolean {
  if (!outcome || outcome.implementer.status !== "success") return false;
  return outcome.reviewer === undefined || outcome.reviewer.status === "success";
}

function attemptFailingResult(outcome: TaskDispatchOutcome): RunnerJobResult | undefined {
  if (outcome.implementer.status !== "success") return outcome.implementer;
  if (outcome.reviewer && outcome.reviewer.status !== "success") return outcome.reviewer;
  return undefined;
}

const NON_CLAIMABLE_STATUSES = new Set(["proposed", "blocked", "cancelled"]);

function routeForTask(
  envelope: CampaignEnvelope,
  taskId: string,
  role: "implementer" | "reviewer",
  profileIndex?: ReadonlyMap<string, RunnerProfile>,
): ResolvedRoute {
  const routing = envelope.routing[taskId];
  if (!routing) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Missing routing for task ${taskId}`);
  }
  const selected = role === "reviewer" && routing.fallbacks[0] ? routing.fallbacks[0] : routing.primary;
  const profile = profileIndex?.get(selected.profileId);
  return {
    profileId: selected.profileId,
    runnerType: profile?.runnerType ?? "cursor",
    tier: selected.tier,
    effort: selected.effort,
    quotaPoolId: profile?.quotaPoolId ?? "default",
  };
}

async function loadNormalizedTask(
  source: TaskSource,
  taskId: string,
  envelope: CampaignEnvelope,
): Promise<NormalizedSupervisorTask> {
  const show = await source.execute({
    schemaVersion: 1,
    operation: "show",
    taskId,
    input: {},
  });
  if (!show.ok || show.operation !== "show") {
    throw new QuirksError("PROTOCOL_VIOLATION", `Cannot show task ${taskId}`);
  }
  const data = show.data as {
    status: string;
    dependsOn: readonly string[];
    execution: { parallelismKeys?: readonly string[] };
  };
  const nativeRevision = show.nativeRevision ?? envelope.taskRevisions[taskId];
  if (!nativeRevision) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Missing revision for task ${taskId}`);
  }
  return {
    id: taskId,
    status: data.status,
    dependsOn: data.dependsOn,
    parallelismKeys: data.execution.parallelismKeys ?? [],
    nativeRevision,
  };
}

function elapsedMs(startedAt: string, finishedAt: string): number {
  const elapsed = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}

export class CampaignSupervisor {
  private lockHandle: RepositoryLockHandle | undefined;
  private readonly claimed = new Set<string>();
  private readonly dispatched: DispatchedJob[] = [];

  private constructor(private readonly context: CampaignSupervisorContext) {}

  static async open(context: CampaignSupervisorContext): Promise<CampaignSupervisor> {
    return new CampaignSupervisor(context);
  }

  async recordApproval(approval: CampaignApproval): Promise<void> {
    await this.context.store.appendApproval(approval);
  }

  async startApproved(): Promise<void> {
    const run = await this.prepareRun();
    const runnable = selectRunnableTasks(run.plan, new Set(), new Set());
    await this.journalWave(run, "wave.started", 0, runnable);
    const completed: string[] = [];
    for (const taskId of runnable) {
      const outcome = await this.dispatchTask(run, taskId, 1, "awaiting_approval");
      if (attemptSucceeded(outcome)) completed.push(taskId);
    }
    await this.journalWave(run, "wave.completed", 0, runnable, { completedTaskIds: completed.join(",") });
    await this.writeRunningState(run, new Set());
  }

  async runToCompletion(): Promise<RunToCompletionOutcome> {
    const run = await this.prepareRun();
    await this.writeRunningState(run, new Set());

    const budgets = run.envelope.budgets;
    const tracker = new BudgetTracker({
      maxTasks: budgets.maxTasks,
      maxWallClockMs: budgets.maxWallClockMs,
      maxRetries: budgets.maxRetries,
    });
    const completedTasks = new Set<string>();
    const pausedLanes = new Set<string>();
    const attempts = new Map<string, number>();
    const laneFailures = new Map<string, number>();
    const completedJobs: DispatchedJob[] = [];
    let lastLaneBreaker: CircuitBreakerDecision | undefined;
    let wave = 0;

    while (completedTasks.size < run.planTaskIds.length) {
      const runnable = selectRunnableTasks(run.plan, completedTasks, pausedLanes);
      if (runnable.length === 0) {
        const decision = lastLaneBreaker ?? { action: "pause_lane" as const, reason: "LANE_FAILURE_THRESHOLD" };
        return this.haltRun(run, "paused", "ALL_LANES_PAUSED", decision, completedJobs, pausedLanes);
      }

      for (const taskId of runnable) {
        if ((attempts.get(taskId) ?? 0) === 0) continue;
        try {
          tracker.recordRetry();
        } catch (error) {
          if (!(error instanceof BudgetExceededError)) throw error;
          const decision = evaluateCircuitBreakers(this.breakerInput(budgets, 0, undefined, true));
          return this.haltRun(run, "stopped", decision.reason, decision, completedJobs, pausedLanes);
        }
      }

      await this.journalWave(run, "wave.started", wave, runnable);
      const waveAttempts = runnable.map((taskId) => {
        const attempt = (attempts.get(taskId) ?? 0) + 1;
        attempts.set(taskId, attempt);
        return { taskId, attempt };
      });
      const settled = await Promise.allSettled(
        waveAttempts.map(({ taskId, attempt }) => this.dispatchTask(run, taskId, attempt, "running")),
      );

      let halting: CircuitBreakerDecision | undefined;
      const waveCompleted: string[] = [];
      for (const [index, { taskId }] of waveAttempts.entries()) {
        const entry = settled[index]!;
        const outcome = entry.status === "fulfilled" ? entry.value : undefined;
        const lanes = this.lanesForTask(run.plan, taskId);

        let budgetExceeded = false;
        try {
          tracker.recordTask({ wallClockMs: outcome ? elapsedMs(outcome.startedAt, outcome.finishedAt) : 0 });
        } catch (error) {
          if (!(error instanceof BudgetExceededError)) throw error;
          budgetExceeded = true;
        }

        const succeeded = attemptSucceeded(outcome);
        if (succeeded && outcome) {
          completedTasks.add(taskId);
          waveCompleted.push(taskId);
          for (const lane of lanes) laneFailures.set(lane, 0);
          completedJobs.push(...outcome.jobs);
        } else {
          for (const lane of lanes) laneFailures.set(lane, (laneFailures.get(lane) ?? 0) + 1);
        }

        const failingResult = outcome ? attemptFailingResult(outcome) : undefined;
        const failureClass: FailureClass | undefined = succeeded
          ? undefined
          : failingResult
            ? classifyFailure({ status: failingResult.status, failure: failingResult.failure })
            : "transient_runner";
        const consecutive = lanes.reduce((max, lane) => Math.max(max, laneFailures.get(lane) ?? 0), 0);
        const decision = evaluateCircuitBreakers(this.breakerInput(budgets, consecutive, failureClass, budgetExceeded));

        if (decision.action === "pause_lane") {
          lastLaneBreaker = decision;
          for (const lane of lanes) pausedLanes.add(lane);
          await this.journalLanePause(run, taskId, lanes, decision);
        } else if (decision.action !== "continue") {
          halting ??= decision;
        }

        if (succeeded && outcome) {
          await this.attachProvenance(run, outcome, "completed");
        } else if (outcome && outcome.implementer.status === "success" && outcome.reviewer) {
          // Implementer output existed but the reviewer rejected it: record the
          // attempt honestly instead of claiming acceptance.
          await this.attachProvenance(run, outcome, "failed");
        }
      }

      await this.journalWave(run, "wave.completed", wave, runnable, { completedTaskIds: waveCompleted.join(",") });

      if (halting) {
        const status = halting.action === "stop" ? "stopped" : halting.action === "hold" ? "hold" : "paused";
        return this.haltRun(run, status, halting.reason, halting, completedJobs, pausedLanes);
      }

      wave += 1;
    }

    return {
      status: "completed",
      completedJobs: [...completedJobs],
      pausedLanes: [...pausedLanes].toSorted(),
    };
  }

  async tick(): Promise<void> {
    // Orchestration ticks reconcile pending sync intents only in v1 slice.
    const envelope = await this.context.store.readEnvelope();
    await syncBoundary({
      boundary: "resume",
      campaignId: envelope.campaignId,
      outbox: this.context.outbox,
      source: this.context.source,
      taskIds: envelope.taskIds,
    });
  }

  async status(): Promise<SupervisorStatus> {
    return {
      claimedTaskIds: [...this.claimed],
      dispatchedJobs: [...this.dispatched],
    };
  }

  async stop(): Promise<void> {
    await this.lockHandle?.release();
    this.lockHandle = undefined;
  }

  private async prepareRun(): Promise<PreparedRun> {
    const envelope = await this.context.store.readEnvelope();
    if (!(await hasDurableApproval(this.context.store, envelope.digest))) {
      throw new QuirksError("PROTOCOL_VIOLATION", "APPROVAL_REQUIRED");
    }

    this.lockHandle = await RepositoryLock.acquire(this.context.lockPath, {
      campaignId: envelope.campaignId,
    });

    const boundary = await syncBoundary({
      boundary: "claim",
      campaignId: envelope.campaignId,
      outbox: this.context.outbox,
      source: this.context.source,
      taskIds: envelope.taskIds,
    });
    if (!boundary.ok) {
      throw new QuirksError("PROTOCOL_VIOLATION", boundary.blockedReason ?? "Sync boundary blocked claim");
    }

    const taskMeta = new Map<string, NormalizedSupervisorTask>();
    for (const taskId of envelope.taskIds) {
      taskMeta.set(taskId, await loadNormalizedTask(this.context.source, taskId, envelope));
    }

    for (const task of taskMeta.values()) {
      if (task.status === "completed") continue;
      if (NON_CLAIMABLE_STATUSES.has(task.status)) {
        throw new QuirksError("PROTOCOL_VIOLATION", `Task ${task.id} is ${task.status} and cannot be claimed`);
      }
      if (task.status !== "ready") {
        throw new QuirksError("PROTOCOL_VIOLATION", `Task ${task.id} is not ready to claim`);
      }
    }

    for (const task of taskMeta.values()) {
      if (task.status !== "ready") continue;
      await reconcileMutation({
        campaignId: envelope.campaignId,
        outbox: this.context.outbox,
        source: this.context.source,
        request: {
          schemaVersion: 1,
          operation: "claim",
          taskId: task.id,
          expectedNativeRevision: task.nativeRevision,
          idempotencyKey: `${envelope.campaignId}:claim:${task.id}`,
          input: {
            campaignId: envelope.campaignId,
            owner: "supervisor",
            claimedAt: nowIso(this.context),
          },
        },
      });
      this.claimed.add(task.id);
    }

    const completedIds = new Set(
      [...taskMeta.values()].filter((task) => task.status === "completed").map((task) => task.id),
    );
    const tasks = [...taskMeta.values()]
      .filter((task) => task.status !== "completed")
      .map((task) => ({
        id: task.id,
        dependsOn: task.dependsOn.filter((dependencyId) => !completedIds.has(dependencyId)),
        parallelismKeys: task.parallelismKeys.length > 0 ? task.parallelismKeys : [`task:${task.id}`],
        status: task.status,
      }));
    const plan = buildExecutionPlan(tasks, envelope.budgets);
    const sessions = await SessionRegistry.open(this.context.store);
    return { envelope, plan, planTaskIds: tasks.map((task) => task.id), sessions };
  }

  private lanesForTask(plan: ExecutionPlan, taskId: string): readonly string[] {
    return plan.lanes.filter((lane) => lane.taskOrder.includes(taskId)).map((lane) => lane.key);
  }

  private breakerInput(
    budgets: CampaignEnvelope["budgets"],
    consecutiveLaneFailures: number,
    failureClass: FailureClass | undefined,
    budgetExceeded: boolean,
  ) {
    return {
      laneFailureThreshold: budgets.laneFailureThreshold,
      consecutiveLaneFailures,
      integrationFailure: failureClass === "integration_failure",
      envelopeDrift: false,
      usageLimitWithoutReset: failureClass === "usage_limit",
      budgetExceeded,
      ambiguousAcceptedOrPushed: failureClass === "ambiguous_mutation" || failureClass === "post_push_ambiguity",
    };
  }

  private async dispatchTask(
    run: PreparedRun,
    taskId: string,
    attempt: number,
    implementerEventFrom: CampaignStatus,
  ): Promise<TaskDispatchOutcome> {
    const { envelope, sessions } = run;
    const startedAt = nowIso(this.context);
    const worktree = await this.context.worktree.prepareTaskWorktree(taskId, envelope.git.baseCommit);
    const route = routeForTask(envelope, taskId, "implementer", this.context.profileIndex);
    const jobId = `${envelope.campaignId}:${taskId}:implementer:${attempt}`;
    const briefPath = path.join(this.context.repositoryRoot, ".quirks", "briefs", `${taskId}.md`);
    await mkdir(path.dirname(briefPath), { recursive: true });
    await writeFile(briefPath, `# ${taskId}\n`, "utf8");

    const result = await this.context.runner.dispatch({
      jobId,
      taskId,
      role: "implementer",
      route,
      briefPath,
      worktreePath: worktree.path,
    });

    await sessions.register({
      jobId,
      role: "implementer",
      profileId: route.profileId,
      sessionHandle: result.sessionHandle,
      pid: process.pid,
      artifactPaths: [...result.artifactPaths],
    });

    await this.context.store.appendEvent({
      schemaVersion: 1,
      id: `dispatch:${jobId}`,
      type: "runner.dispatched",
      at: nowIso(this.context),
      actor: "supervisor",
      from: implementerEventFrom,
      to: "running",
      reason: "task_dispatched",
      evidence: { jobId, taskId, profileId: route.profileId },
    });

    const jobs: DispatchedJob[] = [{ jobId, taskId, role: "implementer" }];
    this.dispatched.push({ jobId, taskId, role: "implementer" });

    let reviewer: RunnerJobResult | undefined;
    let reviewerRoute: ResolvedRoute | undefined;
    let candidateCommit: string | undefined;
    // A reviewer is only dispatched when the implementer produced a candidate;
    // reviewing a failed implementer attempt would waste budget on no output.
    if (result.status === "success" && isGitWorktreePort(this.context.worktree)) {
      candidateCommit = await this.context.worktree.readCommit(worktree.path) ?? envelope.git.baseCommit;
      const reviewWorktree = await this.context.worktree.prepareReviewWorktree(taskId, candidateCommit);
      reviewerRoute = routeForTask(envelope, taskId, "reviewer", this.context.profileIndex);
      const reviewJobId = `${envelope.campaignId}:${taskId}:reviewer:${attempt}`;
      reviewer = await this.context.runner.dispatch({
        jobId: reviewJobId,
        taskId,
        role: "reviewer",
        route: reviewerRoute,
        briefPath,
        worktreePath: reviewWorktree.path,
      });

      await sessions.register({
        jobId: reviewJobId,
        role: "reviewer",
        profileId: reviewerRoute.profileId,
        sessionHandle: reviewer.sessionHandle,
        pid: process.pid,
        artifactPaths: [...reviewer.artifactPaths],
      });

      await this.context.store.appendEvent({
        schemaVersion: 1,
        id: `dispatch:${reviewJobId}`,
        type: "runner.dispatched",
        at: nowIso(this.context),
        actor: "supervisor",
        from: "running",
        to: "running",
        reason: "review_dispatched",
        evidence: { jobId: reviewJobId, taskId, profileId: reviewerRoute.profileId },
      });

      jobs.push({ jobId: reviewJobId, taskId, role: "reviewer" });
      this.dispatched.push({ jobId: reviewJobId, taskId, role: "reviewer" });
    }

    const finishedAt = nowIso(this.context);
    return {
      taskId,
      attempt,
      implementer: result,
      implementerRoute: route,
      ...(reviewer ? { reviewer } : {}),
      ...(reviewerRoute ? { reviewerRoute } : {}),
      ...(candidateCommit ? { candidateCommit } : {}),
      jobs,
      startedAt,
      finishedAt,
    };
  }

  private async journalWave(
    run: PreparedRun,
    type: "wave.started" | "wave.completed",
    wave: number,
    taskIds: readonly string[],
    extraEvidence: Record<string, string> = {},
  ): Promise<void> {
    await this.context.store.appendEvent({
      schemaVersion: 1,
      id: `wave:${wave}:${type === "wave.started" ? "started" : "completed"}`,
      type,
      at: nowIso(this.context),
      actor: "supervisor",
      from: "running",
      to: "running",
      reason: type === "wave.started" ? "wave_started" : "wave_completed",
      evidence: {
        campaignId: run.envelope.campaignId,
        wave: String(wave),
        taskIds: taskIds.join(",").slice(0, 4096),
        ...extraEvidence,
      },
    });
  }

  private async journalLanePause(
    run: PreparedRun,
    taskId: string,
    lanes: readonly string[],
    decision: CircuitBreakerDecision,
  ): Promise<void> {
    await this.context.store.appendEvent({
      schemaVersion: 1,
      id: `lane:paused:${taskId}:${nowIso(this.context)}`,
      type: "lane.paused",
      at: nowIso(this.context),
      actor: "supervisor",
      from: "running",
      to: "running",
      reason: decision.reason,
      evidence: {
        campaignId: run.envelope.campaignId,
        taskId,
        lanes: lanes.join(",").slice(0, 4096),
      },
    });
  }

  private async haltRun(
    run: PreparedRun,
    status: "paused" | "hold" | "stopped",
    reason: string,
    decision: CircuitBreakerDecision,
    completedJobs: readonly DispatchedJob[],
    pausedLanes: ReadonlySet<string>,
  ): Promise<RunToCompletionOutcome> {
    const toState: CampaignStatus = status === "hold" ? "hold" : "paused";
    const at = nowIso(this.context);
    await this.context.store.appendEvent({
      schemaVersion: 1,
      id: `campaign:${toState}:${at}`,
      type: toState === "hold" ? "campaign.hold" : "campaign.paused",
      at,
      actor: "supervisor",
      from: "running",
      to: toState,
      reason,
      evidence: {
        breakerAction: decision.action,
        breakerReason: decision.reason,
        pausedLanes: [...pausedLanes].toSorted().join(",").slice(0, 4096),
      },
    });
    await this.context.store.writeState({
      schemaVersion: 1,
      campaignId: run.envelope.campaignId,
      status: toState,
      digest: run.envelope.digest,
      updatedAt: nowIso(this.context),
      ...(toState === "paused" ? { pausedReason: reason } : {}),
      activeLanes: run.plan.lanes.map((lane) => lane.key).filter((key) => !pausedLanes.has(key)),
    });
    return {
      status,
      completedJobs: [...completedJobs],
      pausedLanes: [...pausedLanes].toSorted(),
      breaker: decision,
    };
  }

  private async writeRunningState(run: PreparedRun, pausedLanes: ReadonlySet<string>): Promise<void> {
    await this.context.store.writeState({
      schemaVersion: 1,
      campaignId: run.envelope.campaignId,
      status: "running",
      digest: run.envelope.digest,
      updatedAt: nowIso(this.context),
      activeLanes: run.plan.lanes.map((lane) => lane.key).filter((key) => !pausedLanes.has(key)),
    });
  }

  private async attachProvenance(
    run: PreparedRun,
    outcome: TaskDispatchOutcome,
    iterationOutcome: "completed" | "failed",
  ): Promise<void> {
    const task = await loadNormalizedTask(this.context.source, outcome.taskId, run.envelope);
    const iterationId = `${run.envelope.campaignId}.${outcome.taskId}.${outcome.attempt}`
      .replaceAll(":", "-")
      .slice(0, 128);
    const participants = [
      {
        role: "implementer",
        runner: outcome.implementerRoute.profileId,
        ...(outcome.implementer.sessionHandle ? { sessionRef: outcome.implementer.sessionHandle } : {}),
      },
      ...(outcome.reviewer && outcome.reviewerRoute
        ? [{
            role: "reviewer",
            runner: outcome.reviewerRoute.profileId,
            ...(outcome.reviewer.sessionHandle ? { sessionRef: outcome.reviewer.sessionHandle } : {}),
          }]
        : []),
    ];
    // acceptedCommit is only claimed for reviewer-approved attempts with a real
    // candidate commit; failed reviews record outcome "failed" with the verdict.
    const acceptedCommit =
      iterationOutcome === "completed" && outcome.candidateCommit && /^[a-f0-9]{40}$/.test(outcome.candidateCommit)
        ? outcome.candidateCommit
        : undefined;
    const outcomeReason =
      iterationOutcome === "failed" && outcome.reviewer
        ? `review_failed:${outcome.reviewer.status}${outcome.reviewer.failure ? `:${outcome.reviewer.failure.code}` : ""}`
        : undefined;
    await reconcileMutation({
      campaignId: run.envelope.campaignId,
      outbox: this.context.outbox,
      source: this.context.source,
      request: {
        schemaVersion: 1,
        operation: "attach-provenance",
        taskId: outcome.taskId,
        expectedNativeRevision: task.nativeRevision,
        idempotencyKey: `${run.envelope.campaignId}:provenance:${outcome.taskId}:${outcome.attempt}`,
        input: {
          iteration: {
            id: iterationId,
            campaignId: run.envelope.campaignId,
            envelopeDigest: run.envelope.digest,
            taskRevision: task.nativeRevision,
            outcome: iterationOutcome,
            completionBoundary: "accepted-commit",
            baseCommit: run.envelope.git.baseCommit,
            ...(acceptedCommit ? { acceptedCommit } : {}),
            ...(outcomeReason ? { outcomeReason } : {}),
            startedAt: outcome.startedAt,
            finishedAt: outcome.finishedAt,
            durationMs: elapsedMs(outcome.startedAt, outcome.finishedAt),
            retries: outcome.attempt - 1,
            participants,
          },
        },
      },
    });
  }
}
