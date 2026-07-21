import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("baseline agent marks task done from executor summary alone", async () => {
  const result = await evaluatePressureScenario("executing-tasks", "summary-only-complete", { loadSkill: false });
  assert.equal(result.observedViolation, "unverified_completion");
});

test("every executing-tasks pressure scenario records a baseline violation", async () => {
  const scenarios = await loadPressureScenarios("executing-tasks");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("executing-tasks", scenario.id, { loadSkill: false });
    assert.equal(result.observedViolation, scenario.observedViolation);
  }
});
