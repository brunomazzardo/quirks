import { sha256 } from "../core/hash.js";
import { QuirksError } from "../core/errors.js";
import type { TaskSource } from "../task-source/task-source.js";
import type {
  MutationRequest,
  TaskSourceCapabilities,
  TaskSourceRequest,
  TaskSourceResponse,
} from "../task-source/types.js";
import type { OutboxPort, SyncIntent, SyncState } from "./types.js";

export interface ReconcileMutationInput {
  campaignId: string;
  outbox: OutboxPort;
  source: TaskSource;
  request: MutationRequest;
}

export interface ReconcilePendingInput {
  campaignId: string;
  outbox: OutboxPort & { listPending(campaignId?: string): Promise<SyncIntent[]> };
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

function isTerminalState(state: SyncState): boolean {
  return state === "acknowledged" || state === "conflict" || state === "failed";
}

function canSafeIdempotentRetry(capabilities: TaskSourceCapabilities): boolean {
  return capabilities.idempotencyLookup === "key";
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

function keyLookupEvidence(request: MutationRequest, response: TaskSourceResponse): boolean {
  if (!response.ok || response.operation !== "show") return false;
  const data = response.data as Record<string, unknown>;
  const sync = data["sync"] as { appliedIdempotencyKeys?: readonly string[] } | undefined;
  const appliedKeys = sync?.appliedIdempotencyKeys ?? (data["appliedIdempotencyKeys"] as readonly string[] | undefined);
  return appliedKeys?.includes(request.idempotencyKey) === true;
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

  // Key lookup uses show state evidence first, then optional idempotency-key markers on show.
  // The TaskSource protocol has no dedicated idempotency probe; adapters with
  // idempotencyLookup "key" may also expose applied keys on show for positive proof.
  if (capabilities.idempotencyLookup === "key" && keyLookupEvidence(request, show)) return show;

  return undefined;
}

async function acknowledgeIntent(
  outbox: OutboxPort,
  intent: SyncIntent,
  evidence: TaskSourceResponse,
): Promise<SyncIntent> {
  await outbox.transition(intent.intentId, "acknowledged", evidence);
  return {
    ...intent,
    state: "acknowledged",
    updatedAt: new Date().toISOString(),
    acknowledgement: evidence,
  };
}

async function executeMutation(
  outbox: OutboxPort,
  intent: SyncIntent,
  source: TaskSource,
  request: MutationRequest,
): Promise<SyncIntent> {
  let response: TaskSourceResponse;
  try {
    response = await source.execute(request as TaskSourceRequest);
  } catch (error) {
    if (!isTransportFailure(error)) throw error;

    const capabilities = await readCapabilities(source);
    const evidence = await resolveAmbiguousIntent(source, request, capabilities);
    if (evidence) {
      return acknowledgeIntent(outbox, intent, evidence);
    }
    return intent;
  }

  if (isConflictResponse(response)) {
    await outbox.transition(intent.intentId, "conflict");
    return { ...intent, state: "conflict", updatedAt: new Date().toISOString() };
  }

  if (!response.ok) {
    await outbox.transition(intent.intentId, "failed");
    return { ...intent, state: "failed", updatedAt: new Date().toISOString() };
  }

  return acknowledgeIntent(outbox, intent, response);
}

export async function reconcileMutation(input: ReconcileMutationInput): Promise<SyncIntent> {
  const intent = buildIntent(input.campaignId, input.request);
  const prior = await input.outbox.get(intent.intentId);
  await input.outbox.enqueue(intent);
  const current = (await input.outbox.get(intent.intentId)) ?? intent;

  if (prior) {
    if (isTerminalState(current.state)) {
      return current;
    }

    if (current.state === "pending") {
      const capabilities = await readCapabilities(input.source);
      const evidence = await resolveAmbiguousIntent(input.source, input.request, capabilities);
      if (evidence) {
        return acknowledgeIntent(input.outbox, current, evidence);
      }
      if (!canSafeIdempotentRetry(capabilities)) {
        return current;
      }
    }
  }

  return executeMutation(input.outbox, current, input.source, input.request);
}

export async function reconcilePending(input: ReconcilePendingInput): Promise<SyncIntent[]> {
  const capabilities = await readCapabilities(input.source);
  if (capabilities.idempotencyLookup === "none") return [];

  const resolved: SyncIntent[] = [];
  for (const intent of await input.outbox.listPending(input.campaignId)) {
    const evidence = await resolveAmbiguousIntent(input.source, intent.request, capabilities);
    if (!evidence) continue;
    resolved.push(await acknowledgeIntent(input.outbox, intent, evidence));
  }
  return resolved;
}
