import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { CampaignSupervisor } from "../../src/campaign/supervisor.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { cleanupWorktrees } from "../../src/git/cleanup.js";
import { GitWorktreeManager } from "../../src/git/worktree.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import { validateSkills } from "../../scripts/validate-skills.mjs";
import { FakeTaskSource } from "../task-source/fake-source.js";
import { campaignEnvelope } from "../campaign/support.js";
import { computeInstructionsHash } from "../../src/campaign/task-brief.js";
import { FakeRunnerPort } from "../campaign/support/fake-runner-port.js";

async function supervisorWithGitWorktrees(): Promise<{
  supervisor: CampaignSupervisor;
  store: CampaignStore;
  manager: GitWorktreeManager;
  stateDir: string;
  lockPath: string;
}> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-wave3-state-"));
  const lockDir = await mkdtemp(path.join(os.tmpdir(), "quirks-wave3-lock-"));
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-wave3-repo-"));
  process.env.QUIRKS_STATE_DIR = stateDir;

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const git = async (...args: string[]) => execFileAsync("git", ["-C", repositoryRoot, ...args]);
  await git("init");
  await git("config", "user.email", "wave3@quirks.test");
  await git("config", "user.name", "Wave3");
  await mkdir(path.join(repositoryRoot, ".quirks"), { recursive: true });
  await writeFile(path.join(repositoryRoot, ".quirks/tasks.json"), '{"tasks":[]}\n', "utf8");
  await writeFile(path.join(repositoryRoot, "README.md"), "# wave3\n", "utf8");
  await git("add", ".");
  await git("commit", "-m", "init");
  const { stdout: headStdout } = await git("rev-parse", "HEAD");
  const head = headStdout.toString().trim();

  const source = new FakeTaskSource();
  const incomplete = campaignEnvelope({
    campaignId: "cmp-wave3",
    repositoryId: "sha256:wave3-repo",
    taskIds: ["QK-1"],
    taskRevisions: { "QK-1": source.taskRevision("QK-1") },
    hashes: {
      config: "sha256:cfg",
      workflowPolicy: "sha256:wf",
      instructions: computeInstructionsHash({}),
    },
    git: {
      baseCommit: head,
      campaignBranch: "quirks/cmp-wave3/integration",
      targetBranch: "main",
      push: { enabled: false },
    },
    routing: {
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

  const manager = await GitWorktreeManager.open({
    repositoryRoot,
    repositoryId: envelope.repositoryId,
    campaignId: envelope.campaignId,
    campaignBranch: envelope.git.campaignBranch,
    baseCommit: head,
    stateDir,
  });
  await manager.ensureIntegrationBranch({
    repositoryRoot,
    campaignId: envelope.campaignId,
    baseCommit: head,
    campaignBranch: envelope.git.campaignBranch,
  });

  const outbox = SyncOutbox.open(store.syncOutboxFile);
  const supervisor = await CampaignSupervisor.open({
    store,
    source,
    outbox,
    runner: new FakeRunnerPort(),
    worktree: manager,
    lockPath: path.join(lockDir, "repository.lock"),
    repositoryRoot,
    workflowSkills: {},
  });

  return { supervisor, store, manager, stateDir, lockPath: path.join(lockDir, "repository.lock") };
}

test("wave 3 integration: skills validate and supervisor uses distinct worktrees", async () => {
  const report = await validateSkills({ root: path.resolve(".") });
  assert.equal(report.ok, true);

  const { supervisor, manager, store } = await supervisorWithGitWorktrees();
  const envelope = await store.readEnvelope();
  const challenge = createApprovalChallenge({
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    ttlMs: 60_000,
  });
  await consumeApprovalToken({
    store,
    token: challenge.token,
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    operator: { kind: "configured-profile", id: "operator@test" },
  });

  await supervisor.startApproved();
  const status = await supervisor.status();
  const implementer = status.dispatchedJobs.find((job) => job.role === "implementer");
  const reviewer = status.dispatchedJobs.find((job) => job.role === "reviewer");
  assert.ok(implementer);
  assert.ok(reviewer);

  const dispatchSkill = await readFile(path.resolve("skills/dispatching-external-agents/SKILL.md"), "utf8");
  assert.match(dispatchSkill, /quirks-campaign/);
  assert.match(dispatchSkill, /quirks-watchdog/);

  await store.writeState({
    schemaVersion: 1,
    campaignId: envelope.campaignId,
    status: "cancelled",
    digest: envelope.digest,
    updatedAt: new Date().toISOString(),
    activeLanes: [],
  });

  const cleanup = await cleanupWorktrees(manager, envelope.campaignId, { force: true });
  assert.equal(cleanup.removed.length > 0, true);
  await supervisor.stop();
});
