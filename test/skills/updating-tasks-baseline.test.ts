import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("baseline agent overwrites canonical status during conflict", async () => {
  const result = await evaluatePressureScenario("updating-tasks", "provider-conflict-overwrite", { loadSkill: false });
  assert.equal(result.observedViolation, "canonical_status_overwrite");
});

test("every updating-tasks pressure scenario records a baseline violation", async () => {
  const scenarios = await loadPressureScenarios("updating-tasks");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("updating-tasks", scenario.id, { loadSkill: false });
    assert.equal(result.observedViolation, scenario.observedViolation);
  }
});
