import { QuirksError } from "../../core/errors.js";
import { sha256 } from "../../core/hash.js";
import { validateSchema } from "../../schema/validate.js";
import type { CompletionBoundary, EvidenceKind } from "../../project/types.js";
import type {
  GoalMutationRequest,
  MutationRequest,
  NativeGoal,
  TaskSourceOperation,
  TaskSourceResponse,
} from "../types.js";
import type { NativeTask } from "./json-revision.js";

export type TaskEnvelope = {
  schemaVersion: 1;
  tasks: NativeTask[];
  /** Absent in files written before goals existed; treated as empty. */
  goals?: NativeGoal[];
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

export function extractCampaignId(request: MutationRequest | GoalMutationRequest): string {
  if ("campaignId" in request.input && typeof request.input.campaignId === "string") {
    return request.input.campaignId;
  }
  const [campaignId] = request.idempotencyKey.split(":");
  if (!campaignId) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Mutation idempotency key must include campaign identity");
  }
  return campaignId;
}

function dependenciesSatisfied(task: NativeTask, tasks: readonly NativeTask[]): boolean {
  const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn as string[] : [];
  return dependsOn.every((dependencyId) => {
    const dependency = tasks.find((entry) => entry.id === dependencyId);
    return dependency?.status === "completed";
  });
}

export function applyClaim(
  task: NativeTask,
  request: Extract<MutationRequest, { operation: "claim" }>,
  tasks: readonly NativeTask[] = [],
): MutationFailure<"claim"> | void {
  if (task.status === "proposed") {
    if (!dependenciesSatisfied(task, tasks)) {
      return failure("claim", "SOURCE_CONFLICT", "Task dependencies are not satisfied");
    }
    task.status = "ready";
  }
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

export function applyBlock(task: NativeTask, request: Extract<MutationRequest, { operation: "block" }>): MutationFailure<"block"> | void {
  if (task.status === "completed" || task.status === "cancelled") {
    return failure("block", "SOURCE_CONFLICT", "Terminal task cannot be blocked");
  }
  task.status = "blocked";
  task.statusDetail = {
    reason: request.input.reason,
    unblockCondition: request.input.unblockCondition,
  };
}

export function applySubmitReview(task: NativeTask): MutationFailure<"submit-review"> | void {
  if (task.status !== "claimed") {
    return failure("submit-review", "SOURCE_CONFLICT", "Task must be claimed before review");
  }
  task.status = "in_review";
}

export function applyComplete(
  task: NativeTask,
  request: Extract<MutationRequest, { operation: "complete" }>,
  evidenceMap: Readonly<Partial<Record<CompletionBoundary, readonly EvidenceKind[]>>>,
): MutationFailure<"complete"> | void {
  if (task.status !== "in_review") {
    return failure("complete", "SOURCE_CONFLICT", "Task must be in review before completion");
  }
  const boundary = (task.execution as { completionBoundary: CompletionBoundary }).completionBoundary;
  const requiredKinds = evidenceMap[boundary] ?? [];
  const iterations = (task.provenance as { iterations?: Array<Record<string, unknown>> }).iterations ?? [];
  const boundaryRank: Record<CompletionBoundary, number> = {
    "accepted-commit": 0,
    "campaign-merge": 1,
    "target-merge": 2,
    "remote-push": 3,
  };
  const matching = iterations.filter(
    (iteration) =>
      iteration.outcome === "completed" &&
      typeof iteration.completionBoundary === "string" &&
      boundaryRank[iteration.completionBoundary as CompletionBoundary] >= boundaryRank[boundary],
  );
  if (matching.length === 0) {
    return failure("complete", "SOURCE_CONFLICT", `Completion requires completed provenance for boundary ${boundary}`);
  }
  const evidenceMatches = (kind: EvidenceKind, value: string): boolean => matching.some((iteration) => {
    const commits = [iteration.acceptedCommit, iteration.landedCommit, ...(Array.isArray(iteration.commitRefs) ? iteration.commitRefs : [])];
    if (kind === "commit") return commits.includes(value);
    if (kind === "review") {
      return Array.isArray(iteration.artifactRefs) && iteration.artifactRefs.some(
        (artifact) => artifact !== null && typeof artifact === "object" &&
          (artifact as Record<string, unknown>).kind === "review" &&
          ((artifact as Record<string, unknown>).path === value || (artifact as Record<string, unknown>).url === value),
      );
    }
    if (kind === "verification" || kind === "ci" || kind === "deployment") {
      return Array.isArray(iteration.verificationRefs) && iteration.verificationRefs.some(
        (verification) => verification !== null && typeof verification === "object" &&
          (verification as Record<string, unknown>).kind === kind &&
          (verification as Record<string, unknown>).reference === value &&
          (verification as Record<string, unknown>).outcome === "passed",
      );
    }
    if (kind === "campaign-merge" || kind === "target-merge" || kind === "remote-push") {
      return commits.includes(value) && boundaryRank[iteration.completionBoundary as CompletionBoundary] >= boundaryRank[kind];
    }
    return false;
  });
  const evidence = request.input.evidenceRefs.flatMap((reference) => {
    const separator = reference.indexOf(":");
    return separator > 0 && reference.slice(separator + 1).length > 0
      ? [{ kind: reference.slice(0, separator) as EvidenceKind, value: reference.slice(separator + 1) }]
      : [];
  });
  if (requiredKinds.some((kind) => !evidence.some((entry) => entry.kind === kind && evidenceMatches(kind, entry.value)))) {
    return failure("complete", "SOURCE_CONFLICT", `Completion requires provenance-backed ${boundary} evidence`);
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
  if (existing) {
    if (sha256(existing) !== sha256(iteration)) {
      return failure(
        "attach-provenance",
        "SOURCE_CONFLICT",
        `Provenance iteration ${iteration.id} already exists with different content`,
      );
    }
    return;
  }
  provenance.iterations.push(iteration);

  if (iteration.outcome === "blocked" && task.status === "completed") {
    task.status = "blocked";
    task.statusDetail = {
      reason: typeof iteration.outcomeReason === "string"
        ? iteration.outcomeReason
        : "Corrective reconciliation superseded false completion",
      unblockCondition: "Independent review confirms replacement evidence or task cancellation",
    };
    task.coordination = null;
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
  if (proposed.status !== "proposed" && proposed.status !== "ready") {
    return failure("propose", "SOURCE_CONFLICT", "Proposed task must start proposed or ready");
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
