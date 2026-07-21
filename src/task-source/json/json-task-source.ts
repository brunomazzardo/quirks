import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { QuirksError } from "../../core/errors.js";
import { assertRepositoryRelativePath } from "../../core/repository-path.js";
import { loadProjectContext } from "../../project/config.js";
import type { ProjectContext } from "../../project/types.js";
import { validateSchema } from "../../schema/validate.js";
import { writeJsonAtomic } from "../../state/atomic-file.js";
import { EventJournal } from "../../state/event-journal.js";
import { resolveAppPaths } from "../../state/app-paths.js";
import { RepositoryLock } from "../../state/repository-lock.js";
import type { JournalEvent } from "../../state/types.js";
import {
  assertMutationIdentity,
  MAX_PROTOCOL_BYTES,
  mutationRequestHash,
  parseTaskSourceRequest,
  parseTaskSourceResponse,
  type TaskSource,
} from "../task-source.js";
import type {
  MutationRequest,
  TaskSourceCapabilities,
  TaskSourceOperation,
  TaskSourceRequest,
  TaskSourceResponse,
} from "../types.js";
import {
  applyAttachProvenance,
  applyBlock,
  applyClaim,
  applyComplete,
  applyPropose,
  applyRelease,
  applySubmitReview,
  extractCampaignId,
  failure,
  type TaskEnvelope,
} from "./json-mutations.js";
import { listSummary, nativeTaskRevision, normalizeNativeTask, type NativeTask } from "./json-revision.js";

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

const IDEMPOTENCY_EVENT_TYPE = "task-source.idempotency";

async function resolveTasksFile(root: string, relativePath: string): Promise<string> {
  const normalized = assertRepositoryRelativePath(relativePath);
  const candidate = path.join(root, normalized);
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", `Missing task file at ${normalized}`);
  }
  const rootReal = await realpath(root);
  const relative = path.relative(rootReal, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Task file escapes repository: ${normalized}`);
  }
  return resolved;
}

export class JsonTaskSource implements TaskSource {
  private readonly capabilities: TaskSourceCapabilities = {
    schemaVersion: 1,
    protocol: "task-source-v1",
    driver: "json",
    concurrencyStrength: "local-only",
    provenanceWriteMode: "structured",
    commentWriteMode: "none",
    idempotencyLookup: "state",
    operations: SUPPORTED_OPERATIONS,
    authorityClasses: ["repository"],
    completionBoundaries: ["accepted-commit", "campaign-merge", "target-merge", "remote-push"],
    maxRequestBytes: MAX_PROTOCOL_BYTES,
    maxResponseBytes: MAX_PROTOCOL_BYTES,
  };

  private constructor(
    private readonly context: ProjectContext,
    private readonly tasksFilePath: string,
    private readonly lockPath: string,
    private readonly journal: EventJournal,
  ) {}

  static async open(root: string): Promise<JsonTaskSource> {
    const context = await loadProjectContext(root, { mode: "inspection" });
    if (context.config.taskSource.driver !== "json") {
      throw new QuirksError("PROTOCOL_VIOLATION", "Project task source is not configured for JSON");
    }
    const tasksFilePath = await resolveTasksFile(context.root, context.config.taskSource.path);
    const appPaths = resolveAppPaths(context.repositoryId);
    const taskSourceDir = path.join(appPaths.repository, "task-sources");
    return new JsonTaskSource(
      context,
      tasksFilePath,
      path.join(taskSourceDir, "json.lock"),
      new EventJournal(path.join(taskSourceDir, "json-events.jsonl")),
    );
  }

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
        await this.loadEnvelope();
        return { schemaVersion: 1, operation: "validate", ok: true, data: { valid: true } };
      case "list": {
        const envelope = await this.loadEnvelope();
        const tasks = envelope.tasks
          .filter((task) => !request.input.status || task.status === request.input.status)
          .map(listSummary);
        return { schemaVersion: 1, operation: "list", ok: true, data: { tasks } };
      }
      case "show": {
        const envelope = await this.loadEnvelope();
        const task = envelope.tasks.find((entry) => entry.id === request.taskId);
        if (!task) return failure("show", "NOT_FOUND", `Unknown task ${request.taskId}`);
        const data = normalizeNativeTask(task);
        return { schemaVersion: 1, operation: "show", ok: true, nativeRevision: data.nativeRevision, data };
      }
      case "verify": {
        const envelope = await this.loadEnvelope();
        if (request.input.scope === "task") {
          const task = envelope.tasks.find((entry) => entry.id === request.taskId);
          if (!task) return failure("verify", "NOT_FOUND", `Unknown task ${request.taskId}`);
          return {
            schemaVersion: 1,
            operation: "verify",
            ok: true,
            data: { scope: "task", taskId: task.id, commands: [...(task.verification as string[])] },
          };
        }
        const commands = envelope.tasks.flatMap((task) =>
          (task.verification as string[]).map((command) => ({ taskId: task.id, command })),
        );
        return { schemaVersion: 1, operation: "verify", ok: true, data: { scope: "campaign", commands } };
      }
      case "propose":
        return this.applyProposeMutation(request);
      default:
        return this.applyTaskMutation(request);
    }
  }

  private async loadEnvelope(): Promise<TaskEnvelope> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.tasksFilePath, "utf8")) as unknown;
    } catch {
      throw new QuirksError("PROTOCOL_VIOLATION", "Task file is unreadable or invalid JSON");
    }
    return validateSchema<TaskEnvelope>("json-task-file-v1", raw);
  }

  private async lookupIdempotency(
    idempotencyKey: string,
  ): Promise<{ requestHash: string; response: TaskSourceResponse } | undefined> {
    const events = await this.journal.read();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]!;
      if (event.type !== IDEMPOTENCY_EVENT_TYPE) continue;
      if (event.data["idempotencyKey"] !== idempotencyKey) continue;
      const requestHash = event.data["requestHash"];
      const response = event.data["response"];
      if (typeof requestHash !== "string" || response === null || typeof response !== "object") {
        throw new QuirksError("PROTOCOL_VIOLATION", "Malformed idempotency journal entry");
      }
      return { requestHash, response: response as TaskSourceResponse };
    }
    return undefined;
  }

  private async recordIdempotency(
    idempotencyKey: string,
    requestHash: string,
    response: TaskSourceResponse,
  ): Promise<void> {
    const event: JournalEvent = {
      schemaVersion: 1,
      id: idempotencyKey,
      type: IDEMPOTENCY_EVENT_TYPE,
      at: new Date().toISOString(),
      data: { idempotencyKey, requestHash, response },
    };
    await this.journal.append(event);
  }

  private resolveIdempotentResponse(
    request: MutationRequest,
    requestHash: string,
    cached: { requestHash: string; response: TaskSourceResponse } | undefined,
  ): TaskSourceResponse | undefined {
    if (!cached) return undefined;
    if (cached.requestHash !== requestHash) {
      return failure(request.operation, "SOURCE_CONFLICT", "Idempotency key reused with different request");
    }
    return cached.response;
  }

  private async applyProposeMutation(
    request: Extract<MutationRequest, { operation: "propose" }>,
  ): Promise<TaskSourceResponse> {
    const requestHash = mutationRequestHash(request);

    const lock = await RepositoryLock.acquire(this.lockPath, { campaignId: extractCampaignId(request) });
    try {
      const cached = this.resolveIdempotentResponse(request, requestHash, await this.lookupIdempotency(request.idempotencyKey));
      if (cached) return cached;

      const envelope = await this.loadEnvelope();
      const proposed = applyPropose(envelope, request);
      if (!("task" in proposed)) return proposed;
      envelope.tasks.push(proposed.task);
      await writeJsonAtomic(this.tasksFilePath, envelope);
      const data = normalizeNativeTask(proposed.task);
      const response = {
        schemaVersion: 1,
        operation: "propose",
        ok: true,
        nativeRevision: data.nativeRevision,
        data,
      } satisfies TaskSourceResponse;
      await this.recordIdempotency(request.idempotencyKey, requestHash, response);
      return response;
    } finally {
      await lock.release();
    }
  }

  private async applyTaskMutation(request: MutationRequest): Promise<TaskSourceResponse> {
    const requestHash = mutationRequestHash(request);

    const lock = await RepositoryLock.acquire(this.lockPath, { campaignId: extractCampaignId(request) });
    try {
      const cached = this.resolveIdempotentResponse(request, requestHash, await this.lookupIdempotency(request.idempotencyKey));
      if (cached) return cached;

      const envelope = await this.loadEnvelope();
      const taskIndex = envelope.tasks.findIndex((task) => task.id === request.taskId);
      if (taskIndex < 0) return failure(request.operation, "NOT_FOUND", `Unknown task ${request.taskId}`);

      const task = envelope.tasks[taskIndex]!;
      if (nativeTaskRevision(task) !== request.expectedNativeRevision) {
        return failure(request.operation, "STALE_REVISION", "Task revision is stale");
      }

      const updatedTask = structuredClone(task);
      const guard = this.mutateTask(updatedTask, request);
      if (guard) return guard;

      envelope.tasks[taskIndex] = updatedTask;
      const validated = validateSchema<TaskEnvelope>("json-task-file-v1", envelope);
      await writeJsonAtomic(this.tasksFilePath, validated);

      const data = normalizeNativeTask(updatedTask);
      const response = {
        schemaVersion: 1,
        operation: request.operation,
        ok: true,
        nativeRevision: data.nativeRevision,
        data,
      } satisfies TaskSourceResponse;
      await this.recordIdempotency(request.idempotencyKey, requestHash, response);
      return response;
    } finally {
      await lock.release();
    }
  }

  private mutateTask(
    task: NativeTask,
    request: MutationRequest,
  ): Extract<TaskSourceResponse, { ok: false }> | undefined {
    switch (request.operation) {
      case "claim": {
        const result = applyClaim(task, request);
        return result ?? undefined;
      }
      case "release": {
        const result = applyRelease(task, request);
        return result ?? undefined;
      }
      case "block":
        applyBlock(task, request);
        return undefined;
      case "submit-review":
        applySubmitReview(task);
        return undefined;
      case "complete": {
        const result = applyComplete(task, request, this.context.effectiveWorkflowPolicy.evidenceMap);
        return result ?? undefined;
      }
      case "attach-provenance": {
        const result = applyAttachProvenance(task, request);
        return result ?? undefined;
      }
    }
  }
}
