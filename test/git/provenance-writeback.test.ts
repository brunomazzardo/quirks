import assert from "node:assert/strict";
import test from "node:test";
import { QuirksError } from "../../src/core/errors.js";
import { assertLandingProvenanceReady, writeLandingProvenance } from "../../src/git/provenance-writeback.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import type { MutationRequest, TaskSourceResponse } from "../../src/task-source/types.js";
import { FakeTaskSource } from "../task-source/fake-source.js";
import { createGitFixture } from "./support/git-fixture.js";

class LandingFakeTaskSource extends FakeTaskSource {
  override async execute(request: Parameters<FakeTaskSource["execute"]>[0]): Promise<TaskSourceResponse> {
    if (request.operation === "attach-provenance") {
      const mutation = request as MutationRequest & { operation: "attach-provenance" };
      const iteration = mutation.input.iteration as { id: string };
      const show = await super.execute({ schemaVersion: 1, operation: "show", taskId: mutation.taskId, input: {} });
      if (!show.ok || show.operation !== "show") return show;
      const data = { ...(show.data as Record<string, unknown>) };
      const provenance = (data.provenance as { schemaVersion: 1; iterations: unknown[] }) ?? { schemaVersion: 1, iterations: [] };
      provenance.iterations = [...provenance.iterations, iteration];
      data.provenance = provenance;
      const response: TaskSourceResponse = {
        schemaVersion: 1,
        operation: "attach-provenance",
        ok: true,
        data,
      };
      if (show.nativeRevision) response.nativeRevision = show.nativeRevision;
      return response;
    }
    return super.execute(request);
  }
}

test("rejects invalid landing commit candidates", async () => {
  const fixture = await createGitFixture();
  const source = new FakeTaskSource();
  const outbox = SyncOutbox.open(`${fixture.stateDir}/outbox.jsonl`);
  await assert.rejects(
    () => assertLandingProvenanceReady({
      repositoryRoot: fixture.root,
      campaignId: "cmp-prov-1",
      taskId: "QK-1",
      landingCommit: "0".repeat(40),
      expectedNativeRevision: "sha256:rev",
      source,
      outbox,
      attachIdempotencyKey: "attach-1",
      completeIdempotencyKey: "complete-1",
      iterationId: "iter-landing-1",
    }),
    (error: unknown) => error instanceof QuirksError,
  );
});

test("rejects complete before attach-provenance acknowledgement", async () => {
  const fixture = await createGitFixture();
  const source = new FakeTaskSource();
  const outbox = SyncOutbox.open(`${fixture.stateDir}/outbox.jsonl`);
  await assert.rejects(
    () => writeLandingProvenance({
      repositoryRoot: fixture.root,
      campaignId: "cmp-prov-1",
      taskId: "QK-UNKNOWN",
      landingCommit: fixture.head,
      expectedNativeRevision: "sha256:rev",
      source,
      outbox,
      attachIdempotencyKey: "attach-2",
      completeIdempotencyKey: "complete-2",
      iterationId: "iter-landing-2",
    }),
    (error: unknown) => error instanceof QuirksError,
  );
});

test("writes landing provenance then completes after acknowledgement", async () => {
  const fixture = await createGitFixture();
  const source = new LandingFakeTaskSource();
  const outbox = SyncOutbox.open(`${fixture.stateDir}/outbox.jsonl`);
  const show = await source.execute({ schemaVersion: 1, operation: "show", taskId: "QK-1", input: {} });
  assert.equal(show.ok, true);
  const result = await writeLandingProvenance({
    repositoryRoot: fixture.root,
    campaignId: "cmp-prov-1",
    taskId: "QK-1",
    landingCommit: fixture.head,
    expectedNativeRevision: show.nativeRevision!,
    source,
    outbox,
    attachIdempotencyKey: "C-1:QK-1:attach-provenance:landing",
    completeIdempotencyKey: "C-1:QK-1:complete:landing",
    iterationId: "iter-landing-3",
  });
  assert.equal(result.attached, true);
  assert.equal(result.completed, true);
});
