import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { QuirksError } from "../core/errors.js";
import { writeJsonAtomic } from "../state/atomic-file.js";
import { validateSchema } from "../schema/validate.js";
import type { CampaignStore } from "../campaign/store.js";
import type { ProgressBinding } from "../campaign/types.js";

export interface RunnerProgressUpdate {
  status: "queued" | "running" | "blocked" | "awaiting_review" | "fixing" | "verifying" | "reported_complete" | "failed" | "cancelled";
  stage: "setup" | "implement" | "commit" | "review" | "fix" | "verification";
  planTask: number;
  step: number;
  tddPhase?: "red" | "green" | "refactor" | null;
  completedStepIds: readonly string[];
  note?: string;
}

export interface RunnerProgress {
  schemaVersion: 1;
  jobId: string;
  revision: number;
  status: RunnerProgressUpdate["status"];
  stage: RunnerProgressUpdate["stage"];
  tddPhase: "red" | "green" | "refactor" | null;
  plan: { path: string; commit: string; task: number; step: number };
  completedStepIds: readonly string[];
  note?: string;
  reportedAt?: string;
}

export interface RunnerProgressEvent {
  schemaVersion: 1;
  binding: ProgressBinding;
  revision: number;
  status: RunnerProgress["status"];
  stage: RunnerProgress["stage"];
  tddPhase: "red" | "green" | "refactor" | null;
  currentStepKey: string | null;
  completedStepIds: readonly string[];
  note?: string;
  reportedAt?: string;
  observedAt: string;
  source: "worker" | "controller" | "legacy-superpowers-ledger";
}

interface ProgressContext {
  schemaVersion: 1;
  binding: ProgressBinding;
}

const MAX_NOTE_BYTES = 256;

function assertAllowedPlanTask(binding: ProgressBinding, planTask: number): void {
  if (!binding.allowedPlanTasks.includes(planTask)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Plan task is outside binding");
  }
}

function sanitizeNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined;
  const bytes = Buffer.byteLength(note, "utf8");
  if (bytes > MAX_NOTE_BYTES) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Progress note exceeds byte limit");
  }
  if (/api[_-]?key|bearer\s+|password/i.test(note)) {
    throw new QuirksError("SECRET_REJECTED", "Progress note contains secret-shaped content");
  }
  return note;
}

async function readContext(contextPath: string): Promise<ProgressContext> {
  const parsed = JSON.parse(await readFile(contextPath, "utf8")) as ProgressContext;
  if (parsed.schemaVersion !== 1 || !parsed.binding) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Malformed progress context");
  }
  return parsed;
}

export async function initializeProgressMailbox(
  store: CampaignStore,
  binding: ProgressBinding,
  now: string,
): Promise<string> {
  validateSchema<ProgressBinding>("runner-progress-binding-v1", binding);
  const artifactDir = path.join(store.artifactsPath, binding.jobId);
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  const contextPath = path.join(artifactDir, "progress-context.json");
  const progressPath = path.join(artifactDir, "progress.json");
  const context: ProgressContext = { schemaVersion: 1, binding };
  await writeJsonAtomic(contextPath, context);
  const initial: RunnerProgress = {
    schemaVersion: 1,
    jobId: binding.jobId,
    revision: 0,
    status: "queued",
    stage: "setup",
    tddPhase: null,
    plan: { path: binding.planPath, commit: binding.planCommit, task: binding.allowedPlanTasks[0] ?? 1, step: 1 },
    completedStepIds: [],
  };
  await writeJsonAtomic(progressPath, initial);
  await observeRunnerProgress(store, binding.jobId, now, "controller");
  return contextPath;
}

export async function updateRunnerProgress(
  contextPath: string,
  update: RunnerProgressUpdate,
  now: string,
): Promise<RunnerProgress> {
  const context = await readContext(contextPath);
  assertAllowedPlanTask(context.binding, update.planTask);
  const progressPath = path.join(path.dirname(contextPath), "progress.json");
  const previous = validateSchema<RunnerProgress>("runner-progress-v1", JSON.parse(await readFile(progressPath, "utf8")));
  if (update.status === "reported_complete" && previous.status === "queued") {
    throw new QuirksError("PROTOCOL_VIOLATION", "Illegal progress transition");
  }

  const next: RunnerProgress = {
    schemaVersion: 1,
    jobId: context.binding.jobId,
    revision: previous.revision + 1,
    status: update.status,
    stage: update.stage,
    tddPhase: update.tddPhase ?? null,
    plan: {
      path: context.binding.planPath,
      commit: context.binding.planCommit,
      task: update.planTask,
      step: update.step,
    },
    completedStepIds: [...new Set(update.completedStepIds)],
    reportedAt: now,
    ...(sanitizeNote(update.note) !== undefined ? { note: sanitizeNote(update.note)! } : {}),
  };
  validateSchema<RunnerProgress>("runner-progress-v1", next);
  await writeJsonAtomic(progressPath, next);
  return next;
}

export async function observeRunnerProgress(
  store: CampaignStore,
  jobId: string,
  now: string,
  source: RunnerProgressEvent["source"] = "worker",
): Promise<RunnerProgressEvent | undefined> {
  const progressPath = path.join(store.artifactsPath, jobId, "progress.json");
  const contextPath = path.join(store.artifactsPath, jobId, "progress-context.json");
  const context = await readContext(contextPath);
  const progress = validateSchema<RunnerProgress>("runner-progress-v1", JSON.parse(await readFile(progressPath, "utf8")));
  const existing = await store.readProgressEvents();
  if (existing.some((event) => event.jobId === jobId && event.revision === progress.revision)) {
    return undefined;
  }

  const event: RunnerProgressEvent = {
    schemaVersion: 1,
    binding: context.binding,
    revision: progress.revision,
    status: progress.status,
    stage: progress.stage,
    tddPhase: progress.tddPhase,
    currentStepKey: `task-${progress.plan.task}/step-${progress.plan.step}`,
    completedStepIds: progress.completedStepIds,
    ...(progress.note ? { note: progress.note } : {}),
    ...(progress.reportedAt ? { reportedAt: progress.reportedAt } : {}),
    observedAt: now,
    source,
  };
  validateSchema<RunnerProgressEvent>("runner-progress-event-v1", event);
  await store.appendProgressEvent({
    schemaVersion: 1,
    jobId,
    revision: progress.revision,
    observedAt: now,
    event: event as unknown as Record<string, unknown>,
  });
  return event;
}
