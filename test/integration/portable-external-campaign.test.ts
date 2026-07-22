import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { finalizeEnvelope, stripDigest } from "../../src/campaign/envelope.js";
import { runPreflight } from "../../src/campaign/preflight.js";
import { CampaignSupervisor } from "../../src/campaign/supervisor.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { loadProjectContext } from "../../src/project/config.js";
import { canonicalRepository } from "../../src/project/repository.js";
import { createTaskSource } from "../../src/task-source/factory.js";
import { disposeTaskSource } from "../../src/task-source/task-source.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import { FakeRunnerPort } from "../campaign/support/fake-runner-port.js";
import { FakeWorktreePort } from "../campaign/support/fake-worktree.js";

const execFileAsync = promisify(execFile);
const fixture = path.resolve("test/fixtures/portable/external-repo");
const adapterPath = path.resolve("test/fixtures/external-adapter/fake-adapter.mjs");

async function freshExternalRepo(): Promise<{ root: string; stateDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-portable-external-"));
  const stateDir = path.join(root, ".quirks-state");
  await cp(fixture, root, { recursive: true });
  await cp(adapterPath, path.join(root, "adapter.mjs"));
  const configPath = path.join(root, ".agents/quirks.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    taskSource: { command: string[] };
  };
  config.taskSource.command = [process.execPath, path.join(root, "adapter.mjs")];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "external@quirks.test"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Portable External"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "portable external fixture"]);
  process.env.QUIRKS_STATE_DIR = stateDir;
  return { root, stateDir };
}

test("portable external fixture shares campaign boundaries with JSON driver", async () => {
  const { root, stateDir } = await freshExternalRepo();
  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-1"],
    externalRoutingEnabled: false,
  });
  assert.equal(preflight.mutatedRepository, false);
  assert.deepEqual(preflight.envelope.taskIds, ["QK-1"]);

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
    operator: { kind: "configured-profile", id: "external@test" },
  });

  const supervisor = await CampaignSupervisor.open({
    store,
    source,
    outbox: SyncOutbox.open(store.syncOutboxFile),
    runner: new FakeRunnerPort(),
    worktree: new FakeWorktreePort(),
    lockPath: path.join(stateDir, "repository.lock"),
    repositoryRoot: canonicalRoot,
    workflowSkills: project.config.workflowPolicy.skills,
  });
  await supervisor.startApproved();
  const status = await supervisor.status();
  assert.equal(status.claimedTaskIds.includes("QK-1"), true);
  await disposeTaskSource(source);
});
