import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { mergeCampaignToTarget } from "../../src/git/landing.js";
import { reconcileMutation } from "../../src/sync/reconciler.js";
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
  const campaignId = "cmp-landing-prov";
  const taskId = "QK-1";
  const reviewPath = "docs/landing-review.md";

  let show = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  assert.equal(show.ok, true);
  if (!show.ok || !show.nativeRevision) throw new Error("expected show revision");

  await reconcileMutation({
    campaignId,
    outbox,
    source,
    request: {
      schemaVersion: 1,
      operation: "claim",
      taskId,
      expectedNativeRevision: show.nativeRevision,
      idempotencyKey: `${campaignId}:${taskId}:claim:1`,
      input: { campaignId, owner: "landing-test", claimedAt: "2026-07-22T00:00:00.000Z" },
    },
  });

  show = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  if (!show.ok || !show.nativeRevision) throw new Error("expected show revision after claim");
  await reconcileMutation({
    campaignId,
    outbox,
    source,
    request: {
      schemaVersion: 1,
      operation: "attach-provenance",
      taskId,
      expectedNativeRevision: show.nativeRevision,
      idempotencyKey: `${campaignId}:${taskId}:attach-provenance:1`,
      input: {
        iteration: {
          id: "iter-landing-integration",
          outcome: "completed",
          completionBoundary: "target-merge",
          acceptedCommit: mergeResult.mergeCommit,
          landedCommit: mergeResult.mergeCommit,
          commitRefs: [mergeResult.mergeCommit],
          artifactRefs: [{ kind: "review", path: reviewPath, commit: mergeResult.mergeCommit }],
          verificationRefs: [{ kind: "verification", reference: "pnpm test", outcome: "passed" }],
          startedAt: "2026-07-22T00:00:00.000Z",
          finishedAt: "2026-07-22T00:00:00.000Z",
        },
      },
    },
  });

  show = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  if (!show.ok || !show.nativeRevision) throw new Error("expected show revision after attach");
  await reconcileMutation({
    campaignId,
    outbox,
    source,
    request: {
      schemaVersion: 1,
      operation: "submit-review",
      taskId,
      expectedNativeRevision: show.nativeRevision,
      idempotencyKey: `${campaignId}:${taskId}:submit-review:1`,
      input: { evidenceRefs: [`review:${reviewPath}`] },
    },
  });

  show = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  if (!show.ok || !show.nativeRevision) throw new Error("expected show revision after review");
  await reconcileMutation({
    campaignId,
    outbox,
    source,
    request: {
      schemaVersion: 1,
      operation: "complete",
      taskId,
      expectedNativeRevision: show.nativeRevision,
      idempotencyKey: `${campaignId}:${taskId}:complete:1`,
      input: {
        evidenceRefs: [
          `commit:${mergeResult.mergeCommit}`,
          `review:${reviewPath}`,
          `verification:pnpm test`,
        ],
      },
    },
  });

  const completed = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  assert.equal(completed.ok, true);
  assert.equal((completed.data as { status: string }).status, "completed");
});
