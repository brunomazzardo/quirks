import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { finalizeEnvelope, stripDigest } from "../../src/campaign/envelope.js";
import { runPreflight } from "../../src/campaign/preflight.js";
import { CampaignSupervisor } from "../../src/campaign/supervisor.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { mergeCampaignToTarget } from "../../src/git/landing.js";
import { loadProjectContext } from "../../src/project/config.js";
import { canonicalRepository } from "../../src/project/repository.js";
import { createTaskSource } from "../../src/task-source/factory.js";
import { disposeTaskSource } from "../../src/task-source/task-source.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import { FakeRunnerPort } from "../campaign/support/fake-runner-port.js";
import { FakeWorktreePort } from "../campaign/support/fake-worktree.js";
import { createLandingFixture } from "../git/support/landing-fixture.js";

const execFileAsync = promisify(execFile);
const fixture = path.resolve("test/fixtures/portable/json-repo");

async function freshPortableRepo(): Promise<{ root: string; stateDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-portable-json-"));
  const stateDir = path.join(root, ".quirks-state");
  await cp(fixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "portable@quirks.test"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Portable JSON"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "portable json fixture"]);
  process.env.QUIRKS_STATE_DIR = stateDir;
  return { root, stateDir };
}

test("portable JSON fixture completes preflight, approval, and start boundaries", async () => {
  const { root, stateDir } = await freshPortableRepo();
  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["PORT-JSON-1"],
    externalRoutingEnabled: false,
  });
  assert.equal(preflight.mutatedRepository, false);
  assert.deepEqual(preflight.envelope.taskIds, ["PORT-JSON-1"]);

  const { root: canonicalRoot } = await canonicalRepository(root);
  const project = await loadProjectContext(canonicalRoot, { mode: "inspection" });
  const source = await createTaskSource(project);
  const store = await CampaignStore.create({
    stateDir,
    repositoryId: preflight.envelope.repositoryId,
    campaignId: preflight.envelope.campaignId,
    envelope: finalizeEnvelope(stripDigest(preflight.envelope)),
  });
  const challenge = createApprovalChallenge({
    campaignId: preflight.envelope.campaignId,
    digest: preflight.envelope.digest,
    ttlMs: 60_000,
  });
  await consumeApprovalToken({
    store,
    token: challenge.token,
    campaignId: preflight.envelope.campaignId,
    digest: preflight.envelope.digest,
    operator: { kind: "configured-profile", id: "portable@test" },
  });

  const supervisor = await CampaignSupervisor.open({
    store,
    source,
    outbox: SyncOutbox.open(store.syncOutboxFile),
    runner: new FakeRunnerPort(),
    worktree: new FakeWorktreePort(),
    lockPath: path.join(stateDir, "repository.lock"),
    repositoryRoot: canonicalRoot,
  });
  await supervisor.startApproved();
  const status = await supervisor.status();
  assert.equal(status.claimedTaskIds.includes("PORT-JSON-1"), true);
  await disposeTaskSource(source);
});

test("portable JSON fixture rejects unapproved push and accepts exact approved push", async () => {
  const unapproved = await createLandingFixture();
  await assert.rejects(
    () =>
      mergeCampaignToTarget({
        repositoryRoot: unapproved.root,
        git: {
          campaignBranch: unapproved.campaignBranch,
          targetBranch: unapproved.targetBranch,
          expectedTargetCommit: unapproved.targetCommit,
          push: { enabled: true, remote: "origin", branch: "main" },
        },
      }),
    /Approved push remote and branch are required/,
  );
  const remoteHead = await execFileAsync("git", ["-C", unapproved.bareRemote, "rev-parse", "main"]);
  assert.equal(remoteHead.stdout.toString().trim(), unapproved.targetCommit);

  const approved = await createLandingFixture();
  const pushed = await mergeCampaignToTarget({
    repositoryRoot: approved.root,
    git: {
      campaignBranch: approved.campaignBranch,
      targetBranch: approved.targetBranch,
      expectedTargetCommit: approved.targetCommit,
      push: { enabled: true, remote: "origin", branch: "main" },
    },
    approvedPush: { remote: "origin", branch: "main" },
  });
  assert.equal(pushed.pushed, true);
  assert.equal(pushed.pushRef, "origin/main");
});
