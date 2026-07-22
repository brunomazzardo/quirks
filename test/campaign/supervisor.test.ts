import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
  runner?: FakeRunnerPort;
  worktree?: FakeWorktreePort;
  workflowSkills?: Readonly<Record<string, string>>;
  staleInstructionsHash?: boolean;
  profiles?: readonly RunnerProfile[];
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
    ...(options.workflowSkills && !options.staleInstructionsHash
      ? {
          hashes: {
            config: "sha256:cfg",
            workflowPolicy: "sha256:wf",
            instructions: computeInstructionsHash(options.workflowSkills),
          },
        }
      : {}),
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
    ...(options.workflowSkills ? { workflowSkills: options.workflowSkills } : {}),
    ...(options.profiles
      ? { profileIndex: new Map(options.profiles.map((profile) => [profile.profileId, profile])) }
      : {}),
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
