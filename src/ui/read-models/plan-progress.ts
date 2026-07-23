import { validateSchema } from "../../schema/validate.js";

export interface UiPlanProgressV1 {
  schemaVersion: 1;
  refreshedAt: string;
  campaignId: string;
  taskId: string;
  plan: {
    path: string;
    commit: string;
    /** Derived from the journaled step keys; null when no key names a plan task. */
    taskNumber: number | null;
    /** Plan-document task titles are not journaled; null unless real data records one. */
    taskTitle: string | null;
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

/**
 * Mirrors one durable runner-progress journal observation
 * (runner-progress-event-v1: binding + status/stage/step facts) plus the
 * dispatch facts the campaign journal records for the job (agent label,
 * runner kind, model). Every value the projection shows derives from these
 * fields — nothing is invented here.
 */
export interface PlanProgressJournalEvent {
  binding: {
    jobId: string;
    planPath: string;
    planCommit: string;
    allowedPlanTasks: readonly number[];
  };
  status: UiPlanProgressV1["execution"]["status"];
  stage: UiPlanProgressV1["execution"]["stage"];
  tddPhase: UiPlanProgressV1["execution"]["tddPhase"];
  currentStepKey: string | null;
  completedStepIds: readonly string[];
  note: string | null;
  workerReportedAt: string | null;
  controllerObservedAt: string;
  source: "worker" | "controller" | "legacy-superpowers-ledger";
  agentLabel: string;
  runnerKind: string;
  model: string;
}

export interface PlanProgressInput {
  campaignId: string;
  taskId: string;
  refreshedAt: string;
  journalEvent?: PlanProgressJournalEvent;
}

export type PlanProgressProjectionResult =
  | { available: true; projection: UiPlanProgressV1 }
  | { available: false; reason: "no-journal-progress" };

const STEP_KEY_PATTERN = /^task-(\d+)\/step-(\d+)$/;
const MAX_AGE_SECONDS = 31_536_000;

function parseStepKey(key: string): { task: number; step: number } | undefined {
  const match = STEP_KEY_PATTERN.exec(key);
  if (!match) return undefined;
  return { task: Number(match[1]), step: Number(match[2]) };
}

/**
 * The journal names steps only by key (`task-N/step-M`); the plan document's
 * step wording is not journaled, so the label is a plain restatement of the
 * key — derived, never invented.
 */
function stepLabel(key: string): string {
  const parsed = parseStepKey(key);
  return parsed ? `Plan task ${parsed.task} · step ${parsed.step}` : key;
}

function orderedStepKeys(event: PlanProgressJournalEvent): string[] {
  const keys = [...event.completedStepIds];
  if (event.currentStepKey !== null && !keys.includes(event.currentStepKey)) {
    keys.push(event.currentStepKey);
  }
  const parseable = keys.filter((key) => parseStepKey(key) !== undefined);
  const opaque = keys.filter((key) => parseStepKey(key) === undefined);
  parseable.sort((left, right) => {
    const a = parseStepKey(left)!;
    const b = parseStepKey(right)!;
    return a.task !== b.task ? a.task - b.task : a.step - b.step;
  });
  return [...new Set([...parseable, ...opaque])];
}

function deriveSteps(event: PlanProgressJournalEvent): UiPlanProgressV1["steps"] {
  const completed = new Set(event.completedStepIds);
  return orderedStepKeys(event).map((key, index) => {
    const isCompleted = completed.has(key);
    const status = isCompleted
      ? event.status === "reported_complete"
        ? ("reported_complete" as const)
        : ("reviewed" as const)
      : key === event.currentStepKey
        ? ("active" as const)
        : ("pending" as const);
    return {
      key,
      number: index + 1,
      label: stepLabel(key),
      status,
      reportedAt: isCompleted ? event.workerReportedAt : null,
      reviewedAt: status === "reviewed" ? event.controllerObservedAt : null,
    };
  });
}

function deriveTaskNumber(event: PlanProgressJournalEvent): number | null {
  if (event.currentStepKey !== null) {
    const parsed = parseStepKey(event.currentStepKey);
    if (parsed) return parsed.task;
  }
  for (let index = event.completedStepIds.length - 1; index >= 0; index -= 1) {
    const parsed = parseStepKey(event.completedStepIds[index]!);
    if (parsed) return parsed.task;
  }
  if (event.binding.allowedPlanTasks.length === 1) return event.binding.allowedPlanTasks[0]!;
  return null;
}

function deriveAgeSeconds(refreshedAt: string, event: PlanProgressJournalEvent): number {
  const basis = Date.parse(event.workerReportedAt ?? event.controllerObservedAt);
  const refreshed = Date.parse(refreshedAt);
  if (Number.isNaN(basis) || Number.isNaN(refreshed)) return 0;
  const seconds = Math.floor((refreshed - basis) / 1000);
  return Math.min(Math.max(seconds, 0), MAX_AGE_SECONDS);
}

/**
 * Projects plan progress from the journal observation it is fed. Without a
 * journal event there is nothing to project: the result is the explicit
 * unavailable state, never a fabricated plan.
 */
export function buildPlanProgressProjection(input: PlanProgressInput): PlanProgressProjectionResult {
  const event = input.journalEvent;
  if (!event) return { available: false, reason: "no-journal-progress" };
  const projection: UiPlanProgressV1 = {
    schemaVersion: 1,
    refreshedAt: input.refreshedAt,
    campaignId: input.campaignId,
    taskId: input.taskId,
    plan: {
      path: event.binding.planPath,
      commit: event.binding.planCommit,
      taskNumber: deriveTaskNumber(event),
      taskTitle: null,
    },
    execution: {
      jobId: event.binding.jobId,
      agentLabel: event.agentLabel,
      runnerKind: event.runnerKind,
      model: event.model,
      status: event.status,
      stage: event.stage,
      tddPhase: event.tddPhase,
      currentStepKey: event.currentStepKey,
      note: event.note,
      workerReportedAt: event.workerReportedAt,
      controllerObservedAt: event.controllerObservedAt,
      progressAgeSeconds: deriveAgeSeconds(input.refreshedAt, event),
    },
    steps: deriveSteps(event),
    completionAuthority: "controller",
    source: event.source === "legacy-superpowers-ledger" ? "legacy-best-effort" : "controller-journal",
  };
  return { available: true, projection: validateSchema<UiPlanProgressV1>("ui-plan-progress-v1", projection) };
}
