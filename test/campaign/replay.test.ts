import assert from "node:assert/strict";
import test from "node:test";
import { replayEvents } from "../../src/campaign/replay.js";

test("rebuilds state.json from append-only events", () => {
  const snapshot = replayEvents("cmp-1", "sha256:digest", [
    { schemaVersion: 1, id: "evt-1", type: "state.changed", at: "2026-07-21T16:00:00.000Z", actor: "control-plane", from: "draft", to: "preflight", reason: "created", evidence: {} },
    { schemaVersion: 1, id: "evt-2", type: "state.changed", at: "2026-07-21T16:00:01.000Z", actor: "control-plane", from: "preflight", to: "awaiting_approval", reason: "proposal_ready", evidence: {} },
  ]);
  assert.equal(snapshot.status, "awaiting_approval");
});

test("rejects a torn event sequence", () => {
  assert.throws(() => replayEvents("cmp-1", "sha256:digest", [{ schemaVersion: 1, id: "evt", type: "state.changed", at: "2026-07-21T16:00:00.000Z", actor: "control-plane", from: "running", to: "paused", reason: "x", evidence: {} }]), /TORN_EVENT_SEQUENCE/);
});
