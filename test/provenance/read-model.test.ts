import assert from "node:assert/strict";
import test from "node:test";
import type { ProvenanceIteration } from "../../src/provenance/types.js";
import { buildTaskHistory } from "../../src/provenance/read-model.js";
import { createGitFixture } from "./support/git-fixture.js";

const fixture = await createGitFixture();

const baseIteration: ProvenanceIteration = {
  id: "iter-1",
  outcome: "completed",
  completionBoundary: "accepted-commit",
  artifactRefs: [{ kind: "spec", path: "docs/spec.md", commit: fixture.baseCommit }],
  commitRefs: [fixture.baseCommit],
};

test("buildTaskHistory validates references and derives commit counts", async () => {
  const history = await buildTaskHistory({
    repositoryRoot: fixture.root,
    taskId: "QK-1",
    sourceProvenance: { schemaVersion: 1, iterations: [baseIteration] },
  });
  assert.equal(history.taskId, "QK-1");
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0]?.derived.commitCount, 1);
  assert.equal(history.entries[0]?.artifactRefs[0]?.availability, "available");
});

test("buildTaskHistory marks missing historical artifacts unavailable", async () => {
  const iteration: ProvenanceIteration = {
    ...baseIteration,
    id: "iter-missing",
    artifactRefs: [{ kind: "plan", path: "docs/current-only.md", commit: fixture.baseCommit }],
  };
  const history = await buildTaskHistory({
    repositoryRoot: fixture.root,
    taskId: "QK-2",
    sourceProvenance: { schemaVersion: 1, iterations: [iteration] },
  });
  assert.equal(history.entries[0]?.artifactRefs[0]?.availability, "missing-at-commit");
  assert.equal(history.entries[0]?.artifactRefs[0]?.content, undefined);
});

test("buildTaskHistory tracks partial and superseded iterations", async () => {
  const partial: ProvenanceIteration = {
    id: "iter-partial",
    outcome: "partial",
    completionBoundary: "accepted-commit",
    commitRefs: [fixture.baseCommit],
  };
  const superseded: ProvenanceIteration = {
    id: "iter-old",
    outcome: "superseded",
    completionBoundary: "accepted-commit",
    supersededBy: "iter-partial",
    commitRefs: [fixture.baseCommit],
  };
  const history = await buildTaskHistory({
    repositoryRoot: fixture.root,
    taskId: "QK-3",
    sourceProvenance: { schemaVersion: 1, iterations: [superseded, partial] },
  });
  assert.equal(history.partialCount, 1);
  assert.equal(history.supersededCount, 1);
  assert.deepEqual(history.entries.map((entry) => entry.iteration.id), ["iter-old", "iter-partial"]);
});

test("buildTaskHistory joins campaign events by iteration id", async () => {
  const history = await buildTaskHistory({
    repositoryRoot: fixture.root,
    taskId: "QK-4",
    sourceProvenance: { schemaVersion: 1, iterations: [baseIteration] },
    campaignEvents: [{
      schemaVersion: 1,
      id: "evt-1",
      type: "provenance.attached",
      at: "2026-07-21T00:00:00.000Z",
      data: { taskId: "QK-4", iterationId: "iter-1" },
    }],
  });
  assert.equal(history.entries[0]?.journalEventIds.length, 1);
  assert.equal(history.entries[0]?.journalEventIds[0], "evt-1");
});

test("buildTaskHistory never copies artifact bodies", async () => {
  const history = await buildTaskHistory({
    repositoryRoot: fixture.root,
    taskId: "QK-5",
    sourceProvenance: { schemaVersion: 1, iterations: [baseIteration] },
  });
  const serialized = JSON.stringify(history);
  assert.equal(serialized.includes("# Executed spec"), false);
  assert.equal(serialized.includes("Current only"), false);
});
