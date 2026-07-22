import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { mergeCampaignToTarget } from "../../src/git/landing.js";
import { writeLandingProvenance } from "../../src/git/provenance-writeback.js";
import { JsonTaskSource } from "../../src/task-source/json/json-task-source.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import { createLandingFixture } from "../git/support/landing-fixture.js";

const execFileAsync = promisify(execFile);
const sourceFixture = path.resolve("test/fixtures/json-project");

test("integration: landing merge then provenance write-back on JSON task source", async () => {
  const fixture = await createLandingFixture();
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-landing-prov-project-"));
  await cp(sourceFixture, projectRoot, { recursive: true });
  await execFileAsync("git", ["init", projectRoot]);
  process.env.QUIRKS_STATE_DIR = path.join(projectRoot, ".quirks-state");

  const mergeResult = await mergeCampaignToTarget({
    repositoryRoot: fixture.root,
    git: {
      campaignBranch: fixture.campaignBranch,
      targetBranch: fixture.targetBranch,
      expectedTargetCommit: fixture.targetCommit,
      push: { enabled: false },
    },
  });

  const source = await JsonTaskSource.open(projectRoot);
  const outbox = SyncOutbox.open(path.join(projectRoot, ".quirks-state", "outbox.jsonl"));
  const show = await source.execute({ schemaVersion: 1, operation: "show", taskId: "QK-1", input: {} });
  assert.equal(show.ok, true);

  const writeback = await writeLandingProvenance({
    repositoryRoot: fixture.root,
    campaignId: "cmp-landing-prov",
    taskId: "QK-1",
    landingCommit: mergeResult.mergeCommit,
    expectedNativeRevision: show.nativeRevision!,
    source,
    outbox,
    attachIdempotencyKey: "cmp-landing-prov:QK-1:attach-provenance:landing",
    completeIdempotencyKey: "cmp-landing-prov:QK-1:complete:landing",
    iterationId: "iter-landing-integration",
  });
  assert.equal(writeback.attached, true);
  assert.equal(writeback.completed, true);

  const completed = await source.execute({ schemaVersion: 1, operation: "show", taskId: "QK-1", input: {} });
  assert.equal(completed.ok, true);
  assert.equal((completed.data as { status: string }).status, "completed");
});
