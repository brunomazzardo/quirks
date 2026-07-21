import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { QuirksError } from "../../src/core/errors.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import type { SyncIntent } from "../../src/sync/types.js";

const claimRequest = {
  schemaVersion: 1 as const,
  operation: "claim" as const,
  taskId: "QK-1",
  expectedNativeRevision: "sha256:before",
  idempotencyKey: "C-1:QK-1:claim:evt-1",
  input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
};

function sampleIntent(overrides: Partial<SyncIntent> = {}): SyncIntent {
  return {
    schemaVersion: 1,
    intentId: "C-1:QK-1:claim:evt-1",
    campaignId: "C-1",
    taskId: "QK-1",
    operation: "claim",
    requestHash: "sha256:abc",
    request: claimRequest,
    state: "pending",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

test("enqueue fsyncs a pending intent before returning", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-sync-outbox-"));
  const outbox = SyncOutbox.open(path.join(dir, "sync-outbox.jsonl"));
  await outbox.enqueue(sampleIntent());
  const contents = await readFile(path.join(dir, "sync-outbox.jsonl"), "utf8");
  assert.match(contents, /sync\.intent\.enqueued/);
  assert.match(contents, /"state":"pending"/);
});

test("projects the latest state per intent from append-only events", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-sync-outbox-"));
  const outbox = SyncOutbox.open(path.join(dir, "sync-outbox.jsonl"));
  await outbox.enqueue(sampleIntent());
  await outbox.conflict("C-1:QK-1:claim:evt-1");
  const projected = await outbox.get("C-1:QK-1:claim:evt-1");
  assert.equal(projected?.state, "conflict");
  const raw = await readFile(path.join(dir, "sync-outbox.jsonl"), "utf8");
  const lines = raw.trim().split("\n");
  assert.equal(lines.length, 2);
});

test("rejects idempotency key reuse with a different request hash", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-sync-outbox-"));
  const outbox = SyncOutbox.open(path.join(dir, "sync-outbox.jsonl"));
  await outbox.enqueue(sampleIntent());
  await assert.rejects(
    () => outbox.enqueue(sampleIntent({ requestHash: "sha256:different" })),
    (error: unknown) => error instanceof QuirksError && error.code === "SOURCE_CONFLICT",
  );
});

test("lists only pending intents", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-sync-outbox-"));
  const outbox = SyncOutbox.open(path.join(dir, "sync-outbox.jsonl"));
  await outbox.enqueue(sampleIntent({ intentId: "intent-a", request: { ...claimRequest, idempotencyKey: "intent-a" } }));
  await outbox.enqueue(
    sampleIntent({
      intentId: "intent-b",
      request: { ...claimRequest, idempotencyKey: "intent-b", taskId: "QK-2" },
      taskId: "QK-2",
    }),
  );
  await outbox.acknowledge("intent-a", {
    schemaVersion: 1,
    operation: "claim",
    ok: true,
    nativeRevision: "sha256:after",
    data: {},
  });
  const pending = await outbox.listPending();
  assert.deepEqual(
    pending.map((intent) => intent.intentId),
    ["intent-b"],
  );
});
