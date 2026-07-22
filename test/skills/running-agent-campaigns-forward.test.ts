import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("running-agent-campaigns skill blocks approval bypass", async () => {
  const result = await evaluatePressureScenario("running-agent-campaigns", "skip-approval");
  assert.equal(result.skillBlocks, true);
});

test("running-agent-campaigns skill blocks every recorded baseline violation", async () => {
  const scenarios = await loadPressureScenarios("running-agent-campaigns");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("running-agent-campaigns", scenario.id);
    assert.equal(result.skillBlocks, true, `expected skill to block ${scenario.id}`);
  }
});
