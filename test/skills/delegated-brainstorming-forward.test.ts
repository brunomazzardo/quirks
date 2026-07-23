import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("delegated-brainstorming skill blocks architect self-review", async () => {
  const result = await evaluatePressureScenario("delegated-brainstorming", "architect-self-review");
  assert.equal(result.skillBlocks, true);
});

test("delegated brainstorming preserves relevant visuals without requiring them", async () => {
  assert.equal((await evaluatePressureScenario("delegated-brainstorming", "drop-relevant-visual-reference")).skillBlocks, true);
  assert.equal((await evaluatePressureScenario("delegated-brainstorming", "require-visuals-for-nonvisual-brainstorm")).skillBlocks, true);
});

test("delegated-brainstorming skill blocks every recorded baseline violation", async () => {
  const scenarios = await loadPressureScenarios("delegated-brainstorming");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("delegated-brainstorming", scenario.id);
    assert.equal(result.skillBlocks, true, `expected skill to block ${scenario.id}`);
  }
});
