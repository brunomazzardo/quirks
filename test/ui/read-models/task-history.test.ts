import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskHistoryProjection } from "../../../src/ui/read-models/task-history.js";
import { createHistoryFixture } from "../support/history-fixture.js";

test("keeps missing historical refs unavailable without substituting current content", async () => {
  const fixture = await createHistoryFixture();
  const history = await buildTaskHistoryProjection(fixture);
  const missing = history.iterations.flatMap((it) => it.artifactRefs).find((ref) => ref.availability === "missing-at-commit");
  assert.ok(missing);
  assert.equal((missing as { content?: string }).content, undefined);
});

test("marks the executed artifact available and preserves distinct identities", async () => {
  const fixture = await createHistoryFixture();
  const history = await buildTaskHistoryProjection(fixture);
  const executed = history.iterations.find((it) => it.id === "iter-1");
  assert.ok(executed);
  const availableRef = executed?.artifactRefs.find((ref) => ref.availability === "available");
  assert.ok(availableRef);
  const labels = availableRef?.identities.map((identity) => identity.label) ?? [];
  assert.ok(labels.includes("operator:jane@utilitynyc.com"));
  assert.ok(labels.includes("Signed Author <fixture@example.invalid>"));
  assert.ok(labels.includes("bot:merge-queue"));
});

test("carries the provenance artifact kind into the projection", async () => {
  const fixture = await createHistoryFixture();
  const history = await buildTaskHistoryProjection(fixture);
  const executed = history.iterations.find((it) => it.id === "iter-1");
  assert.equal(executed?.artifactRefs[0]?.kind, "spec");
  const missing = history.iterations.find((it) => it.id === "iter-missing");
  assert.equal(missing?.artifactRefs[0]?.kind, "plan");
});

test("distinguishes signed from unsigned git identities across iterations", async () => {
  const fixture = await createHistoryFixture();
  const history = await buildTaskHistoryProjection(fixture);
  const allIdentities = history.iterations.flatMap((it) => it.artifactRefs).flatMap((ref) => ref.identities);
  assert.ok(allIdentities.some((identity) => identity.evidence === "git-signature" && identity.verified === true));
  assert.ok(allIdentities.some((identity) => identity.evidence === "self-asserted-git-metadata" && identity.verified === false));
});
