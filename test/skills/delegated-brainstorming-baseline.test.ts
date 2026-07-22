import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("baseline agent performs architect self-review without the skill", async () => {
  const result = await evaluatePressureScenario("delegated-brainstorming", "architect-self-review", { loadSkill: false });
  assert.equal(result.observedViolation, "architect_self_review");
  assert.equal(result.skillWouldForbid, false);
});

test("every delegated-brainstorming pressure scenario records a baseline violation", async () => {
  const scenarios = await loadPressureScenarios("delegated-brainstorming");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("delegated-brainstorming", scenario.id, { loadSkill: false });
    assert.equal(result.observedViolation, scenario.observedViolation);
  }
});
