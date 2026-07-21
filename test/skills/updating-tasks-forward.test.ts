import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("updating-tasks skill blocks canonical status overwrite", async () => {
  const result = await evaluatePressureScenario("updating-tasks", "provider-conflict-overwrite");
  assert.equal(result.skillBlocks, true);
});

test("updating-tasks skill blocks every recorded baseline violation", async () => {
  const scenarios = await loadPressureScenarios("updating-tasks");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("updating-tasks", scenario.id);
    assert.equal(result.skillBlocks, true, `expected skill to block ${scenario.id}`);
  }
});
