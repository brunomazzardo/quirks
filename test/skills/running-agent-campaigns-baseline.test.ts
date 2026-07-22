import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("baseline agent skips approval without the parent skill", async () => {
  const result = await evaluatePressureScenario("running-agent-campaigns", "skip-approval", { loadSkill: false });
  assert.equal(result.observedViolation, "approval_bypass");
  assert.equal(result.skillWouldForbid, false);
});

test("every running-agent-campaigns pressure scenario records a baseline violation", async () => {
  const scenarios = await loadPressureScenarios("running-agent-campaigns");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("running-agent-campaigns", scenario.id, { loadSkill: false });
    assert.equal(result.observedViolation, scenario.observedViolation);
  }
});
