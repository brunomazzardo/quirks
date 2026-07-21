import assert from "node:assert/strict";
import test from "node:test";
import { fixtureWithReportedCompletion } from "../../../src/ui/api/plan-progress.js";
import { buildPlanProgressProjection } from "../../../src/ui/read-models/plan-progress.js";

test("keeps worker-reported completion distinct from controller review", async () => {
  const projection = await buildPlanProgressProjection(fixtureWithReportedCompletion());
  assert.equal(projection.execution.status, "reported_complete");
  assert.equal(projection.steps.at(-1)?.status, "reported_complete");
  assert.equal(projection.completionAuthority, "controller");
  assert.equal(projection.steps.at(-1)?.reviewedAt, null);
});
