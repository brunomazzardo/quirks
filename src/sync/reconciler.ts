import { sha256 } from "../core/hash.js";
import { QuirksError } from "../core/errors.js";
import type { TaskSource } from "../task-source/task-source.js";
import type {
  MutationRequest,
  TaskSourceCapabilities,
  TaskSourceRequest,
  TaskSourceResponse,
} from "../task-source/types.js";
import type { OutboxPort, SyncIntent } from "./types.js";

export interface ReconcileMutationInput {
  campaignId: string;
  outbox: OutboxPort;
  source: TaskSource;
  request: MutationRequest;
}

export interface ReconcilePendingInput {
  campaignId: string;
  outbox: OutboxPort & { listPending(): Promise<SyncIntent[]> };
  source: TaskSource;
}

function requestHash(request: MutationRequest): string {
  return sha256({
    operation: request.operation,
    taskId: request.taskId,
    expectedNativeRevision: request.expectedNativeRevision,
    idempotencyKey: request.idempotencyKey,
    input: request.input,
  });
}

function buildIntent(campaignId: string, request: MutationRequest): SyncIntent {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    intentId: request.idempotencyKey,
    campaignId,
    taskId: request.taskId,
    operation: request.operation,
    requestHash: requestHash(request),
    request,
    state: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

function isConflictResponse(response: TaskSourceResponse): boolean {
  return !response.ok && (response.error.code === "STALE_REVISION" || response.error.code === "SOURCE_CONFLICT");
}

function isTransportFailure(error: unknown): boolean {
  if (error instanceof QuirksError) {
    return error.code === "SOURCE_UNAVAILABLE";
  }
  if (error !== null && typeof error === "object" && "code" in error) {
    return (error as { code?: string }).code === "SOURCE_UNAVAILABLE";
  }
  return false;
}

function showEvidence(request: MutationRequest, response: TaskSourceResponse): boolean {
  if (!response.ok || response.operation !== "show") return false;
  const data = response.data as Record<string, unknown>;

  switch (request.operation) {
    case "claim": {
      const coordination = data["coordination"] as Record<string, unknown> | undefined;
      return data["status"] === "claimed" && coordination?.["campaignId"] === request.input.campaignId;
    }
    case "complete":
      return data["status"] === "completed";
    case "release":
      return data["status"] === "ready" || data["status"] === "released";
    case "block":
      return data["status"] === "blocked";
    case "submit-review":
      return data["status"] === "in-review" || data["status"] === "review-submitted";
    default:
      return false;
  }
}

async function readCapabilities(source: TaskSource): Promise<TaskSourceCapabilities> {
  const response = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
  if (!response.ok || response.operation !== "capabilities") {
    throw new QuirksError("SOURCE_UNAVAILABLE", "Task source capabilities are unavailable");
  }
  return response.data as TaskSourceCapabilities;
}

async function readShow(source: TaskSource, taskId: string): Promise<TaskSourceResponse> {
  return source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
}

async function resolveAmbiguousIntent(
  source: TaskSource,
  request: MutationRequest,
  capabilities: TaskSourceCapabilities,
): Promise<TaskSourceResponse | undefined> {
  const show = await readShow(source, request.taskId);
  if (showEvidence(request, show)) return show;

  if (capabilities.idempotencyLookup === "none") return undefined;

  // State-based lookup uses the canonical show snapshot as the only safe evidence.
  if (capabilities.idempotencyLookup === "state" || capabilities.idempotencyLookup === "key") {
    return showEvidence(request, show) ? show : undefined;
  }

  return undefined;
}

export async function reconcileMutation(input: ReconcileMutationInput): Promise<SyncIntent> {
  const intent = buildIntent(input.campaignId, input.request);
  await input.outbox.enqueue(intent);

  let response: TaskSourceResponse;
  try {
    response = await input.source.execute(input.request as TaskSourceRequest);
  } catch (error) {
    if (!isTransportFailure(error)) throw error;

    const capabilities = await readCapabilities(input.source);
    const evidence = await resolveAmbiguousIntent(input.source, input.request, capabilities);
    if (evidence) {
      await input.outbox.transition(intent.intentId, "acknowledged", evidence);
      return { ...intent, state: "acknowledged", updatedAt: new Date().toISOString(), acknowledgement: evidence };
    }
    return intent;
  }

  if (isConflictResponse(response)) {
    await input.outbox.transition(intent.intentId, "conflict");
    return { ...intent, state: "conflict", updatedAt: new Date().toISOString() };
  }

  if (!response.ok) {
    await input.outbox.transition(intent.intentId, "failed");
    return { ...intent, state: "failed", updatedAt: new Date().toISOString() };
  }

  await input.outbox.transition(intent.intentId, "acknowledged", response);
  return {
    ...intent,
    state: "acknowledged",
    updatedAt: new Date().toISOString(),
    acknowledgement: response,
  };
}

export async function reconcilePending(input: ReconcilePendingInput): Promise<SyncIntent[]> {
  const capabilities = await readCapabilities(input.source);
  if (capabilities.idempotencyLookup === "none") return [];

  const resolved: SyncIntent[] = [];
  for (const intent of await input.outbox.listPending()) {
    const evidence = await resolveAmbiguousIntent(input.source, intent.request, capabilities);
    if (!evidence) continue;
    await input.outbox.transition(intent.intentId, "acknowledged", evidence);
    resolved.push({
      ...intent,
      state: "acknowledged",
      updatedAt: new Date().toISOString(),
      acknowledgement: evidence,
    });
  }
  return resolved;
}
