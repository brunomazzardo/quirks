import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("baseline agent violates control-plane parentage without the skill", async () => {
  const result = await evaluatePressureScenario("dispatching-external-agents", "host-subagent-parent", { loadSkill: false });
  assert.equal(result.observedViolation, "host_native_subagent_as_parent");
  assert.equal(result.skillWouldForbid, false);
});

test("every dispatch pressure scenario records a baseline violation", async () => {
  const scenarios = await loadPressureScenarios("dispatching-external-agents");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("dispatching-external-agents", scenario.id, { loadSkill: false });
    assert.equal(result.observedViolation, scenario.observedViolation);
  }
});
