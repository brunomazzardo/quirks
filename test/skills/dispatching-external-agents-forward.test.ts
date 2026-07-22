import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("dispatch skill blocks host-native subagent parentage", async () => {
  const result = await evaluatePressureScenario("dispatching-external-agents", "host-subagent-parent");
  assert.equal(result.skillBlocks, true);
});

test("dispatch skill blocks every recorded baseline violation", async () => {
  const scenarios = await loadPressureScenarios("dispatching-external-agents");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("dispatching-external-agents", scenario.id);
    assert.equal(result.skillBlocks, true, `expected skill to block ${scenario.id}`);
  }
});
