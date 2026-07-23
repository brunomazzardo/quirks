import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { QuirksError } from "../../src/core/errors.js";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { CampaignSupervisor, type CampaignSupervisorContext } from "../../src/campaign/supervisor.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { computeInstructionsHash } from "../../src/campaign/task-brief.js";
import { SessionRegistry } from "../../src/runner/sessions.js";
import type { RunnerProfile } from "../../src/runner/types.js";
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
  workflowSkills?: Readonly<Record<string, string>>;
  staleInstructionsHash?: boolean;
  profiles?: readonly RunnerProfile[];
  now?: () => string;
}

function supervisorProfile(
  profileId: string,
  runnerType: RunnerProfile["runnerType"],
  model: string,
): RunnerProfile {
  return {
    schemaVersion: 1,
    profileId,
    runnerType,
    executable: "bin/runner",
    accountAlias: "acct",
    quotaPoolId: "default",
    tier: "principal",
    model,
    effort: "standard",
    capabilities: [],
    wallClockMs: 3_600_000,
    redactionRules: [],
  };
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
    ...(options.staleInstructionsHash
      ? {}
      : {
          hashes: {
            config: "sha256:cfg",
            workflowPolicy: "sha256:wf",
            instructions: computeInstructionsHash(options.workflowSkills ?? {}),
          },
        }),
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
    workflowSkills: options.workflowSkills ?? {},
    ...(options.profiles
      ? { profileIndex: new Map(options.profiles.map((profile) => [profile.profileId, profile])) }
      : {}),
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

async function provenanceIterations(
  source: FakeTaskSource,
  taskId: string,
): Promise<Array<Record<string, unknown>>> {
  const show = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  assert.equal(show.ok, true);
  const data = (show as { data: { provenance: { iterations: Array<Record<string, unknown>> } } }).data;
  return data.provenance.iterations;
}

test("runToCompletion refuses task completion when the reviewer rejects the work", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor(["lane-a"]) });
  source.upsertTask("QK-B", { status: "ready", dependsOn: ["QK-A"], execution: executionFor(["lane-a"]) });
  const runner = new FakeRunnerPort();
  runner.queueResult("cmp-supervisor:QK-A:reviewer:1", {
    ...failureResult("cmp-supervisor:QK-A:reviewer:1"),
    failure: { code: "task_rejection", message: "reviewer rejected the candidate" },
  });
  runner.queueResult("cmp-supervisor:QK-A:reviewer:2", {
    ...failureResult("cmp-supervisor:QK-A:reviewer:2"),
    failure: { code: "task_rejection", message: "reviewer rejected the candidate" },
  });
  const context = await testContext({
    taskIds: ["QK-A", "QK-B"],
    taskRevisions: {
      "QK-A": source.taskRevision("QK-A"),
      "QK-B": source.taskRevision("QK-B"),
    },
    budgets: { maxTasks: 4, maxConcurrency: 1, maxWallClockMs: 3_600_000, maxRetries: 2, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A", "QK-B"]),
    source,
    runner,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.notEqual(outcome.status, "completed");
  assert.equal(runner.dispatches.some((dispatch) => dispatch.taskId === "QK-B"), false);
  assert.equal(outcome.completedJobs.some((job) => job.taskId === "QK-A"), false);

  const iterations = await provenanceIterations(source, "QK-A");
  assert.ok(iterations.length >= 1, "expected honest provenance for the rejected attempts");
  for (const iteration of iterations) {
    assert.equal(iteration["outcome"], "failed");
    assert.equal(iteration["acceptedCommit"], undefined);
    assert.match(String(iteration["outcomeReason"]), /review/);
    const roles = (iteration["participants"] as Array<{ role: string }>).map((participant) => participant.role);
    assert.deepEqual(roles.toSorted(), ["implementer", "reviewer"]);
  }
  await supervisor.stop();
});

test("runToCompletion skips reviewer dispatch for failed implementer attempts", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor(["lane-a"]) });
  const runner = new FakeRunnerPort();
  runner.queueResult("cmp-supervisor:QK-A:implementer:1", failureResult("cmp-supervisor:QK-A:implementer:1"));
  const context = await testContext({
    taskIds: ["QK-A"],
    taskRevisions: { "QK-A": source.taskRevision("QK-A") },
    budgets: { maxTasks: 2, maxConcurrency: 1, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A"]),
    source,
    runner,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "completed");
  const dispatchedJobIds = runner.dispatches.map((dispatch) => dispatch.jobId);
  assert.equal(dispatchedJobIds.includes("cmp-supervisor:QK-A:reviewer:1"), false);
  assert.equal(dispatchedJobIds.includes("cmp-supervisor:QK-A:reviewer:2"), true);
  assert.equal(outcome.completedJobs.some((job) => job.jobId === "cmp-supervisor:QK-A:implementer:2"), true);
  await supervisor.stop();
});

test("runToCompletion records accepted provenance only for reviewer-approved attempts", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor(["lane-a"]) });
  const context = await testContext({
    taskIds: ["QK-A"],
    taskRevisions: { "QK-A": source.taskRevision("QK-A") },
    budgets: { maxTasks: 1, maxConcurrency: 1, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A"]),
    source,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "completed");
  const iterations = await provenanceIterations(source, "QK-A");
  assert.equal(iterations.length, 1);
  const iteration = iterations[0];
  assert.ok(iteration, "expected a provenance iteration");
  assert.equal(iteration["outcome"], "completed");
  assert.equal(iteration["acceptedCommit"], "a".repeat(40));
  const roles = (iteration["participants"] as Array<{ role: string }>).map((participant) => participant.role);
  assert.deepEqual(roles.toSorted(), ["implementer", "reviewer"]);
  await supervisor.stop();
});

test("a paused lane does not starve dependency-satisfied tasks on healthy lanes", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor(["lane-a"]) });
  source.upsertTask("QK-B", { status: "ready", execution: executionFor(["lane-b"]) });
  source.upsertTask("QK-C", { status: "ready", dependsOn: ["QK-B"], execution: executionFor(["lane-b"]) });
  const runner = new FakeRunnerPort();
  runner.queueResult("cmp-supervisor:QK-A:implementer:1", failureResult("cmp-supervisor:QK-A:implementer:1"));
  runner.queueResult("cmp-supervisor:QK-A:implementer:2", failureResult("cmp-supervisor:QK-A:implementer:2"));
  const context = await testContext({
    taskIds: ["QK-A", "QK-B", "QK-C"],
    taskRevisions: Object.fromEntries(["QK-A", "QK-B", "QK-C"].map((taskId) => [taskId, source.taskRevision(taskId)])),
    budgets: { maxTasks: 5, maxConcurrency: 2, maxWallClockMs: 3_600_000, maxRetries: 2, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A", "QK-B", "QK-C"]),
    source,
    runner,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "paused");
  assert.deepEqual(outcome.pausedLanes, ["lane-a"]);
  assert.equal(runner.dispatches.some((dispatch) => dispatch.taskId === "QK-C" && dispatch.role === "implementer"), true);
  assert.equal(outcome.completedJobs.some((job) => job.taskId === "QK-C" && job.role === "implementer"), true);
  assert.equal(outcome.completedJobs.some((job) => job.taskId === "QK-B" && job.role === "implementer"), true);
  const state = await context.store.readState();
  assert.equal(state.activeLanes?.includes("lane-b"), true);
  assert.equal(state.activeLanes?.includes("lane-a"), false);
  await supervisor.stop();
});

test("usage-limit results pause the lane without burning retries", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor(["lane-a"]) });
  source.upsertTask("QK-B", { status: "ready", execution: executionFor(["lane-b"]) });
  const runner = new FakeRunnerPort();
  runner.queueResult("cmp-supervisor:QK-A:implementer:1", {
    ...failureResult("cmp-supervisor:QK-A:implementer:1"),
    status: "usage_limit",
    failure: undefined,
  });
  const context = await testContext({
    taskIds: ["QK-A", "QK-B"],
    taskRevisions: {
      "QK-A": source.taskRevision("QK-A"),
      "QK-B": source.taskRevision("QK-B"),
    },
    budgets: { maxTasks: 4, maxConcurrency: 2, maxWallClockMs: 3_600_000, maxRetries: 2, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A", "QK-B"]),
    source,
    runner,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "paused");
  assert.deepEqual(outcome.pausedLanes, ["lane-a"]);
  assert.deepEqual(outcome.breaker, { action: "pause_lane", reason: "USAGE_LIMIT_WITHOUT_RESET" });
  assert.equal(
    runner.dispatches.filter((dispatch) => dispatch.taskId === "QK-A" && dispatch.role === "implementer").length,
    1,
    "usage-limited lane must not be retried",
  );
  assert.equal(outcome.completedJobs.some((job) => job.taskId === "QK-B" && job.role === "implementer"), true);

  const lanePaused = (await context.store.readEvents()).find((event) => event.type === "lane.paused");
  assert.equal(lanePaused?.reason, "USAGE_LIMIT_WITHOUT_RESET");
  await supervisor.stop();
});

test("integration failures pause the whole campaign", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor(["lane-a"]) });
  const runner = new FakeRunnerPort();
  runner.queueResult("cmp-supervisor:QK-A:implementer:1", {
    ...failureResult("cmp-supervisor:QK-A:implementer:1"),
    failure: { code: "integration_failure", message: "integration branch broke" },
  });
  const context = await testContext({
    taskIds: ["QK-A"],
    taskRevisions: { "QK-A": source.taskRevision("QK-A") },
    budgets: { maxTasks: 2, maxConcurrency: 1, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A"]),
    source,
    runner,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "paused");
  assert.deepEqual(outcome.breaker, { action: "pause_campaign", reason: "INTEGRATION_FAILURE" });
  assert.equal(runner.dispatches.filter((dispatch) => dispatch.role === "implementer").length, 1);

  const state = await context.store.readState();
  assert.equal(state.status, "paused");
  assert.equal(state.pausedReason, "INTEGRATION_FAILURE");
  const paused = (await context.store.readEvents()).find((event) => event.type === "campaign.paused");
  assert.equal(paused?.reason, "INTEGRATION_FAILURE");
  await supervisor.stop();
});

test("ambiguous accepted-or-pushed failures hold the campaign", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor(["lane-a"]) });
  const runner = new FakeRunnerPort();
  runner.queueResult("cmp-supervisor:QK-A:implementer:1", {
    ...failureResult("cmp-supervisor:QK-A:implementer:1"),
    failure: { code: "ambiguous_mutation", message: "cannot tell whether work landed" },
  });
  const context = await testContext({
    taskIds: ["QK-A"],
    taskRevisions: { "QK-A": source.taskRevision("QK-A") },
    budgets: { maxTasks: 2, maxConcurrency: 1, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A"]),
    source,
    runner,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "hold");
  assert.deepEqual(outcome.breaker, { action: "hold", reason: "AMBIGUOUS_ACCEPTED_OR_PUSHED_STATE" });
  assert.equal(runner.dispatches.filter((dispatch) => dispatch.role === "implementer").length, 1);

  const state = await context.store.readState();
  assert.equal(state.status, "hold");
  const holdEvent = (await context.store.readEvents()).find((event) => event.type === "campaign.hold");
  assert.ok(holdEvent, "expected campaign.hold event");
  assert.equal(holdEvent.from, "running");
  assert.equal(holdEvent.to, "hold");
  assert.equal(holdEvent.reason, "AMBIGUOUS_ACCEPTED_OR_PUSHED_STATE");
  await supervisor.stop();
});

class ThrowingWorktreePort extends FakeWorktreePort {
  constructor(private readonly failTaskId: string) {
    super();
  }

  override async prepareTaskWorktree(taskId: string, baseCommit: string): Promise<{ path: string; branch: string }> {
    if (taskId === this.failTaskId) {
      throw new QuirksError("PROTOCOL_VIOLATION", `worktree provisioning failed for ${taskId}`);
    }
    return super.prepareTaskWorktree(taskId, baseCommit);
  }
}

test("supervisor-side dispatch errors halt the campaign instead of retrying as task failures", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor(["lane-a"]) });
  source.upsertTask("QK-B", { status: "ready", execution: executionFor(["lane-b"]) });
  const runner = new FakeRunnerPort();
  const context = await testContext({
    taskIds: ["QK-A", "QK-B"],
    taskRevisions: {
      "QK-A": source.taskRevision("QK-A"),
      "QK-B": source.taskRevision("QK-B"),
    },
    budgets: { maxTasks: 4, maxConcurrency: 2, maxWallClockMs: 3_600_000, maxRetries: 2, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A", "QK-B"]),
    source,
    runner,
    worktree: new ThrowingWorktreePort("QK-B"),
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "paused");
  assert.equal(outcome.breaker, undefined);
  assert.equal(outcome.completedJobs.some((job) => job.taskId === "QK-A" && job.role === "implementer"), true);
  assert.equal(runner.dispatches.some((dispatch) => dispatch.taskId === "QK-B"), false);

  const state = await context.store.readState();
  assert.equal(state.status, "paused");
  assert.equal(state.pausedReason, "SUPERVISOR_ERROR");

  const events = await context.store.readEvents();
  const waveStarted = events.filter((event) => event.type === "wave.started");
  assert.equal(waveStarted.length, 1, "the failing task must not be silently re-dispatched");
  const paused = events.find((event) => event.type === "campaign.paused");
  assert.ok(paused, "expected campaign.paused event");
  assert.equal(paused.reason, "SUPERVISOR_ERROR");
  assert.equal(paused.evidence["taskId"], "QK-B");
  assert.match(paused.evidence["message"] ?? "", /worktree provisioning failed/);
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

function failureResult(jobId: string): Parameters<FakeRunnerPort["queueResult"]>[1] {
  return {
    schemaVersion: 1,
    jobId,
    runner: "cursor-standard",
    runnerType: "cursor",
    resolvedModel: "test-model",
    effort: "standard",
    status: "failure",
    sessionHandle: "failed-session",
    artifactPaths: [],
    usage: {},
    failure: { code: "task_rejection", message: "implementer rejected the task" },
  };
}

test("runToCompletion pauses only the failing lane while other lanes proceed", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-A", { status: "ready", execution: executionFor(["lane-a"]) });
  source.upsertTask("QK-C", { status: "ready", execution: executionFor(["lane-c"]) });
  const runner = new FakeRunnerPort();
  runner.queueResult("cmp-supervisor:QK-A:implementer:1", failureResult("cmp-supervisor:QK-A:implementer:1"));
  runner.queueResult("cmp-supervisor:QK-A:implementer:2", failureResult("cmp-supervisor:QK-A:implementer:2"));
  const context = await testContext({
    taskIds: ["QK-A", "QK-C"],
    taskRevisions: {
      "QK-A": source.taskRevision("QK-A"),
      "QK-C": source.taskRevision("QK-C"),
    },
    budgets: { maxTasks: 4, maxConcurrency: 2, maxWallClockMs: 3_600_000, maxRetries: 2, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-A", "QK-C"]),
    source,
    runner,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  const outcome = await supervisor.runToCompletion();

  assert.equal(outcome.status, "paused");
  assert.deepEqual(outcome.pausedLanes, ["lane-a"]);
  assert.deepEqual(outcome.breaker, { action: "pause_lane", reason: "LANE_FAILURE_THRESHOLD" });
  assert.equal(outcome.completedJobs.some((job) => job.taskId === "QK-C" && job.role === "implementer"), true);

  const implementerAttempts = runner.dispatches
    .filter((dispatch) => dispatch.taskId === "QK-A" && dispatch.role === "implementer")
    .map((dispatch) => dispatch.jobId);
  assert.deepEqual(implementerAttempts, [
    "cmp-supervisor:QK-A:implementer:1",
    "cmp-supervisor:QK-A:implementer:2",
  ]);

  const events = await context.store.readEvents();
  const lanePaused = events.find((event) => event.type === "lane.paused");
  assert.ok(lanePaused, "expected lane.paused event");
  assert.equal(lanePaused.reason, "LANE_FAILURE_THRESHOLD");
  assert.equal(lanePaused.evidence["lanes"], "lane-a");

  const state = await context.store.readState();
  assert.equal(state.status, "paused");
  assert.equal(state.pausedReason, "ALL_LANES_PAUSED");
  assert.equal(state.activeLanes?.includes("lane-a"), false);
  assert.equal(state.activeLanes?.includes("lane-c"), true);
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

test("reviewer gets a distinct read-only brief bound to the candidate commit", async () => {
  const candidateCommit = "b".repeat(40);
  const source = new FakeTaskSource();
  const runner = new FakeRunnerPort();
  const worktree = new FakeWorktreePort();
  worktree.seed("QK-1", {
    path: "/tmp/quirks-worktree/QK-1",
    branch: "quirks/task/QK-1",
    modifiedFiles: [],
    commit: candidateCommit,
  });
  const context = await testContext({
    source,
    runner,
    worktree,
    workflowSkills: { execute: "executing-tasks" },
    profiles: [
      supervisorProfile("codex-implementer", "codex", "gpt-5.6-sol"),
      supervisorProfile("claude-reviewer", "claude", "opus-4.8"),
    ],
    routing: {
      "QK-1": {
        primary: { profileId: "codex-implementer", tier: "standard", effort: "standard" },
        fallbacks: [{ profileId: "claude-reviewer", tier: "high", effort: "standard" }],
      },
    },
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();

  const [implementer, reviewer] = runner.dispatches;
  assert.ok(implementer && reviewer, "expected implementer and reviewer dispatches");
  assert.notEqual(implementer.briefPath, reviewer.briefPath);

  const implementerBrief = await readFile(implementer.briefPath, "utf8");
  assert.notEqual(implementerBrief.trim(), "# QK-1", "ID-only briefs are prohibited");
  assert.match(implementerBrief, /^Objective:/m);
  assert.match(implementerBrief, /executing-tasks/);

  const reviewerBrief = await readFile(reviewer.briefPath, "utf8");
  assert.match(reviewerBrief, /Do not modify code/);
  assert.match(reviewerBrief, new RegExp(candidateCommit));
  assert.match(reviewerBrief, /executing-tasks/);
  assert.notEqual(implementerBrief, reviewerBrief);
});

test("rejects instructions drift between the envelope and configured workflow skills", async () => {
  const context = await testContext({
    workflowSkills: { execute: "executing-tasks" },
    staleInstructionsHash: true,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await assert.rejects(() => supervisor.startApproved(), /INSTRUCTIONS_DRIFT/);
});

test("refuses dispatch when workflow skills are absent instead of skipping the freeze check", async () => {
  const context = await testContext();
  // Simulate a JS caller that bypasses the compile-time requirement.
  delete (context as { workflowSkills?: unknown }).workflowSkills;
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await assert.rejects(() => supervisor.startApproved(), /INSTRUCTIONS_UNVERIFIED/);
  const status = await supervisor.status();
  assert.deepEqual(status.claimedTaskIds, [], "no task may be claimed with unverified instructions");
  assert.deepEqual(status.dispatchedJobs, [], "no brief may be dispatched with unverified instructions");
});

async function assertLockReleased(lockPath: string): Promise<void> {
  const probe = await RepositoryLock.acquire(lockPath, { campaignId: "cmp-lock-probe" });
  await probe.release();
}

test("prepareRun releases the repository lock when claim validation fails", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-1", { status: "proposed" });
  const context = await testContext({ source });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await assert.rejects(() => supervisor.startApproved(), /QK-1 is proposed/);
  await assertLockReleased(context.lockPath);
});

test("prepareRun releases the repository lock when revision drift refuses dispatch", async () => {
  const context = await testContext({
    taskRevisions: { "QK-1": `sha256:${"5".repeat(64)}` },
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await assert.rejects(() => supervisor.startApproved(), /TASK_REVISION_DRIFT/);
  await assertLockReleased(context.lockPath);
});

test("a dispatch failure after prepareRun releases the repository lock", async () => {
  const context = await testContext({ worktree: new ThrowingWorktreePort("QK-1") });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await assert.rejects(() => supervisor.startApproved(), /worktree provisioning failed/);
  await assertLockReleased(context.lockPath);
});

test("steals a dead-holder repository lock on the same host and journals the steal", async () => {
  const context = await testContext();
  await writeFile(
    context.lockPath,
    `${canonicalJson({
      schemaVersion: 1,
      scope: "local-clone",
      campaignId: "cmp-dead-holder",
      pid: 99_999_999,
      hostname: os.hostname(),
      acquiredAt: "2026-07-23T00:00:00.000Z",
      heartbeatAt: "2026-07-23T00:00:00.000Z",
    })}\n`,
    { mode: 0o600 },
  );
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();

  const steal = (await context.store.readEvents()).find((event) => event.type === "lock.stolen");
  assert.ok(steal, "expected a lock.stolen journal event");
  assert.equal(steal.evidence["staleCampaignId"], "cmp-dead-holder");
  assert.equal(steal.evidence["stalePid"], "99999999");
  assert.equal(steal.evidence["staleHostname"], os.hostname());

  const status = await supervisor.status();
  assert.equal(status.claimedTaskIds.includes("QK-1"), true, "the run proceeds after the steal");
  await supervisor.stop();
});

test("completed closure members are frozen facts: revision drift refuses dispatch and they are never claimed", async () => {
  const source = new FakeTaskSource();
  source.upsertTask("QK-1", { status: "completed" });
  source.upsertTask("QK-2", { status: "ready", dependsOn: ["QK-1"] });
  const context = await testContext({
    taskIds: ["QK-1", "QK-2"],
    taskRevisions: {
      // The completed dependency was frozen at a different revision than the
      // source now reports: the frozen fact changed, so dispatch must refuse.
      "QK-1": `sha256:${"6".repeat(64)}`,
      "QK-2": source.taskRevision("QK-2"),
    },
    budgets: { maxTasks: 2, maxConcurrency: 2, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    routing: standardRoute(["QK-1", "QK-2"]),
    source,
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await assert.rejects(() => supervisor.startApproved(), /TASK_REVISION_DRIFT.*QK-1/);

  const status = await supervisor.status();
  assert.deepEqual(status.claimedTaskIds, [], "drift on a frozen fact must refuse before any claim");
  const shown = await source.execute({ schemaVersion: 1, operation: "show", taskId: "QK-2", input: {} });
  assert.equal(shown.ok && (shown.data as { status: string }).status, "ready", "the target stays unclaimed at the source");
  await assertLockReleased(context.lockPath);
});

test("TASK_REVISION_DRIFT: a stale approved revision refuses dispatch before any claim", async () => {
  const source = new FakeTaskSource();
  const runner = new FakeRunnerPort();
  const context = await testContext({
    source,
    runner,
    taskRevisions: { "QK-1": `sha256:${"5".repeat(64)}` },
  });
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await assert.rejects(() => supervisor.startApproved(), /TASK_REVISION_DRIFT/);

  const status = await supervisor.status();
  assert.deepEqual(status.claimedTaskIds, [], "drift must refuse before any claim mutation");
  assert.deepEqual(runner.dispatches, [], "drift must refuse before any dispatch");
  const shown = await source.execute({ schemaVersion: 1, operation: "show", taskId: "QK-1", input: {} });
  assert.equal(shown.ok && (shown.data as { status: string }).status, "ready", "task stays unclaimed at the source");
});
