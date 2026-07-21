import { QuirksError } from "../../core/errors.js";
import { validateSchema } from "../../schema/validate.js";
import type { CompletionBoundary, EvidenceKind } from "../../project/types.js";
import type { MutationRequest, TaskSourceOperation, TaskSourceResponse } from "../types.js";
import type { NativeTask } from "./json-revision.js";

export type TaskEnvelope = {
  schemaVersion: 1;
  tasks: NativeTask[];
};

type MutationFailure<O extends TaskSourceOperation> = Extract<TaskSourceResponse, { operation: O; ok: false }>;

export function failure<O extends TaskSourceOperation>(
  operation: O,
  code: string,
  message: string,
  retryable = false,
): MutationFailure<O> {
  return {
    schemaVersion: 1,
    operation,
    ok: false,
    error: { code, message, retryable },
  } as MutationFailure<O>;
}

export function extractCampaignId(request: MutationRequest): string {
  if ("campaignId" in request.input && typeof request.input.campaignId === "string") {
    return request.input.campaignId;
  }
  const [campaignId] = request.idempotencyKey.split(":");
  if (!campaignId) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Mutation idempotency key must include campaign identity");
  }
  return campaignId;
}

export function applyClaim(task: NativeTask, request: Extract<MutationRequest, { operation: "claim" }>): MutationFailure<"claim"> | void {
  if (task.status !== "ready") {
    return failure("claim", "SOURCE_CONFLICT", "Task is not ready to claim");
  }
  task.status = "claimed";
  task.coordination = {
    scope: "local-clone",
    campaignId: request.input.campaignId,
    owner: request.input.owner,
    claimedAt: request.input.claimedAt,
  };
}

export function applyRelease(task: NativeTask, request: Extract<MutationRequest, { operation: "release" }>): MutationFailure<"release"> | void {
  if (task.coordination !== null && task.coordination !== undefined) {
    const coordination = task.coordination as { campaignId: string };
    if (coordination.campaignId !== request.input.campaignId) {
      return failure("release", "SOURCE_CONFLICT", "Task is not claimed by this campaign");
    }
  }
  task.coordination = null;
  if (task.status === "claimed") {
    task.status = "ready";
  }
}

export function applyBlock(task: NativeTask, request: Extract<MutationRequest, { operation: "block" }>): void {
  task.status = "blocked";
  task.statusDetail = {
    reason: request.input.reason,
    unblockCondition: request.input.unblockCondition,
  };
}

export function applySubmitReview(task: NativeTask): void {
  task.status = "in_review";
}

export function applyComplete(
  task: NativeTask,
  request: Extract<MutationRequest, { operation: "complete" }>,
  evidenceMap: Readonly<Partial<Record<CompletionBoundary, readonly EvidenceKind[]>>>,
): MutationFailure<"complete"> | void {
  const boundary = (task.execution as { completionBoundary: CompletionBoundary }).completionBoundary;
  const requiredKinds = evidenceMap[boundary] ?? [];
  if (requiredKinds.length > 0 && request.input.evidenceRefs.length === 0) {
    return failure("complete", "SOURCE_CONFLICT", `Completion requires evidence for boundary ${boundary}`);
  }
  task.status = "completed";
  task.coordination = null;
}

export function applyAttachProvenance(
  task: NativeTask,
  request: Extract<MutationRequest, { operation: "attach-provenance" }>,
): MutationFailure<"attach-provenance"> | void {
  const validated = validateSchema<{ schemaVersion: 1; iterations: Array<Record<string, unknown>> }>(
    "task-provenance-v1",
    {
      schemaVersion: 1,
      iterations: [request.input.iteration],
    },
  );
  const iteration = validated.iterations[0]!;
  const provenance = task.provenance as { schemaVersion: 1; iterations: Array<Record<string, unknown>> };
  const existing = provenance.iterations.find((entry) => entry.id === iteration.id);
  if (!existing) {
    provenance.iterations.push(iteration);
  }
}

export function applyPropose(
  envelope: TaskEnvelope,
  request: Extract<MutationRequest, { operation: "propose" }>,
): { task: NativeTask } | MutationFailure<"propose"> {
  const candidate = request.input.task;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return failure("propose", "SCHEMA_INVALID", "Proposed task must be an object");
  }
  const proposed = { ...(candidate as Record<string, unknown>) };
  if (typeof proposed.id !== "string" || proposed.id !== request.taskId) {
    return failure("propose", "SOURCE_CONFLICT", "Proposed task id must match request taskId");
  }
  if (envelope.tasks.some((task) => task.id === proposed.id)) {
    return failure("propose", "SOURCE_CONFLICT", `Task ${proposed.id} already exists`);
  }
  const validated = validateSchema<TaskEnvelope>("json-task-file-v1", {
    schemaVersion: 1,
    tasks: [...envelope.tasks, proposed],
  });
  return { task: validated.tasks[validated.tasks.length - 1]! };
}
