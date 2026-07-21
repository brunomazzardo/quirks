import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCircuitBreakers } from "../../src/campaign/circuit-breakers.js";

test("pauses a lane after two consecutive task failures", () => {
  const decision = evaluateCircuitBreakers({
    laneFailureThreshold: 2,
    consecutiveLaneFailures: 2,
    integrationFailure: false,
    envelopeDrift: false,
    usageLimitWithoutReset: false,
  });
  assert.equal(decision.action, "pause_lane");
});

test("pauses the campaign after integration verification failure", () => {
  const decision = evaluateCircuitBreakers({
    laneFailureThreshold: 2,
    consecutiveLaneFailures: 0,
    integrationFailure: true,
    envelopeDrift: false,
    usageLimitWithoutReset: false,
  });
  assert.equal(decision.action, "pause_campaign");
});

test("stops before dispatch when budget would be exceeded", () => {
  const decision = evaluateCircuitBreakers({
    laneFailureThreshold: 2,
    consecutiveLaneFailures: 0,
    integrationFailure: false,
    envelopeDrift: false,
    usageLimitWithoutReset: false,
    budgetExceeded: true,
  });
  assert.deepEqual(decision, { action: "stop", reason: "BUDGET_EXCEEDED" });
});

test("pauses on revision drift and holds ambiguous accepted or pushed state", () => {
  assert.equal(evaluateCircuitBreakers({
    laneFailureThreshold: 2,
    consecutiveLaneFailures: 0,
    integrationFailure: false,
    envelopeDrift: true,
    usageLimitWithoutReset: false,
  }).action, "pause_campaign");

  assert.equal(evaluateCircuitBreakers({
    laneFailureThreshold: 2,
    consecutiveLaneFailures: 0,
    integrationFailure: false,
    envelopeDrift: false,
    usageLimitWithoutReset: false,
    ambiguousAcceptedOrPushed: true,
  }).action, "hold");
});
