import { validateSchema } from "../../schema/validate.js";

export interface UiPlanProgressV1 {
  schemaVersion: 1;
  refreshedAt: string;
  campaignId: string;
  taskId: string;
  plan: {
    path: string;
    commit: string;
    taskNumber: number;
    taskTitle: string;
  };
  execution: {
    jobId: string;
    agentLabel: string;
    runnerKind: string;
    model: string;
    status: "queued" | "running" | "blocked" | "awaiting_review" | "fixing" | "verifying" | "reported_complete" | "failed" | "cancelled";
    stage: "setup" | "implement" | "commit" | "review" | "fix" | "verification";
    tddPhase: "red" | "green" | "refactor" | null;
    currentStepKey: string | null;
    note: string | null;
    workerReportedAt: string | null;
    controllerObservedAt: string;
    progressAgeSeconds: number;
  };
  steps: Array<{
    key: string;
    number: number;
    label: string;
    status: "pending" | "active" | "reported_complete" | "reviewed" | "blocked" | "failed" | "cancelled";
    reportedAt: string | null;
    reviewedAt: string | null;
  }>;
  completionAuthority: "controller";
  source: "controller-journal" | "legacy-best-effort";
}

export interface PlanProgressInput {
  campaignId: string;
  taskId: string;
  refreshedAt: string;
  journalEvent?: {
    status: UiPlanProgressV1["execution"]["status"];
    stage: UiPlanProgressV1["execution"]["stage"];
    tddPhase: UiPlanProgressV1["execution"]["tddPhase"];
    currentStepKey: string | null;
    note: string | null;
    workerReportedAt: string | null;
    controllerObservedAt: string;
    completedStepIds: readonly string[];
    jobId: string;
    agentLabel: string;
    runnerKind: string;
    model: string;
  };
}

const DEFAULT_STEPS = [
  { key: "task-14/step-1", number: 1, label: "Write failing tests" },
  { key: "task-14/step-2", number: 2, label: "Build and verify supervisor is missing" },
  { key: "task-14/step-3", number: 3, label: "Implement supervisor and recovery" },
] as const;

export function buildPlanProgressProjection(input: PlanProgressInput): UiPlanProgressV1 {
  const event = input.journalEvent;
  const completed = new Set(event?.completedStepIds ?? []);
  const currentKey = event?.currentStepKey ?? null;
  const projection: UiPlanProgressV1 = {
    schemaVersion: 1,
    refreshedAt: input.refreshedAt,
    campaignId: input.campaignId,
    taskId: input.taskId,
    plan: {
      path: "docs/superpowers/plans/2026-07-21-quirks-campaign-control-plane.md",
      commit: "a".repeat(40),
      taskNumber: 14,
      taskTitle: "Campaign supervisor orchestration and crash recovery",
    },
    execution: {
      jobId: event?.jobId ?? "job-unassigned",
      agentLabel: event?.agentLabel ?? "unassigned",
      runnerKind: event?.runnerKind ?? "cursor",
      model: event?.model ?? "composer-2.5",
      status: event?.status ?? "queued",
      stage: event?.stage ?? "setup",
      tddPhase: event?.tddPhase ?? null,
      currentStepKey: currentKey,
      note: event?.note ?? null,
      workerReportedAt: event?.workerReportedAt ?? null,
      controllerObservedAt: event?.controllerObservedAt ?? input.refreshedAt,
      progressAgeSeconds: 0,
    },
    steps: DEFAULT_STEPS.map((step) => ({
      ...step,
      status: completed.has(step.key)
        ? event?.status === "reported_complete"
          ? "reported_complete"
          : "reviewed"
        : currentKey === step.key
          ? "active"
          : "pending",
      reportedAt: completed.has(step.key) ? event?.workerReportedAt ?? null : null,
      reviewedAt: null,
    })),
    completionAuthority: "controller",
    source: event ? "controller-journal" : "legacy-best-effort",
  };
  return validateSchema<UiPlanProgressV1>("ui-plan-progress-v1", projection);
}
