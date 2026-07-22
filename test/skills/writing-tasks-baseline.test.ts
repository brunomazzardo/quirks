import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario, loadPressureScenarios } from "./harness.js";

test("baseline agent edits JSON task file directly", async () => {
  const result = await evaluatePressureScenario("writing-tasks", "direct-json-edit", { loadSkill: false });
  assert.equal(result.observedViolation, "bypass_task_source");
});

test("every writing-tasks pressure scenario records a baseline violation", async () => {
  const scenarios = await loadPressureScenarios("writing-tasks");
  for (const scenario of scenarios) {
    const result = await evaluatePressureScenario("writing-tasks", scenario.id, { loadSkill: false });
    assert.equal(result.observedViolation, scenario.observedViolation);
  }
});
