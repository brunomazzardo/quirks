import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { QuirksError } from "../../../src/core/errors.js";
import { JsonTaskSource } from "../../../src/task-source/json/json-task-source.js";
import type { TaskSourceRequest } from "../../../src/task-source/types.js";
import { assertTaskSourceContract } from "../contract.js";

const execFileAsync = promisify(execFile);
const sourceFixture = path.resolve("test/fixtures/json-project");
const originalStateDir = process.env.QUIRKS_STATE_DIR;

const sampleIteration = {
  id: "iter-1",
  outcome: "completed" as const,
  completionBoundary: "accepted-commit" as const,
  acceptedCommit: "a".repeat(40),
  artifactRefs: [{ kind: "review", path: "docs/review.md", commit: "a".repeat(40) }],
  verificationRefs: [{ kind: "verification", reference: "pnpm test", outcome: "passed" }],
  startedAt: "2026-07-21T00:00:00.000Z",
};

const correlatedIteration = {
  id: "iter-correlated",
  outcome: "completed" as const,
  completionBoundary: "accepted-commit" as const,
  acceptedCommit: "a".repeat(40),
  commitRefs: ["b".repeat(40)],
  artifactRefs: [{ kind: "review", path: "docs/review.md", commit: "a".repeat(40) }],
  verificationRefs: [{ kind: "verification", reference: "pnpm test", outcome: "passed" }],
};

const proposedTask = {
  id: "QK-2",
  title: "Proposed task",
  kind: "implementation",
  priority: "P2",
  status: "proposed",
  dependsOn: [],
  workflow: { family: "superpowers", phase: "execute", designGate: { required: false } },
  execution: {
    effort: "standard",
    risk: [],
    capabilities: ["repository-write"],
    parallelismKeys: [],
    humanGates: [],
    completionBoundary: "accepted-commit",
  },
  sourceRefs: [],
  deliverables: [],
  acceptanceCriteria: ["Passes"],
  verification: ["pnpm test"],
  provenance: { schemaVersion: 1, iterations: [] },
  coordination: null,
  statusDetail: null,
};

test.after(() => {
  if (originalStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
  else process.env.QUIRKS_STATE_DIR = originalStateDir;
});

async function freshFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-json-source-"));
  await cp(sourceFixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  process.env.QUIRKS_STATE_DIR = path.join(root, ".quirks-state");
  return root;
}

function tasksFile(root: string): string {
  return path.join(root, ".quirks/tasks.json");
}

async function fileDigest(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function showTask(source: JsonTaskSource, taskId = "QK-1") {
  const response = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  if (!response.ok) assert.fail(response.error.message);
  return response;
}

async function mutate(
  source: JsonTaskSource,
  request: TaskSourceRequest & { expectedNativeRevision: string; idempotencyKey: string },
) {
  const response = await source.execute(request);
  return response;
}

test("JSON driver satisfies the shared contract", async () => {
  await assertTaskSourceContract(async () => JsonTaskSource.open(await freshFixture()));
});

test("JSON driver rejects a stale claim without changing the file", async () => {
  const root = await freshFixture();
  const source = await JsonTaskSource.open(root);
  const tasksPath = tasksFile(root);
  const before = await fileDigest(tasksPath);
  const shown = await showTask(source);
  const response = await mutate(source, {
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: `${shown.nativeRevision}-stale`,
    idempotencyKey: "C-1:QK-1:claim:evt-stale",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  });
  if (response.ok) assert.fail("stale mutation succeeded");
  assert.equal(response.error.code, "STALE_REVISION");
  assert.equal(await fileDigest(tasksPath), before);
});

test("JSON proposals reject injected active and terminal state", async () => {
  const root = await freshFixture();
  const source = await JsonTaskSource.open(root);
  for (const status of ["claimed", "in_review", "blocked", "completed", "cancelled"] as const) {
    const response = await mutate(source, {
      schemaVersion: 1,
      operation: "propose",
      taskId: `QK-${status}`,
      expectedNativeRevision: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      idempotencyKey: `C-1:QK-${status}:propose:state`,
      input: { task: { ...proposedTask, id: `QK-${status}`, status } },
    });
    assert.equal(response.ok, false);
    if (response.ok) assert.fail(`accepted ${status} proposal`);
    assert.equal(response.error.code, "SOURCE_CONFLICT");
  }
});

test("JSON completion binds configured evidence to completed provenance", async () => {
  const root = await freshFixture();
  const source = await JsonTaskSource.open(root);
  let shown = await showTask(source);
  const claim = await mutate(source, {
    schemaVersion: 1, operation: "claim", taskId: "QK-1", expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:claim:evidence", input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  });
  assert.equal(claim.ok, true);
  shown = await showTask(source);
  const attach = await mutate(source, {
    schemaVersion: 1, operation: "attach-provenance", taskId: "QK-1", expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:attach:evidence", input: { iteration: { ...sampleIteration, id: "iter-minimal" } },
  });
  assert.equal(attach.ok, true);
  shown = await showTask(source);
  const review = await mutate(source, {
    schemaVersion: 1, operation: "submit-review", taskId: "QK-1", expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:review:evidence", input: { evidenceRefs: ["review:docs/review.md"] },
  });
  assert.equal(review.ok, true);
  shown = await showTask(source);
  const invented = await mutate(source, {
    schemaVersion: 1, operation: "complete", taskId: "QK-1", expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:complete:invented", input: { evidenceRefs: ["commit:invented", "review:invented", "verification:invented"] },
  });
  assert.equal(invented.ok, false);
  if (invented.ok) assert.fail("invented evidence completed task");

  const sourceWithEvidence = await JsonTaskSource.open(await freshFixture());
  let correlated = await showTask(sourceWithEvidence);
  await mutate(sourceWithEvidence, {
    schemaVersion: 1, operation: "claim", taskId: "QK-1", expectedNativeRevision: correlated.nativeRevision!,
    idempotencyKey: "C-2:QK-1:claim:evidence", input: { campaignId: "C-2", owner: "supervisor:S-2", claimedAt: "2026-07-21T00:00:00.000Z" },
  });
  correlated = await showTask(sourceWithEvidence);
  await mutate(sourceWithEvidence, {
    schemaVersion: 1, operation: "attach-provenance", taskId: "QK-1", expectedNativeRevision: correlated.nativeRevision!,
    idempotencyKey: "C-2:QK-1:attach:evidence", input: { iteration: correlatedIteration },
  });
  correlated = await showTask(sourceWithEvidence);
  await mutate(sourceWithEvidence, {
    schemaVersion: 1, operation: "submit-review", taskId: "QK-1", expectedNativeRevision: correlated.nativeRevision!,
    idempotencyKey: "C-2:QK-1:review:evidence", input: { evidenceRefs: ["review:docs/review.md"] },
  });
  correlated = await showTask(sourceWithEvidence);
  const completed = await mutate(sourceWithEvidence, {
    schemaVersion: 1, operation: "complete", taskId: "QK-1", expectedNativeRevision: correlated.nativeRevision!,
    idempotencyKey: "C-2:QK-1:complete:evidence", input: { evidenceRefs: [`commit:${"a".repeat(40)}`, "review:docs/review.md", "verification:pnpm test"] },
  });
  assert.equal(completed.ok, true);
});

test("JSON completion requires review status and matching completed provenance", async () => {
  const root = await freshFixture();
  const source = await JsonTaskSource.open(root);
  let shown = await showTask(source);

  const completeBeforeReview = await mutate(source, {
    schemaVersion: 1,
    operation: "complete",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:complete:before-review",
    input: { evidenceRefs: ["commit:abc", "review:evt", "verification:pnpm-test"] },
  });
  assert.equal(completeBeforeReview.ok, false);
  if (completeBeforeReview.ok) assert.fail("expected review-status conflict");
  assert.equal(completeBeforeReview.error.code, "SOURCE_CONFLICT");

  const claim = await mutate(source, {
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:claim:completion-guard",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  });
  assert.equal(claim.ok, true);
  shown = await showTask(source);
  const review = await mutate(source, {
    schemaVersion: 1,
    operation: "submit-review",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:review:completion-guard",
    input: { evidenceRefs: ["review:evt"] },
  });
  assert.equal(review.ok, true);
  shown = await showTask(source);

  const completeWithoutProvenance = await mutate(source, {
    schemaVersion: 1,
    operation: "complete",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:complete:no-provenance",
    input: { evidenceRefs: ["commit:abc", "review:evt", "verification:pnpm-test"] },
  });
  assert.equal(completeWithoutProvenance.ok, false);
  if (completeWithoutProvenance.ok) assert.fail("expected provenance conflict");
  assert.equal(completeWithoutProvenance.error.code, "SOURCE_CONFLICT");
});

test("JSON driver applies semantic mutations and preserves atomic writes", async () => {
  const root = await freshFixture();
  const source = await JsonTaskSource.open(root);
  const tasksPath = tasksFile(root);

  let shown = await showTask(source);
  assert.equal((shown.data as { status: string }).status, "ready");

  const claim = await mutate(source, {
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:claim:evt-1",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  });
  assert.equal(claim.ok, true);
  shown = await showTask(source);
  assert.equal((shown.data as { status: string }).status, "claimed");
  assert.deepEqual((shown.data as { coordination: unknown }).coordination, {
    scope: "local-clone",
    campaignId: "C-1",
    owner: "supervisor:S-1",
    claimedAt: "2026-07-21T00:00:00.000Z",
  });
  assert.match(await readFile(tasksPath, "utf8"), /\n$/);

  const release = await mutate(source, {
    schemaVersion: 1,
    operation: "release",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:release:evt-1",
    input: { campaignId: "C-1" },
  });
  assert.equal(release.ok, true);
  shown = await showTask(source);
  assert.equal((shown.data as { status: string }).status, "ready");
  assert.equal((shown.data as { coordination: unknown }).coordination, null);

  const reclaim = await mutate(source, {
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:claim:evt-2",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T01:00:00.000Z" },
  });
  assert.equal(reclaim.ok, true);
  shown = await showTask(source);

  const attach = await mutate(source, {
    schemaVersion: 1,
    operation: "attach-provenance",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:attach-provenance:evt-1",
    input: { iteration: sampleIteration },
  });
  assert.equal(attach.ok, true);
  shown = await showTask(source);
  const iterations = ((shown.data as { provenance: { iterations: unknown[] } }).provenance).iterations;
  assert.equal(iterations.length, 1);
  assert.deepEqual(iterations[0], sampleIteration);

  const replayAttach = await mutate(source, {
    schemaVersion: 1,
    operation: "attach-provenance",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:attach-provenance:evt-1b",
    input: { iteration: sampleIteration },
  });
  assert.equal(replayAttach.ok, true);
  assert.equal(replayAttach.nativeRevision, shown.nativeRevision);

  const conflictingAttach = await mutate(source, {
    schemaVersion: 1,
    operation: "attach-provenance",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:attach-provenance:evt-conflict",
    input: {
      iteration: { ...sampleIteration, outcome: "partial" },
    },
  });
  assert.equal(conflictingAttach.ok, false);
  if (conflictingAttach.ok) assert.fail("expected provenance conflict");
  assert.equal(conflictingAttach.error.code, "SOURCE_CONFLICT");

  const submitReview = await mutate(source, {
    schemaVersion: 1,
    operation: "submit-review",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:submit-review:evt-1",
    input: { evidenceRefs: ["review:evt-1"] },
  });
  assert.equal(submitReview.ok, true);
  shown = await showTask(source);
  assert.equal((shown.data as { status: string }).status, "in_review");

  const completeWithIncompleteEvidence = await mutate(source, {
    schemaVersion: 1,
    operation: "complete",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:complete:evt-fail",
    input: { evidenceRefs: ["commit:abc123"] },
  });
  assert.equal(completeWithIncompleteEvidence.ok, false);
  if (completeWithIncompleteEvidence.ok) assert.fail("expected completion conflict");
  assert.equal(completeWithIncompleteEvidence.error.code, "SOURCE_CONFLICT");
  const beforeComplete = await fileDigest(tasksPath);
  shown = await showTask(source);
  assert.equal((shown.data as { status: string }).status, "in_review");

  const block = await mutate(source, {
    schemaVersion: 1,
    operation: "block",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:block:evt-1",
    input: { reason: "needs input", unblockCondition: "clarify requirements" },
  });
  assert.equal(block.ok, true);
  shown = await showTask(source);
  assert.equal((shown.data as { status: string }).status, "blocked");

  const blockedComplete = await mutate(source, {
    schemaVersion: 1,
    operation: "complete",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:complete:blocked",
    input: { evidenceRefs: [`commit:${"a".repeat(40)}`, "review:docs/review.md", "verification:pnpm test"] },
  });
  assert.equal(blockedComplete.ok, false);
  if (blockedComplete.ok) assert.fail("blocked task completed");
  assert.equal(blockedComplete.error.code, "SOURCE_CONFLICT");

  const resubmitReview = await mutate(source, {
    schemaVersion: 1,
    operation: "submit-review",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:submit-review:evt-2",
    input: { evidenceRefs: ["review:evt-2"] },
  });
  assert.equal(resubmitReview.ok, true);
  shown = await showTask(source);

  const complete = await mutate(source, {
    schemaVersion: 1,
    operation: "complete",
    taskId: "QK-1",
    expectedNativeRevision: shown.nativeRevision!,
    idempotencyKey: "C-1:QK-1:complete:evt-1",
    input: { evidenceRefs: [`commit:${"a".repeat(40)}`, "review:docs/review.md", "verification:pnpm test"] },
  });
  assert.equal(complete.ok, true);
  shown = await showTask(source);
  assert.equal((shown.data as { status: string }).status, "completed");
  assert.equal((shown.data as { coordination: unknown }).coordination, null);
  assert.notEqual(await fileDigest(tasksPath), beforeComplete);

  const propose = await mutate(source, {
    schemaVersion: 1,
    operation: "propose",
    taskId: "QK-2",
    expectedNativeRevision: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    idempotencyKey: "C-1:QK-2:propose:evt-1",
    input: { task: proposedTask },
  });
  assert.equal(propose.ok, true);
  const proposed = await showTask(source, "QK-2");
  assert.equal((proposed.data as { id: string }).id, "QK-2");

  const verifyTask = await source.execute({
    schemaVersion: 1,
    operation: "verify",
    taskId: "QK-1",
    input: { scope: "task" },
  });
  assert.equal(verifyTask.ok, true);
  if (!verifyTask.ok) return;
  assert.deepEqual(verifyTask.data, { scope: "task", taskId: "QK-1", commands: ["pnpm test"] });

  const verifyCampaign = await source.execute({
    schemaVersion: 1,
    operation: "verify",
    input: { scope: "campaign" },
  });
  assert.equal(verifyCampaign.ok, true);
  if (!verifyCampaign.ok) return;
  assert.ok((verifyCampaign.data as { commands: unknown[] }).commands.length >= 2);
});

test("JSON driver rejects task files that escape the repository via symlink", async () => {
  const root = await freshFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "quirks-json-outside-"));
  await cp(tasksFile(root), path.join(outside, "tasks.json"));
  await rm(tasksFile(root));
  await symlink(path.join(outside, "tasks.json"), tasksFile(root));
  await assert.rejects(
    () => JsonTaskSource.open(root),
    (error: QuirksError) => error.code === "PROTOCOL_VIOLATION",
  );
});
