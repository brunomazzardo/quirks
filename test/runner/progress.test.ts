import assert from "node:assert/strict";
import test from "node:test";
import { updateRunnerProgress } from "../../src/runner/progress.js";
import { createProgressStoreFixture } from "./support/progress-fixture.js";

test("atomically advances only the bound job and plan step", async () => {
  const fixture = await createProgressStoreFixture({ jobId: "job-1", allowedPlanTasks: [14] });
  const contextPath = fixture.contextPath;
  const progress = await updateRunnerProgress(contextPath, {
    status: "running",
    stage: "implement",
    planTask: 14,
    step: 1,
    tddPhase: "red",
    completedStepIds: [],
    note: "Focused test fails as expected",
  }, "2026-07-21T18:00:01.000Z");
  assert.equal(progress.revision, 1);
  assert.deepEqual(progress.plan, { path: fixture.binding.planPath, commit: fixture.binding.planCommit, task: 14, step: 1 });
  assert.equal(progress.jobId, "job-1");
});

test("worker reported completion cannot complete canonical task state", async () => {
  const fixture = await createProgressStoreFixture({ jobId: "job-1", allowedPlanTasks: [14] });
  await fixture.report({ status: "reported_complete", stage: "commit", planTask: 14, step: 5, completedStepIds: fixture.allStepIds, tddPhase: null });
  assert.equal((await fixture.taskSource.show(fixture.binding.taskId)).status, "claimed");
  assert.equal((await fixture.store.readState()).status, "awaiting_approval");
});
