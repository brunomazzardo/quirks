import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { QuirksError } from "../core/errors.js";
import { hasDurableApproval } from "./approval.js";
import { buildExecutionPlan, selectRunnableTasks } from "./scheduler.js";
import type { RunnerPort, WorktreePort, GitWorktreePort } from "./ports.js";
import type { CampaignStore } from "./store.js";
import type { CampaignApproval, CampaignEnvelope } from "./types.js";
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

function nowIso(context: CampaignSupervisorContext): string {
  return context.now?.() ?? new Date().toISOString();
}

function isGitWorktreePort(worktree: WorktreePort): worktree is GitWorktreePort {
  return typeof (worktree as GitWorktreePort).prepareReviewWorktree === "function";
}

function routeForTask(envelope: CampaignEnvelope, taskId: string): ResolvedRoute {
  const routing = envelope.routing[taskId];
  if (!routing) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Missing routing for task ${taskId}`);
  }
  return {
    profileId: routing.primary.profileId,
    runnerType: "cursor",
    tier: routing.primary.tier,
    effort: routing.primary.effort,
    quotaPoolId: "default",
  };
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

    for (const taskId of envelope.taskIds) {
      const show = await this.context.source.execute({
        schemaVersion: 1,
        operation: "show",
        taskId,
        input: {},
      });
      if (!show.ok || show.operation !== "show") {
        throw new QuirksError("PROTOCOL_VIOLATION", `Cannot show task ${taskId}`);
      }
      const nativeRevision = show.nativeRevision ?? envelope.taskRevisions[taskId];
      if (!nativeRevision) {
        throw new QuirksError("PROTOCOL_VIOLATION", `Missing revision for task ${taskId}`);
      }

      await reconcileMutation({
        campaignId: envelope.campaignId,
        outbox: this.context.outbox,
        source: this.context.source,
        request: {
          schemaVersion: 1,
          operation: "claim",
          taskId,
          expectedNativeRevision: nativeRevision,
          idempotencyKey: `${envelope.campaignId}:claim:${taskId}`,
          input: {
            campaignId: envelope.campaignId,
            owner: "supervisor",
            claimedAt: nowIso(this.context),
          },
        },
      });
      this.claimed.add(taskId);
    }

    const tasks = envelope.taskIds.map((taskId) => ({
      id: taskId,
      dependsOn: [] as string[],
      parallelismKeys: [`task:${taskId}`],
      status: "claimed",
    }));
    const plan = buildExecutionPlan(tasks, envelope.budgets);
    const runnable = selectRunnableTasks(plan, new Set(), new Set());

    const sessions = await SessionRegistry.open(this.context.store);
    for (const taskId of runnable) {
      const worktree = await this.context.worktree.prepareTaskWorktree(taskId, envelope.git.baseCommit);
      const route = routeForTask(envelope, taskId);
      const jobId = `${envelope.campaignId}:${taskId}:implementer:1`;
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

      const at = nowIso(this.context);
      await this.context.store.appendEvent({
        schemaVersion: 1,
        id: `dispatch:${jobId}`,
        type: "runner.dispatched",
        at,
        actor: "supervisor",
        from: "awaiting_approval",
        to: "running",
        reason: "task_dispatched",
        evidence: { jobId, taskId, profileId: route.profileId },
      });

      this.dispatched.push({ jobId, taskId, role: "implementer" });

      if (isGitWorktreePort(this.context.worktree)) {
        const candidateCommit = await this.context.worktree.readCommit(worktree.path) ?? envelope.git.baseCommit;
        const reviewWorktree = await this.context.worktree.prepareReviewWorktree(taskId, candidateCommit);
        const reviewJobId = `${envelope.campaignId}:${taskId}:reviewer:1`;
        const reviewResult = await this.context.runner.dispatch({
          jobId: reviewJobId,
          taskId,
          role: "reviewer",
          route,
          briefPath,
          worktreePath: reviewWorktree.path,
        });

        await sessions.register({
          jobId: reviewJobId,
          role: "reviewer",
          profileId: route.profileId,
          sessionHandle: reviewResult.sessionHandle,
          pid: process.pid,
          artifactPaths: [...reviewResult.artifactPaths],
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
          evidence: { jobId: reviewJobId, taskId, profileId: route.profileId },
        });

        this.dispatched.push({ jobId: reviewJobId, taskId, role: "reviewer" });
      }
    }

    await this.context.store.writeState({
      schemaVersion: 1,
      campaignId: envelope.campaignId,
      status: "running",
      digest: envelope.digest,
      updatedAt: nowIso(this.context),
      activeLanes: plan.lanes.map((lane) => lane.key),
    });
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
}
