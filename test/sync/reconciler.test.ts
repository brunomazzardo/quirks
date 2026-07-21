import assert from "node:assert/strict";
import test from "node:test";
import { syncBoundary } from "../../src/sync/boundaries.js";
import { reconcileMutation, reconcilePending } from "../../src/sync/reconciler.js";
import type { SyncIntent } from "../../src/sync/types.js";
import type { TaskSource } from "../../src/task-source/task-source.js";
import type { MutationRequest, TaskSourceRequest, TaskSourceResponse } from "../../src/task-source/types.js";
import { AmbiguousThenAcknowledgedSource } from "./support/ambiguous-source.js";
import { MemoryOutbox } from "./support/memory-outbox.js";

test("persists intent before source call and resolves ambiguity by fresh source state", async () => {
  const outbox = new MemoryOutbox();
  const source = new AmbiguousThenAcknowledgedSource();
  const result = await reconcileMutation({ campaignId: "C-1", outbox, source, request: source.claimRequest });
  assert.deepEqual(outbox.transitions, ["pending", "acknowledged"]);
  assert.equal(result.state, "acknowledged");
  assert.equal(source.mutationCalls, 1);
});

test("canonical conflict pauses instead of overwriting", async () => {
  const outbox = new MemoryOutbox();
  const source = new AmbiguousThenAcknowledgedSource({ conflict: true });
  const result = await reconcileMutation({ campaignId: "C-1", outbox, source, request: source.claimRequest });
  assert.equal(result.state, "conflict");
  assert.equal(source.mutationCalls, 1);
});

test("leaves intent pending when outage has no positive acknowledgement evidence", async () => {
  const outbox = new MemoryOutbox();
  const source = new OutageWithoutEvidenceSource();
  const result = await reconcileMutation({ campaignId: "C-1", outbox, source, request: source.claimRequest });
  assert.deepEqual(outbox.transitions, ["pending"]);
  assert.equal(result.state, "pending");
  assert.equal(source.mutationCalls, 1);
});

test("acknowledges a successful mutation without ambiguity", async () => {
  const outbox = new MemoryOutbox();
  const source = new ImmediateAckSource();
  const result = await reconcileMutation({ campaignId: "C-1", outbox, source, request: source.claimRequest });
  assert.deepEqual(outbox.transitions, ["pending", "acknowledged"]);
  assert.equal(result.state, "acknowledged");
});

test("reconcilePending resolves pending intents via show evidence without retrying mutation", async () => {
  const outbox = new TrackingOutbox();
  const source = new AmbiguousThenAcknowledgedSource();
  await outbox.enqueue(pendingIntent(source.claimRequest));
  const resolved = await reconcilePending({ campaignId: "C-1", outbox, source });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.state, "acknowledged");
  assert.equal(source.mutationCalls, 0);
});

test("syncBoundary blocks final-report while required completion intent stays pending", async () => {
  const outbox = new TrackingOutbox();
  await outbox.enqueue({
    ...pendingIntent({
      schemaVersion: 1,
      operation: "complete",
      taskId: "QK-1",
      expectedNativeRevision: "sha256:before",
      idempotencyKey: "C-1:QK-1:complete:evt-2",
      input: { evidenceRefs: ["evidence-1"] },
    }),
    operation: "complete",
  });
  const source = new ShowOnlySource();
  const result = await syncBoundary({
    boundary: "final-report",
    campaignId: "C-1",
    outbox,
    source,
    taskIds: ["QK-1"],
  });
  assert.equal(result.ok, false);
  assert.match(result.blockedReason ?? "", /pending/i);
});

class OutageWithoutEvidenceSource implements TaskSource {
  mutationCalls = 0;
  readonly claimRequest: MutationRequest = {
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: "sha256:before",
    idempotencyKey: "C-1:QK-1:claim:evt-3",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  };

  async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
    if (request.operation === "claim") {
      this.mutationCalls += 1;
      throw Object.assign(new Error("provider unavailable"), { code: "SOURCE_UNAVAILABLE" });
    }
    if (request.operation === "show") {
      return {
        schemaVersion: 1,
        operation: "show",
        ok: true,
        nativeRevision: "sha256:before",
        data: { id: "QK-1", status: "ready", coordination: {} },
      };
    }
    if (request.operation === "capabilities") {
      return capabilitiesResponse("none");
    }
    return { schemaVersion: 1, operation: request.operation, ok: true, data: {} } as TaskSourceResponse;
  }
}

class ImmediateAckSource implements TaskSource {
  readonly claimRequest: MutationRequest = {
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: "sha256:before",
    idempotencyKey: "C-1:QK-1:claim:evt-4",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  };

  async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
    if (request.operation === "claim") {
      return {
        schemaVersion: 1,
        operation: "claim",
        ok: true,
        nativeRevision: "sha256:after",
        data: { id: "QK-1", status: "claimed" },
      };
    }
    return { schemaVersion: 1, operation: request.operation, ok: true, data: {} } as TaskSourceResponse;
  }
}

class ShowOnlySource implements TaskSource {
  async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
    if (request.operation === "show") {
      return {
        schemaVersion: 1,
        operation: "show",
        ok: true,
        nativeRevision: "sha256:current",
        data: { id: request.taskId, status: "claimed" },
      };
    }
    if (request.operation === "capabilities") {
      return capabilitiesResponse("state");
    }
    return { schemaVersion: 1, operation: request.operation, ok: true, data: {} } as TaskSourceResponse;
  }
}

class TrackingOutbox {
  private intents: SyncIntent[] = [];

  async enqueue(intent: SyncIntent): Promise<void> {
    this.intents.push(intent);
  }

  async transition(intentId: string, state: SyncIntent["state"], acknowledgement?: TaskSourceResponse): Promise<void> {
    const index = this.intents.findIndex((intent) => intent.intentId === intentId);
    if (index < 0) throw new Error("missing intent");
    this.intents[index] = {
      ...this.intents[index]!,
      state,
      updatedAt: "2026-07-21T00:00:01.000Z",
      ...(acknowledgement ? { acknowledgement } : {}),
    };
  }

  async listPending(): Promise<SyncIntent[]> {
    return this.intents.filter((intent) => intent.state === "pending");
  }
}

function pendingIntent(request: MutationRequest): SyncIntent {
  return {
    schemaVersion: 1,
    intentId: request.idempotencyKey,
    campaignId: "C-1",
    taskId: request.taskId,
    operation: request.operation,
    requestHash: "sha256:test",
    request,
    state: "pending",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

function capabilitiesResponse(idempotencyLookup: "none" | "state" | "key"): TaskSourceResponse {
  return {
    schemaVersion: 1,
    operation: "capabilities",
    ok: true,
    data: {
      schemaVersion: 1,
      protocol: "task-source-v1",
      driver: "test",
      concurrencyStrength: "optimistic",
      provenanceWriteMode: "none",
      commentWriteMode: "none",
      idempotencyLookup,
      operations: ["capabilities", "show", "claim", "complete"],
      authorityClasses: ["external-system"],
      completionBoundaries: [],
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 1_048_576,
    },
  };
}
