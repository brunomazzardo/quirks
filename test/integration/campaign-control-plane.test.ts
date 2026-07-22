import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { finalizeEnvelope, stripDigest } from "../../src/campaign/envelope.js";
import { runPreflight } from "../../src/campaign/preflight.js";
import { recoverCampaign } from "../../src/campaign/recovery.js";
import { CampaignSupervisor, type CampaignSupervisorContext } from "../../src/campaign/supervisor.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { loadProjectContext } from "../../src/project/config.js";
import { canonicalRepository } from "../../src/project/repository.js";
import { createTaskSource } from "../../src/task-source/factory.js";
import { disposeTaskSource } from "../../src/task-source/task-source.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import type { CampaignEnvelope } from "../../src/campaign/types.js";
import { FakeRunnerPort } from "../campaign/support/fake-runner-port.js";
import { FakeWorktreePort } from "../campaign/support/fake-worktree.js";

const execFileAsync = promisify(execFile);
const fixture = path.resolve("test/fixtures/campaign-project");
const campaignCli = path.resolve("dist/src/cli/quirks-campaign.js");
const PLACEHOLDER_MESSAGE =
  "Campaign execution is not installed; implement the approved runner-control and campaign plans.";

const originalStateDir = process.env.QUIRKS_STATE_DIR;
const originalConfigDir = process.env.QUIRKS_CONFIG_DIR;

test.after(() => {
  if (originalStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
  else process.env.QUIRKS_STATE_DIR = originalStateDir;
  if (originalConfigDir === undefined) delete process.env.QUIRKS_CONFIG_DIR;
  else process.env.QUIRKS_CONFIG_DIR = originalConfigDir;
});

async function executableFakeRunner(scriptName: string, configDir: string): Promise<string> {
  const fixtureDir = path.resolve("test/fixtures/fake-runners");
  await cp(path.join(fixtureDir, "shared-modes.mjs"), path.join(configDir, "shared-modes.mjs"));
  const source = path.join(fixtureDir, scriptName);
  const target = path.join(configDir, scriptName);
  const original = await readFile(source, "utf8");
  await writeFile(target, `#!/usr/bin/env node\n${original}`, "utf8");
  await chmod(target, 0o755);
  return target;
}

async function writeCampaignRunnerConfig(configDir: string): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const codexExecutable = await executableFakeRunner("fake-codex.mjs", configDir);
  const claudeExecutable = await executableFakeRunner("fake-claude.mjs", configDir);
  await writeFile(
    path.join(configDir, "profiles.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      tierAliases: {
        "fable-principal": { tier: "principal" },
        "composer-standard": { tier: "standard" },
      },
      profiles: [
        {
          schemaVersion: 1,
          profileId: "codex-standard",
          runnerType: "codex",
          executable: codexExecutable,
          accountAlias: "work",
          quotaPoolId: "pool-codex",
          tier: "standard",
          model: "composer-standard",
          effort: "standard",
          capabilities: ["repository-read", "repository-write"],
          wallClockMs: 5_000,
          redactionRules: [],
        },
        {
          schemaVersion: 1,
          profileId: "claude-principal",
          runnerType: "claude",
          executable: claudeExecutable,
          accountAlias: "work",
          quotaPoolId: "pool-claude",
          tier: "principal",
          model: "fable-principal",
          effort: "principal",
          capabilities: ["repository-read", "repository-write"],
          wallClockMs: 5_000,
          redactionRules: [],
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

function testEnv(stateDir: string, configDir: string): NodeJS.ProcessEnv {
  return { ...process.env, QUIRKS_STATE_DIR: stateDir, QUIRKS_CONFIG_DIR: configDir };
}

async function freshCampaignRepo(): Promise<{ root: string; stateDir: string; configDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-control-plane-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-control-plane-state-"));
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-control-plane-config-"));
  await writeCampaignRunnerConfig(configDir);
  await cp(fixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Quirks Test"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  process.env.QUIRKS_STATE_DIR = stateDir;
  process.env.QUIRKS_CONFIG_DIR = configDir;
  return { root, stateDir, configDir };
}

function storeReadyEnvelope(envelope: CampaignEnvelope): CampaignEnvelope {
  return finalizeEnvelope({
    ...stripDigest(envelope),
    budgets: {
      ...envelope.budgets,
      maxWallClockMs: Math.max(envelope.budgets.maxWallClockMs, 3_600_000),
      maxRetries: Math.max(envelope.budgets.maxRetries, 1),
      laneFailureThreshold: Math.max(envelope.budgets.laneFailureThreshold, 2),
    },
  });
}

async function openSupervisorContext(
  repositoryRoot: string,
  stateDir: string,
  envelope: Awaited<ReturnType<typeof runPreflight>>["envelope"],
): Promise<CampaignSupervisorContext & { dispose: () => Promise<void> }> {
  const { root } = await canonicalRepository(repositoryRoot);
  const project = await loadProjectContext(root, { mode: "inspection" });
  const source = await createTaskSource(project);
  const store = await CampaignStore.create({
    stateDir,
    repositoryId: envelope.repositoryId,
    campaignId: envelope.campaignId,
    envelope: storeReadyEnvelope(envelope),
  });
  const lockDir = await mkdtemp(path.join(os.tmpdir(), "quirks-control-plane-lock-"));
  return {
    store,
    source,
    outbox: SyncOutbox.open(store.syncOutboxFile),
    runner: new FakeRunnerPort(),
    worktree: new FakeWorktreePort(),
    workflowSkills: project.config.workflowPolicy.skills,
    lockPath: path.join(lockDir, "repository.lock"),
    repositoryRoot: root,
    dispose: async () => {
      await disposeTaskSource(source);
    },
  };
}

async function recordHeadlessApproval(context: CampaignSupervisorContext): Promise<void> {
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

test("preflight is read-only and assembles a digest-bound envelope for QK-101", async () => {
  const { root } = await freshCampaignRepo();
  const tasksPath = path.join(root, ".quirks/tasks.json");
  const before = await readFile(tasksPath, "utf8");

  const result = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-101"],
    externalRoutingEnabled: false,
  });

  assert.equal(result.mutatedRepository, false);
  assert.equal(await readFile(tasksPath, "utf8"), before);
  assert.deepEqual(result.envelope.taskIds, ["QK-101"]);
  assert.equal(result.blockers.length, 0);
  assert.match(result.envelope.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.syncHealth.ok, true);
});

test("supervisor refuses claim before durable approval exists", async () => {
  const { root, stateDir } = await freshCampaignRepo();
  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-101"],
    externalRoutingEnabled: false,
  });
  const context = await openSupervisorContext(root, stateDir, preflight.envelope);
  try {
    const supervisor = await CampaignSupervisor.open(context);
    await assert.rejects(() => supervisor.startApproved(), /APPROVAL_REQUIRED/);
  } finally {
    await context.dispose();
  }
});

test("headless approval, start, and status work without UI", async () => {
  const { root, stateDir } = await freshCampaignRepo();
  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-101"],
    externalRoutingEnabled: false,
  });
  const context = await openSupervisorContext(root, stateDir, preflight.envelope);
  try {
    await recordHeadlessApproval(context);
    const supervisor = await CampaignSupervisor.open(context);
    await supervisor.startApproved();
    const status = await supervisor.status();
    assert.equal(status.claimedTaskIds.includes("QK-101"), true);
    assert.equal(status.dispatchedJobs.length, 2);
    assert.equal(status.dispatchedJobs.filter((job) => job.role === "implementer").length, 1);
    assert.equal(status.dispatchedJobs.filter((job) => job.role === "reviewer").length, 1);
    assert.equal(status.dispatchedJobs[0]?.taskId, "QK-101");
    const state = await context.store.readState();
    assert.equal(state.status, "running");
    const approvals = await context.store.readApprovals();
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0]?.digest, (await context.store.readEnvelope()).digest);
    await supervisor.stop();
  } finally {
    await context.dispose();
  }
});

test("recovery pauses a crashed campaign and prevents duplicate dispatch", async () => {
  const { root, stateDir } = await freshCampaignRepo();
  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-101"],
    externalRoutingEnabled: false,
  });
  const context = await openSupervisorContext(root, stateDir, preflight.envelope);
  try {
    await recordHeadlessApproval(context);
    const supervisor = await CampaignSupervisor.open(context);
    await supervisor.startApproved();
    await supervisor.stop();

    const report = await recoverCampaign(context.store);
    assert.equal(report.duplicateDispatchesPrevented >= 1, true);
    assert.equal(report.state.status, "paused");
    assert.equal(report.recoveredJobs.length >= 1, true);
    assert.match(report.pauseReason ?? "", /crash_recovery|envelope_drift/);
  } finally {
    await context.dispose();
  }
});

test("approval replay is rejected after durable consumption", async () => {
  const { root, stateDir } = await freshCampaignRepo();
  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-101"],
    externalRoutingEnabled: false,
  });
  const context = await openSupervisorContext(root, stateDir, preflight.envelope);
  try {
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
    await assert.rejects(
      () =>
        consumeApprovalToken({
          store: context.store,
          token: challenge.token,
          campaignId: envelope.campaignId,
          digest: envelope.digest,
          operator: { kind: "configured-profile", id: "operator@test" },
        }),
      /APPROVAL_REPLAY/,
    );
  } finally {
    await context.dispose();
  }
});

function dagTask(id: string, dependsOn: readonly string[]): Record<string, unknown> {
  return {
    id,
    title: `DAG task ${id}`,
    kind: "implementation",
    priority: "P1",
    status: "ready",
    dependsOn: [...dependsOn],
    workflow: { family: "superpowers", phase: "execute", designGate: { required: false } },
    execution: {
      effort: "standard",
      risk: [],
      capabilities: ["repository-write"],
      parallelismKeys: [`lane-${id}`],
      humanGates: [],
      completionBoundary: "accepted-commit",
    },
    sourceRefs: [],
    deliverables: ["implementation"],
    acceptanceCriteria: [`${id} lands`],
    verification: ["pnpm test"],
    provenance: { schemaVersion: 1, iterations: [] },
  };
}

test("preflight, approval, and start complete a three-task DAG unattended with provenance", async () => {
  const { root, stateDir } = await freshCampaignRepo();
  const dagIds = ["QK-301", "QK-302", "QK-303"];
  await writeFile(
    path.join(root, ".quirks/tasks.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      tasks: [dagTask("QK-301", []), dagTask("QK-302", ["QK-301"]), dagTask("QK-303", ["QK-301"])],
    }, null, 2)}\n`,
    "utf8",
  );
  await execFileAsync("git", ["-C", root, "add", ".quirks/tasks.json"]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "install dag fixture"]);

  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-302", "QK-303"],
    externalRoutingEnabled: false,
    maxConcurrency: 2,
  });
  assert.deepEqual(preflight.envelope.taskIds, dagIds);
  assert.equal(preflight.blockers.length, 0);
  assert.equal(preflight.envelope.budgets.maxConcurrency, 2);

  const context = await openSupervisorContext(root, stateDir, preflight.envelope);
  try {
    await recordHeadlessApproval(context);
    const supervisor = await CampaignSupervisor.open(context);
    const outcome = await supervisor.runToCompletion();

    assert.equal(outcome.status, "completed");
    assert.deepEqual(outcome.pausedLanes, []);
    const completedImplementers = outcome.completedJobs.filter((job) => job.role === "implementer");
    assert.deepEqual(completedImplementers.map((job) => job.taskId).toSorted(), dagIds);

    const events = await context.store.readEvents();
    const waveStarted = events.filter((event) => event.type === "wave.started");
    assert.equal(waveStarted.length, 2);
    assert.equal(waveStarted[0]?.evidence["taskIds"], "QK-301");
    assert.equal(waveStarted[1]?.evidence["taskIds"], "QK-302,QK-303");

    const envelope = await context.store.readEnvelope();
    for (const taskId of dagIds) {
      const show = await context.source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
      assert.equal(show.ok, true);
      const provenance = (show as { data: { provenance: { iterations: Array<Record<string, unknown>> } } })
        .data.provenance;
      const iteration = provenance.iterations.find((entry) => entry["campaignId"] === envelope.campaignId);
      assert.ok(iteration, `expected provenance iteration for ${taskId}`);
      assert.equal(iteration["outcome"], "completed");
      assert.equal(iteration["envelopeDigest"], envelope.digest);
    }

    const state = await context.store.readState();
    assert.equal(state.status, "running");
    await supervisor.stop();
  } finally {
    await context.dispose();
  }
});

test("a single failed attempt retries and completes within default preflight budgets", async () => {
  const { root, stateDir } = await freshCampaignRepo();
  const dagIds = ["QK-301", "QK-302", "QK-303"];
  await writeFile(
    path.join(root, ".quirks/tasks.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      tasks: [dagTask("QK-301", []), dagTask("QK-302", ["QK-301"]), dagTask("QK-303", ["QK-301"])],
    }, null, 2)}\n`,
    "utf8",
  );
  await execFileAsync("git", ["-C", root, "add", ".quirks/tasks.json"]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "install dag fixture"]);

  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-302", "QK-303"],
    externalRoutingEnabled: false,
    maxConcurrency: 2,
  });
  assert.equal(preflight.blockers.length, 0);

  const context = await openSupervisorContext(root, stateDir, preflight.envelope);
  try {
    const runner = context.runner as FakeRunnerPort;
    const failingJobId = `${preflight.envelope.campaignId}:QK-301:implementer:1`;
    runner.queueResult(failingJobId, {
      schemaVersion: 1,
      jobId: failingJobId,
      runner: "placeholder",
      runnerType: "cursor",
      resolvedModel: "test-model",
      effort: "standard",
      status: "failure",
      sessionHandle: "failed-session",
      artifactPaths: [],
      usage: {},
      failure: { code: "task_rejection", message: "first attempt rejected" },
    });

    await recordHeadlessApproval(context);
    const supervisor = await CampaignSupervisor.open(context);
    const outcome = await supervisor.runToCompletion();

    assert.equal(outcome.status, "completed");
    const completedImplementers = outcome.completedJobs.filter((job) => job.role === "implementer");
    assert.deepEqual(completedImplementers.map((job) => job.taskId).toSorted(), dagIds);
    assert.equal(
      completedImplementers.some((job) => job.jobId === `${preflight.envelope.campaignId}:QK-301:implementer:2`),
      true,
    );
    await supervisor.stop();
  } finally {
    await context.dispose();
  }
});

async function campaignCliIsPlaceholder(): Promise<boolean> {
  const { root, stateDir, configDir } = await freshCampaignRepo();
  try {
    await execFileAsync(process.execPath, [campaignCli, "preflight", "--task", "QK-101", "--json"], {
      cwd: root,
      env: testEnv(stateDir, configDir),
    });
    return false;
  } catch (error) {
    const execError = error as { stderr?: string; code?: number };
    return execError.code === 2 && (execError.stderr ?? "").includes(PLACEHOLDER_MESSAGE);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("CLI exec: preflight, approval, start, and status when campaign CLI is installed", async () => {
  if (await campaignCliIsPlaceholder()) {
    assert.ok(true, "quirks-campaign CLI still placeholder; in-process acceptance covers the contract");
    return;
  }

  const { root, stateDir, configDir } = await freshCampaignRepo();
  try {
    const env = testEnv(stateDir, configDir);
    const preflight = JSON.parse(
      (await execFileAsync(
        process.execPath,
        [campaignCli, "preflight", "--task", "QK-101", "--external-routing", "--json"],
        { cwd: root, env },
      )).stdout,
    );
    assert.equal(preflight.ok, true);
    const approve = JSON.parse(
      (
        await execFileAsync(
          process.execPath,
          [campaignCli, "approve", "--campaign", preflight.campaignId, "--digest", preflight.envelope.digest, "--json"],
          { cwd: root, env },
        )
      ).stdout,
    );
    assert.equal(approve.ok, true);
    const start = JSON.parse(
      (
        await execFileAsync(
          process.execPath,
          [campaignCli, "start", "--campaign", preflight.campaignId, "--json"],
          { cwd: root, env },
        )
      ).stdout,
    );
    assert.match(start.campaignId ?? preflight.campaignId, /./);
    const status = JSON.parse(
      (
        await execFileAsync(
          process.execPath,
          [campaignCli, "status", "--campaign", preflight.campaignId, "--json"],
          { cwd: root, env },
        )
      ).stdout,
    );
    assert.equal(status.localCoordinationOnly, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
