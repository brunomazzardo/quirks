import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { CampaignSupervisor, type CampaignSupervisorContext } from "../../src/campaign/supervisor.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { SessionRegistry } from "../../src/runner/sessions.js";
import { RepositoryLock } from "../../src/state/repository-lock.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import type { CampaignEnvelope } from "../../src/campaign/types.js";
import type { RunnerPort } from "../../src/campaign/ports.js";
import { FakeTaskSource } from "../task-source/fake-source.js";
import { campaignEnvelope } from "./support.js";
import { FakeRunnerPort } from "./support/fake-runner-port.js";
import { FakeWorktreePort } from "./support/fake-worktree.js";

interface TestContextOptions {
  taskIds?: readonly string[];
  taskRevisions?: Record<string, string>;
  routing?: CampaignEnvelope["routing"];
  budgets?: CampaignEnvelope["budgets"];
  source?: FakeTaskSource;
  runner?: RunnerPort;
  worktree?: FakeWorktreePort;
  now?: () => string;
}

async function testContext(options: TestContextOptions = {}): Promise<CampaignSupervisorContext> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-supervisor-"));
  const lockDir = await mkdtemp(path.join(os.tmpdir(), "quirks-supervisor-lock-"));
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-supervisor-repo-"));
  await mkdir(path.join(repositoryRoot, ".quirks"), { recursive: true });
  await writeFile(path.join(repositoryRoot, ".quirks/tasks.json"), '{"tasks":[]}\n', "utf8");

  const taskIds = options.taskIds ?? ["QK-1"];
  const source = options.source ?? new FakeTaskSource();
  const taskRevisions = options.taskRevisions ?? Object.fromEntries(taskIds.map((taskId) => [taskId, source.taskRevision(taskId)]));

  const incomplete = campaignEnvelope({
    campaignId: "cmp-supervisor",
    taskIds: [...taskIds],
    taskRevisions,
    ...(options.budgets ? { budgets: options.budgets } : {}),
    routing: options.routing ?? {
      "QK-1": {
        primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
        fallbacks: [],
      },
    },
  });
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  const store = await CampaignStore.create({
    stateDir,
    repositoryId: envelope.repositoryId,
    campaignId: envelope.campaignId,
    envelope,
  });
  const outbox = SyncOutbox.open(store.syncOutboxFile);

  return {
    store,
    source,
    outbox,
    runner: options.runner ?? new FakeRunnerPort(),
    worktree: options.worktree ?? new FakeWorktreePort(),
    lockPath: path.join(lockDir, "repository.lock"),
    repositoryRoot,
    ...(options.now ? { now: options.now } : {}),
  };
}

async function recordApproval(context: CampaignSupervisorContext): Promise<void> {
  const envelope = await context.store.readEnvelope();
  const challenge = createApprovalChallenge({
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    ttlMs: 60_000,
  });
  await consumeApprovalToken({
    store: context.store,
    token: challenge.token,
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    operator: { kind: "configured-profile", id: "operator@test" },
  });
}

test("refuses claim before durable approval exists", async () => {
  const supervisor = await CampaignSupervisor.open(await testContext());
  await assert.rejects(() => supervisor.startApproved(), /APPROVAL_REQUIRED/);
});

test("claims and dispatches only approved tasks after approval", async () => {
  const context = await testContext();
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();
  const status = await supervisor.status();
  assert.equal(status.claimedTaskIds.includes("QK-1"), true);
  assert.equal(status.dispatchedJobs.filter((job) => job.role === "implementer").length, 1);
  assert.equal(status.dispatchedJobs[0]?.taskId, "QK-1");
  const state = await context.store.readState();
  assert.equal(state.status, "running");
});

test("acquires repository lock during startApproved", async () => {
  const context = await testContext();
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();
  await assert.rejects(
    () => RepositoryLock.acquire(context.lockPath, { campaignId: "other-campaign" }),
    /LOCAL_LOCK_HELD|LOCK_NOT_OWNED/i,
  );
  await supervisor.stop();
});

test("records reviewer session and audit metadata with reviewer profile", async () => {
  const implementerProfileId = "cursor-implementer";
  const reviewerProfileId = "claude-reviewer";
  const source = new FakeTaskSource();
  const runner = new FakeRunnerPort();
  const context = await testContext({
    routing: {
      "QK-1": {
        primary: { profileId: implementerProfileId, tier: "standard", effort: "standard" },
        fallbacks: [{ profileId: reviewerProfileId, tier: "high", effort: "standard" }],
      },
    },
    source,
    runner,
    worktree: new FakeWorktreePort(),
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();

  const sessions = await SessionRegistry.open(context.store);
  const reviewerSession = (await sessions.list()).find((session) => session.role === "reviewer");
  assert.ok(reviewerSession, "expected reviewer session to be registered");
  assert.equal(reviewerSession.profileId, reviewerProfileId);
  assert.notEqual(reviewerSession.profileId, implementerProfileId);

  const reviewEvent = (await context.store.readEvents()).find((event) => event.reason === "review_dispatched");
  assert.ok(reviewEvent, "expected review_dispatched event");
  assert.equal(reviewEvent.evidence?.profileId, reviewerProfileId);
  assert.notEqual(reviewEvent.evidence?.profileId, implementerProfileId);

  const reviewerDispatch = runner.dispatches.find((dispatch) => dispatch.role === "reviewer");
  assert.equal(reviewerDispatch?.route.profileId, reviewerProfileId);
});

test("fetches normalized task metadata before claim decisions", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-1", { status: "ready" });
  const context = await testContext({ source });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();
  assert.equal(source.showCalls.includes("QK-1"), true);
});

test("skips completed dependencies when building scheduler", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-1", { status: "completed" });
  source.upsertTask("QK-2", {
    status: "ready",
    dependsOn: ["QK-1"],
    execution: {
      effort: "standard",
      risk: [],
      capabilities: ["repository-write"],
      parallelismKeys: ["lane-shared"],
      humanGates: [],
      completionBoundary: "accepted-commit",
    },
  });
  const context = await testContext({
    taskIds: ["QK-1", "QK-2"],
    taskRevisions: {
      "QK-1": source.taskRevision("QK-1"),
      "QK-2": source.taskRevision("QK-2"),
    },
    budgets: { maxTasks: 2, maxConcurrency: 2, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: {
      "QK-1": {
        primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
        fallbacks: [],
      },
      "QK-2": {
        primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
        fallbacks: [],
      },
    },
    source,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();
  const status = await supervisor.status();
  assert.equal(status.claimedTaskIds.includes("QK-2"), true);
  assert.equal(status.dispatchedJobs.some((job) => job.taskId === "QK-2"), true);
});

for (const status of ["proposed", "blocked", "cancelled"] as const) {
  test(`rejects ${status} tasks during claim`, async () => {
    const source = new FakeTaskSource();
    source.upsertTask("QK-1", { status });
    const context = await testContext({ source });
    const supervisor = await CampaignSupervisor.open(context);
    await recordApproval(context);
    await assert.rejects(() => supervisor.startApproved(), new RegExp(`Task QK-1 is ${status}`));
  });
}

test("rejects non-ready tasks that are not completed", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-1", { status: "claimed" });
  const context = await testContext({ source });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await assert.rejects(() => supervisor.startApproved(), /Task QK-1 is not ready to claim/);
});

test("claims only ready tasks in mixed envelopes", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-1", { status: "completed" });
  source.upsertTask("QK-2", { status: "ready" });
  const context = await testContext({
    taskIds: ["QK-1", "QK-2"],
    taskRevisions: {
      "QK-1": source.taskRevision("QK-1"),
      "QK-2": source.taskRevision("QK-2"),
    },
    budgets: { maxTasks: 2, maxConcurrency: 2, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: {
      "QK-1": {
        primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
        fallbacks: [],
      },
      "QK-2": {
        primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
        fallbacks: [],
      },
    },
    source,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();
  const status = await supervisor.status();
  assert.deepEqual(status.claimedTaskIds, ["QK-2"]);
});

function standardRoute(taskIds: readonly string[]): CampaignEnvelope["routing"] {
  return Object.fromEntries(taskIds.map((taskId) => [taskId, {
    primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
    fallbacks: [],
  }])) as CampaignEnvelope["routing"];
}

function executionFor(parallelismKeys: readonly string[]) {
  return {
    effort: "standard",
    risk: [],
    capabilities: ["repository-write"],
    parallelismKeys: [...parallelismKeys],
    humanGates: [],
    completionBoundary: "accepted-commit",
  };
}

test("runToCompletion drives a two-wave DAG to completion in one call", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor([]) });
  source.upsertTask("QK-B", { status: "ready", dependsOn: ["QK-A"], execution: executionFor([]) });
  const context = await testContext({
    taskIds: ["QK-A", "QK-B"],
    taskRevisions: {
      "QK-A": source.taskRevision("QK-A"),
      "QK-B": source.taskRevision("QK-B"),
    },
    budgets: { maxTasks: 2, maxConcurrency: 1, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A", "QK-B"]),
    source,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.breaker, undefined);
  assert.deepEqual(outcome.pausedLanes, []);
  const completedImplementers = outcome.completedJobs.filter((job) => job.role === "implementer");
  assert.deepEqual(completedImplementers.map((job) => job.taskId), ["QK-A", "QK-B"]);

  const status = await supervisor.status();
  assert.equal(status.dispatchedJobs.filter((job) => job.role === "implementer").length, 2);
  const implementerOrder = status.dispatchedJobs.filter((job) => job.role === "implementer").map((job) => job.taskId);
  assert.deepEqual(implementerOrder, ["QK-A", "QK-B"]);

  const events = await context.store.readEvents();
  const waveStarted = events.filter((event) => event.type === "wave.started");
  assert.equal(waveStarted.length, 2);
  assert.equal(waveStarted[0]?.evidence["taskIds"], "QK-A");
  assert.equal(waveStarted[1]?.evidence["taskIds"], "QK-B");
  const waveCompleted = events.filter((event) => event.type === "wave.completed");
  assert.equal(waveCompleted.length, 2);
  await supervisor.stop();
});

class OverlapRecordingRunnerPort implements RunnerPort {
  private implementersInFlight = 0;
  maxImplementerOverlap = 0;
  readonly dispatchedJobIds: string[] = [];

  async dispatch(input: {
    jobId: string;
    taskId: string;
    role: "supervisor" | "implementer" | "reviewer";
    route: { profileId: string; runnerType: "claude" | "codex" | "cursor"; effort: string };
  }) {
    this.dispatchedJobIds.push(input.jobId);
    if (input.role === "implementer") {
      this.implementersInFlight += 1;
      this.maxImplementerOverlap = Math.max(this.maxImplementerOverlap, this.implementersInFlight);
      await new Promise((resolve) => setTimeout(resolve, 25));
      this.implementersInFlight -= 1;
    }
    return {
      schemaVersion: 1 as const,
      jobId: input.jobId,
      runner: input.route.profileId,
      runnerType: input.route.runnerType,
      resolvedModel: "test-model",
      effort: input.route.effort,
      status: "success" as const,
      sessionHandle: "overlap-session",
      artifactPaths: [],
      usage: {},
      failure: undefined,
    };
  }
}

test("runToCompletion dispatches waves concurrently within envelope maxConcurrency", async () => {
  const source = new FakeTaskSource();
  for (const taskId of ["QK-A", "QK-B", "QK-C"]) {
    source.upsertTask(taskId, { status: "ready", execution: executionFor([`lane-${taskId}`]) });
  }
  const runner = new OverlapRecordingRunnerPort();
  const context = await testContext({
    taskIds: ["QK-A", "QK-B", "QK-C"],
    taskRevisions: Object.fromEntries(["QK-A", "QK-B", "QK-C"].map((taskId) => [taskId, source.taskRevision(taskId)])),
    budgets: { maxTasks: 3, maxConcurrency: 2, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A", "QK-B", "QK-C"]),
    source,
    runner,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "completed");
  assert.equal(runner.maxImplementerOverlap, 2);

  const events = await context.store.readEvents();
  const waveStarted = events.filter((event) => event.type === "wave.started");
  assert.equal(waveStarted.length, 2);
  assert.equal(waveStarted[0]?.evidence["taskIds"], "QK-A,QK-B");
  assert.equal(waveStarted[1]?.evidence["taskIds"], "QK-C");
  await supervisor.stop();
});

function steppingClock(startMs: number, stepMs: number): () => string {
  let current = startMs;
  return () => {
    current += stepMs;
    return new Date(current).toISOString();
  };
}

test("runToCompletion stops on exhausted wall-clock budget without further dispatch", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor([]) });
  source.upsertTask("QK-B", { status: "ready", dependsOn: ["QK-A"], execution: executionFor([]) });
  const runner = new FakeRunnerPort();
  const context = await testContext({
    taskIds: ["QK-A", "QK-B"],
    taskRevisions: {
      "QK-A": source.taskRevision("QK-A"),
      "QK-B": source.taskRevision("QK-B"),
    },
    budgets: { maxTasks: 2, maxConcurrency: 1, maxWallClockMs: 60_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A", "QK-B"]),
    source,
    runner,
    now: steppingClock(Date.parse("2026-07-22T00:00:00.000Z"), 120_000),
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "stopped");
  assert.deepEqual(outcome.breaker, { action: "stop", reason: "BUDGET_EXCEEDED" });
  assert.equal(runner.dispatches.every((dispatch) => dispatch.taskId === "QK-A"), true);
  assert.equal(runner.dispatches.some((dispatch) => dispatch.taskId === "QK-B"), false);

  const state = await context.store.readState();
  assert.equal(state.status, "paused");
  assert.equal(state.pausedReason, "BUDGET_EXCEEDED");

  const events = await context.store.readEvents();
  const paused = events.find((event) => event.type === "campaign.paused");
  assert.ok(paused, "expected campaign.paused event");
  assert.equal(paused.reason, "BUDGET_EXCEEDED");
  assert.equal(paused.evidence["breakerAction"], "stop");
  await supervisor.stop();
});

test("builds scheduler with real dependsOn and parallelismKeys", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-1", {
    status: "ready",
    dependsOn: [],
    execution: {
      effort: "standard",
      risk: [],
      capabilities: ["repository-write"],
      parallelismKeys: ["custom-lane"],
      humanGates: [],
      completionBoundary: "accepted-commit",
    },
  });
  source.upsertTask("QK-2", {
    status: "ready",
    dependsOn: ["QK-1"],
    execution: {
      effort: "standard",
      risk: [],
      capabilities: ["repository-write"],
      parallelismKeys: ["custom-lane"],
      humanGates: [],
      completionBoundary: "accepted-commit",
    },
  });
  const context = await testContext({
    taskIds: ["QK-1", "QK-2"],
    taskRevisions: {
      "QK-1": source.taskRevision("QK-1"),
      "QK-2": source.taskRevision("QK-2"),
    },
    budgets: { maxTasks: 2, maxConcurrency: 1, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: {
      "QK-1": {
        primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
        fallbacks: [],
      },
      "QK-2": {
        primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
        fallbacks: [],
      },
    },
    source,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();
  const state = await context.store.readState();
  assert.equal(state.activeLanes?.includes("custom-lane"), true);
  const status = await supervisor.status();
  assert.equal(status.dispatchedJobs[0]?.taskId, "QK-1");
  assert.equal(status.dispatchedJobs.some((job) => job.taskId === "QK-2"), false);
});
