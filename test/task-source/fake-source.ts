import { sha256 } from "../../src/core/hash.js";
import { validateSchema } from "../../src/schema/validate.js";
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
  "validate",
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
  readonly showCalls: string[] = [];

  upsertTask(taskId: string, overrides: Partial<Omit<StoredTask, "id">> = {}): void {
    this.tasks.set(taskId, { ...baseTask(), id: taskId, ...overrides });
  }

  taskRevision(taskId: string): string {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    return taskRevision(task);
  }

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
        this.showCalls.push(request.taskId);
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
        return this.applyMutation(request, (task) => {
          const provenance = task.provenance as { schemaVersion: 1; iterations: Array<Record<string, unknown>> };
          provenance.iterations.push(request.input.iteration as Record<string, unknown>);
        });
      case "propose":
        return this.applyPropose(request);
    }
  }

  private applyPropose(request: Extract<MutationRequest, { operation: "propose" }>): TaskSourceResponse {
    const requestHash = mutationRequestHash(request);
    const cached = this.idempotency.get(request.idempotencyKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return failure("propose", "SOURCE_CONFLICT", "Idempotency key reused with different request");
      }
      return cached.response;
    }

    const candidate = request.input.task;
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return failure("propose", "SCHEMA_INVALID", "Proposed task must be an object");
    }
    const proposed = candidate as Partial<StoredTask> & { id?: unknown; status?: unknown };
    if (typeof proposed.id !== "string" || proposed.id !== request.taskId) {
      return failure("propose", "SOURCE_CONFLICT", "Proposed task id must match request taskId");
    }
    if (proposed.status !== "proposed" && proposed.status !== "ready") {
      return failure("propose", "SOURCE_CONFLICT", "Proposed task must start proposed or ready");
    }
    if (this.tasks.has(proposed.id)) {
      return failure("propose", "SOURCE_CONFLICT", `Task ${proposed.id} already exists`);
    }

    // Match the real JSON adapter's applyPropose: the whole envelope including
    // the raw candidate must satisfy json-task-file-v1 before it is stored.
    try {
      validateSchema("json-task-file-v1", {
        schemaVersion: 1,
        tasks: [...this.tasks.values(), proposed],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proposed task violates json-task-file-v1";
      return failure("propose", "SCHEMA_INVALID", message);
    }

    const stored: StoredTask = { ...baseTask(), ...(proposed as Partial<StoredTask>), id: proposed.id };
    this.tasks.set(stored.id, stored);
    const data = normalizedTask(stored);
    const response = {
      schemaVersion: 1,
      operation: "propose",
      ok: true,
      nativeRevision: data.nativeRevision,
      data,
    } satisfies TaskSourceResponse;
    this.idempotency.set(request.idempotencyKey, { requestHash, response });
    return response;
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
