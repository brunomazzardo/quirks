import assert from "node:assert/strict";
import test from "node:test";
import { applyEvent, assertTransition, initialSnapshot } from "../../src/campaign/state-machine.js";

test("allows draft to preflight and rejects skipping approval", () => {
  assert.doesNotThrow(() => assertTransition("draft", "preflight"));
  assert.throws(() => assertTransition("draft", "running"), /ILLEGAL_TRANSITION/);
});

test("running can pause and resume without rewriting history", () => {
  const running = { ...initialSnapshot("cmp-1", "sha256:digest"), status: "running" as const };
  const paused = applyEvent(running, { schemaVersion: 1, id: "evt-1", type: "state.changed", at: "2026-07-21T16:00:01.000Z", actor: "control-plane", from: "running", to: "paused", reason: "usage_limit", evidence: {} });
  assert.equal(paused.status, "paused");
  assert.equal(paused.pausedReason, "usage_limit");
});
