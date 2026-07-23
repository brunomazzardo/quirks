import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanProgressProjection } from "../../../src/ui/read-models/plan-progress.js";
import {
  FIXTURE_PLAN_COMMIT,
  FIXTURE_PLAN_PATH,
  fixtureWithReportedCompletion,
} from "../support/plan-progress-fixture.js";

test("derives the plan and steps from the journal event it is fed", () => {
  const result = buildPlanProgressProjection(fixtureWithReportedCompletion());
  assert.equal(result.available, true);
  if (!result.available) return;
  const projection = result.projection;
  // Plan binding facts come from the event's binding, nowhere else.
  assert.equal(projection.plan.path, FIXTURE_PLAN_PATH);
  assert.equal(projection.plan.commit, FIXTURE_PLAN_COMMIT);
  assert.equal(projection.plan.taskNumber, 14);
  // Plan-document task titles are not journaled; the projection never invents one.
  assert.equal(projection.plan.taskTitle, null);
  // Steps are exactly the journaled step keys, with derived restatement labels.
  assert.deepEqual(
    projection.steps.map((step) => step.key),
    ["task-14/step-1", "task-14/step-2", "task-14/step-3"],
  );
  assert.deepEqual(
    projection.steps.map((step) => step.label),
    ["Plan task 14 · step 1", "Plan task 14 · step 2", "Plan task 14 · step 3"],
  );
  assert.equal(projection.execution.jobId, "job-1");
  // Progress age derives from the real timestamps (refreshedAt − workerReportedAt).
  assert.equal(projection.execution.progressAgeSeconds, 1);
  assert.equal(projection.source, "controller-journal");
});

test("keeps worker-reported completion distinct from controller review", () => {
  const result = buildPlanProgressProjection(fixtureWithReportedCompletion());
  assert.equal(result.available, true);
  if (!result.available) return;
  const projection = result.projection;
  assert.equal(projection.execution.status, "reported_complete");
  assert.equal(projection.steps.at(-1)?.status, "reported_complete");
  assert.equal(projection.completionAuthority, "controller");
  assert.equal(projection.steps.at(-1)?.reviewedAt, null);
});

test("marks completed steps reviewed with the controller observation time", () => {
  const input = fixtureWithReportedCompletion();
  input.journalEvent = {
    ...input.journalEvent!,
    status: "running",
    stage: "implement",
    currentStepKey: "task-14/step-2",
    completedStepIds: ["task-14/step-1"],
    source: "controller",
  };
  const result = buildPlanProgressProjection(input);
  assert.equal(result.available, true);
  if (!result.available) return;
  const [first, second] = result.projection.steps;
  assert.equal(first?.status, "reviewed");
  assert.equal(first?.reviewedAt, input.journalEvent.controllerObservedAt);
  assert.equal(second?.status, "active");
  assert.equal(second?.reviewedAt, null);
});

test("maps the legacy ledger source honestly", () => {
  const input = fixtureWithReportedCompletion();
  input.journalEvent = { ...input.journalEvent!, source: "legacy-superpowers-ledger" };
  const result = buildPlanProgressProjection(input);
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.equal(result.projection.source, "legacy-best-effort");
});

test("reports unavailable instead of fabricating when no journal event exists", () => {
  const result = buildPlanProgressProjection({
    campaignId: "C-1",
    taskId: "QK-1",
    refreshedAt: "2026-07-21T18:00:10.000Z",
  });
  assert.deepEqual(result, { available: false, reason: "no-journal-progress" });
});
