import type { PlanProgressInput } from "../../../src/ui/read-models/plan-progress.js";

export const FIXTURE_PLAN_PATH = "docs/plans/2026-07-21-campaign-fixture-plan.md";
export const FIXTURE_PLAN_COMMIT = "3c".repeat(20);

/**
 * A journal event shaped exactly like the durable runner-progress journal
 * (runner-progress-event-v1 binding + observation fields) plus the dispatch
 * facts the campaign journal records for the job. Everything the projection
 * shows must derive from these fields — no constant may appear in the
 * projection that is absent here.
 */
export function fixtureWithReportedCompletion(): PlanProgressInput {
  return {
    campaignId: "C-1",
    taskId: "QK-1",
    refreshedAt: "2026-07-21T18:00:10.000Z",
    journalEvent: {
      binding: {
        jobId: "job-1",
        planPath: FIXTURE_PLAN_PATH,
        planCommit: FIXTURE_PLAN_COMMIT,
        allowedPlanTasks: [14],
      },
      status: "reported_complete",
      stage: "commit",
      tddPhase: null,
      currentStepKey: "task-14/step-3",
      completedStepIds: ["task-14/step-1", "task-14/step-2", "task-14/step-3"],
      note: "Worker reports done",
      workerReportedAt: "2026-07-21T18:00:09.000Z",
      controllerObservedAt: "2026-07-21T18:00:10.000Z",
      source: "worker",
      agentLabel: "implementer",
      runnerKind: "cursor",
      model: "composer-2.5",
    },
  };
}
