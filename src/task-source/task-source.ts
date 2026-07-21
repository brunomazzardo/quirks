import { QuirksError } from "../core/errors.js";
import { canonicalJson } from "../core/canonical-json.js";
import { validateSchema } from "../schema/validate.js";
import type { MutationRequest, TaskSourceOperation, TaskSourceRequest, TaskSourceResponse } from "./types.js";

export interface TaskSource {
  execute(request: TaskSourceRequest): Promise<TaskSourceResponse>;
}

export const MAX_PROTOCOL_BYTES = 1_048_576;

const SECRET_PATTERNS: readonly RegExp[] = [
  /https:\/\/[^/?#]*@[^/?#]/,
  /https:\/\/[^/:]+:[^/@]+@/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export function assertMutationIdentity(request: TaskSourceRequest): void {
  if (!("idempotencyKey" in request)) return;
  if (!request.taskId || !request.expectedNativeRevision || !request.idempotencyKey) {
    throw new TypeError(`Mutation ${request.operation} has an empty identity field`);
  }
}

export function measureProtocolBytes(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

export function assertProtocolSize(value: unknown, label: "request" | "response"): void {
  const bytes = measureProtocolBytes(value);
  if (bytes > MAX_PROTOCOL_BYTES) {
    throw new QuirksError("PROTOCOL_VIOLATION", `${label} exceeds ${MAX_PROTOCOL_BYTES} bytes`);
  }
}

export function rejectSecretShapedValues(value: unknown, path = "$"): void {
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        throw new QuirksError("SECRET_REJECTED", `Secret-shaped value at ${path}`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretShapedValues(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      rejectSecretShapedValues(nested, `${path}.${key}`);
    }
  }
}

export function parseTaskSourceRequest(value: unknown): TaskSourceRequest {
  assertProtocolSize(value, "request");
  return validateSchema<TaskSourceRequest>("task-source-request-v1", value);
}

export function parseTaskSourceResponse(value: unknown, operation: TaskSourceOperation): TaskSourceResponse {
  assertProtocolSize(value, "response");
  const response = validateSchema<TaskSourceResponse>("task-source-response-v1", value);
  if (response.operation !== operation) {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      `Response operation ${response.operation} does not match ${operation}`,
    );
  }
  rejectSecretShapedValues(response);
  return response;
}

export function mutationRequestHash(request: MutationRequest): string {
  return canonicalJson({
    operation: request.operation,
    taskId: request.taskId,
    expectedNativeRevision: request.expectedNativeRevision,
    idempotencyKey: request.idempotencyKey,
    input: request.input,
  });
}
