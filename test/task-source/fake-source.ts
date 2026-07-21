import { sha256 } from "../../src/core/hash.js";
import {
  assertMutationIdentity,
  MAX_PROTOCOL_BYTES,
  mutationRequestHash,
  parseTaskSourceRequest,
  parseTaskSourceResponse,
  type TaskSource,
} from "../../src/task-source/task-source.js";
import type {
  MutationRequest,
  TaskSourceCapabilities,
  TaskSourceOperation,
  TaskSourceRequest,
  TaskSourceResponse,
} from "../../src/task-source/types.js";

type StoredTask = {
  id: string;
  title: string;
  kind: string;
  priority: string;
  status: string;
  dependsOn: readonly string[];
  workflow: unknown;
  execution: unknown;
  sourceRefs: readonly unknown[];
  deliverables: readonly string[];
  acceptanceCriteria: readonly string[];
  verification: readonly string[];
  provenance: unknown;
  coordination: null | { scope: "local-clone"; campaignId: string; owner: string; claimedAt: string };
  statusDetail: null | { reason: string; unblockCondition: string };
};

const SUPPORTED_OPERATIONS: readonly TaskSourceOperation[] = [
  "capabilities",
  "list",
  "show",
  "claim",
  "submit-review",
  "attach-provenance",
  "complete",
  "block",
  "release",
  "propose",
  "verify",
];

function baseTask(): StoredTask {
  return {
    id: "QK-1",
    title: "Contract task",
    kind: "implementation",
    priority: "P1",
    status: "ready",
    dependsOn: [],
    workflow: { family: "superpowers", phase: "execute", designGate: { required: false } },
    execution: {
      effort: "standard",
      risk: [],
      capabilities: ["repository-write"],
      parallelismKeys: [],
      humanGates: [],
      completionBoundary: "accepted-commit",
    },
    sourceRefs: [],
    deliverables: [],
    acceptanceCriteria: ["Contract passes"],
    verification: ["pnpm test"],
    provenance: { schemaVersion: 1, iterations: [] },
    coordination: null,
    statusDetail: null,
  };
}

function taskRevision(task: StoredTask): string {
  return sha256(task);
}

function normalizedTask(task: StoredTask) {
  return {
    schemaVersion: 1 as const,
    ...task,
    source: { driver: "fake", nativeId: task.id, webUrl: null },
    nativeRevision: taskRevision(task),
  };
}

function listSummary(task: StoredTask) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    nativeRevision: taskRevision(task),
  };
}

function failure<O extends TaskSourceOperation>(
  operation: O,
  code: string,
  message: string,
  retryable = false,
): Extract<TaskSourceResponse, { operation: O; ok: false }> {
  return {
    schemaVersion: 1,
    operation,
    ok: false,
    error: { code, message, retryable },
  } as Extract<TaskSourceResponse, { operation: O; ok: false }>;
}

export class FakeTaskSource implements TaskSource {
  private readonly tasks = new Map<string, StoredTask>([["QK-1", baseTask()]]);
  private readonly idempotency = new Map<string, { requestHash: string; response: TaskSourceResponse }>();

  readonly capabilities: TaskSourceCapabilities = {
    schemaVersion: 1,
    protocol: "task-source-v1",
    driver: "fake",
    concurrencyStrength: "local-only",
    provenanceWriteMode: "structured",
    commentWriteMode: "none",
    idempotencyLookup: "key",
    operations: SUPPORTED_OPERATIONS,
    authorityClasses: ["repository"],
    completionBoundaries: ["accepted-commit"],
    maxRequestBytes: MAX_PROTOCOL_BYTES,
    maxResponseBytes: MAX_PROTOCOL_BYTES,
  };

  async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
    const parsed = parseTaskSourceRequest(request);
    assertMutationIdentity(parsed);

    if (!this.capabilities.operations.includes(parsed.operation)) {
      return failure(parsed.operation, "PROTOCOL_VIOLATION", `Unsupported operation ${parsed.operation}`);
    }

    const response = await this.dispatch(parsed);
    return parseTaskSourceResponse(response, parsed.operation);
  }

  private async dispatch(request: TaskSourceRequest): Promise<TaskSourceResponse> {
    switch (request.operation) {
      case "capabilities":
        return { schemaVersion: 1, operation: "capabilities", ok: true, data: this.capabilities };
      case "validate":
        return { schemaVersion: 1, operation: "validate", ok: true, data: { valid: true } };
      case "list": {
        const tasks = [...this.tasks.values()]
          .filter((task) => !request.input.status || task.status === request.input.status)
          .map(listSummary);
        return { schemaVersion: 1, operation: "list", ok: true, data: { tasks } };
      }
      case "show": {
        const task = this.tasks.get(request.taskId);
        if (!task) return failure("show", "NOT_FOUND", `Unknown task ${request.taskId}`);
        const data = normalizedTask(task);
        return { schemaVersion: 1, operation: "show", ok: true, nativeRevision: data.nativeRevision, data };
      }
      case "verify":
        return { schemaVersion: 1, operation: "verify", ok: true, data: { scope: request.input.scope, valid: true } };
      case "claim":
        return this.applyMutation(
          request,
          (task) => {
            task.status = "claimed";
            task.coordination = {
              scope: "local-clone",
              campaignId: request.input.campaignId,
              owner: request.input.owner,
              claimedAt: request.input.claimedAt,
            };
          },
          (task) =>
            task.status !== "ready"
              ? failure("claim", "SOURCE_CONFLICT", "Task is not ready to claim")
              : undefined,
        );
      case "release":
        return this.applyMutation(request, (task) => {
          task.status = "ready";
          task.coordination = null;
        });
      case "block":
        return this.applyMutation(request, (task) => {
          task.status = "blocked";
          task.statusDetail = {
            reason: request.input.reason,
            unblockCondition: request.input.unblockCondition,
          };
        });
      case "submit-review":
        return this.applyMutation(request, (task) => {
          task.status = "in_review";
        });
      case "complete":
        return this.applyMutation(request, (task) => {
          task.status = "completed";
          task.coordination = null;
        });
      case "attach-provenance":
        return this.applyMutation(request, () => undefined);
      case "propose":
        return this.applyMutation(request, () => undefined);
    }
  }

  private applyMutation(
    request: MutationRequest,
    mutate: (task: StoredTask) => void,
    guard?: (task: StoredTask) => Extract<TaskSourceResponse, { ok: false }> | undefined,
  ): TaskSourceResponse {
    const requestHash = mutationRequestHash(request);
    const cached = this.idempotency.get(request.idempotencyKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return failure(request.operation, "SOURCE_CONFLICT", "Idempotency key reused with different request");
      }
      return cached.response;
    }

    const task = this.tasks.get(request.taskId);
    if (!task) return failure(request.operation, "NOT_FOUND", `Unknown task ${request.taskId}`);
    if (taskRevision(task) !== request.expectedNativeRevision) {
      return failure(request.operation, "STALE_REVISION", "Task revision is stale");
    }

    const guardFailure = guard?.(task);
    if (guardFailure) return guardFailure;

    mutate(task);
    const data = normalizedTask(task);
    const response = {
      schemaVersion: 1,
      operation: request.operation,
      ok: true,
      nativeRevision: data.nativeRevision,
      data,
    } satisfies TaskSourceResponse;
    this.idempotency.set(request.idempotencyKey, { requestHash, response });
    return response;
  }
}
