import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("writing-tasks skill blocks direct JSON edits", async () => {
  const result = await evaluatePressureScenario("writing-tasks", "direct-json-edit");
  assert.equal(result.skillBlocks, true);
});

test("writing tasks preserves visual bindings and separates fidelity", async () => {
  assert.equal((await evaluatePressureScenario("writing-tasks", "drop-plan-visual-binding")).skillBlocks, true);
  assert.equal((await evaluatePressureScenario("writing-tasks", "treat-layout-test-as-fidelity")).skillBlocks, true);
});

test("writing-tasks skill blocks every recorded baseline violation", async () => {
  const scenarios = await loadPressureScenarios("writing-tasks");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("writing-tasks", scenario.id);
    assert.equal(result.skillBlocks, true, `expected skill to block ${scenario.id}`);
  }
});
