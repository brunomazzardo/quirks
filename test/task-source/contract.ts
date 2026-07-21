import assert from "node:assert/strict";
import { QuirksError } from "../../src/core/errors.js";
import {
  assertProtocolSize,
  MAX_PROTOCOL_BYTES,
  measureProtocolBytes,
  parseTaskSourceRequest,
  parseTaskSourceResponse,
  rejectSecretShapedValues,
  type TaskSource,
} from "../../src/task-source/task-source.js";
import type { TaskSourceOperation, TaskSourceRequest, TaskSourceResponse } from "../../src/task-source/types.js";

const ALL_OPERATIONS: readonly TaskSourceOperation[] = [
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

function assertFailure(response: TaskSourceResponse): asserts response is Extract<TaskSourceResponse, { ok: false }> {
  assert.equal(response.ok, false);
}

async function assertProtocolGuards(): Promise<void> {
  assert.throws(
    () => parseTaskSourceRequest({
      schemaVersion: 1,
      operation: "capabilities",
      input: {},
      surprise: true,
    }),
    (error: QuirksError) => error.code === "SCHEMA_INVALID",
  );

  const oversized = {
    schemaVersion: 1,
    operation: "capabilities",
    input: {},
    padding: "x".repeat(MAX_PROTOCOL_BYTES),
  };
  assert.throws(
    () => parseTaskSourceRequest(oversized),
    (error: QuirksError) => error.code === "PROTOCOL_VIOLATION",
  );

  const oversizedResponse = {
    schemaVersion: 1,
    operation: "capabilities",
    ok: true,
    data: { blob: "y".repeat(MAX_PROTOCOL_BYTES) },
  };
  assert.throws(
    () => parseTaskSourceResponse(oversizedResponse, "capabilities"),
    (error: QuirksError) => error.code === "PROTOCOL_VIOLATION",
  );

  assert.throws(
    () => rejectSecretShapedValues({ token: "Bearer abc.def.ghi" }),
    (error: QuirksError) => error.code === "SECRET_REJECTED",
  );

  assert.throws(
    () => rejectSecretShapedValues({ url: "https://user:pass@evil.example/x" }),
    (error: QuirksError) => error.code === "SECRET_REJECTED",
  );

  assert.doesNotThrow(() => assertProtocolSize({ schemaVersion: 1, operation: "list", input: {} }, "request"));
  assert.ok(measureProtocolBytes({ schemaVersion: 1, operation: "list", input: {} }) < MAX_PROTOCOL_BYTES);
}

export async function assertTaskSourceContract(
  create: () => TaskSource | Promise<TaskSource>,
): Promise<void> {
  await assertProtocolGuards();

  const source = await create();

  const capabilitiesResponse = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
  assert.equal(capabilitiesResponse.operation, "capabilities");
  assert.equal(capabilitiesResponse.ok, true);
  const capabilities = capabilitiesResponse.data as {
    operations: readonly TaskSourceOperation[];
    maxRequestBytes: number;
    maxResponseBytes: number;
  };
  assert.ok(capabilities.operations.length > 0);
  assert.equal(capabilities.maxRequestBytes, MAX_PROTOCOL_BYTES);
  assert.equal(capabilities.maxResponseBytes, MAX_PROTOCOL_BYTES);

  const listResponse = await source.execute({ schemaVersion: 1, operation: "list", input: {} });
  assert.equal(listResponse.ok, true);
  if (!listResponse.ok) return;
  const tasks = (listResponse.data as { tasks: Array<{ id: string; nativeRevision: string; status: string }> }).tasks;
  assert.ok(tasks.length > 0, "expected at least one task");

  const taskId = tasks[0]!.id;
  const showResponse = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  assert.equal(showResponse.ok, true);
  if (!showResponse.ok) return;
  const listed = tasks.find((task) => task.id === taskId);
  assert.ok(listed);
  assert.equal((showResponse.data as { id: string }).id, listed.id);
  assert.equal((showResponse.data as { status: string }).status, listed.status);
  assert.equal(showResponse.nativeRevision, listed.nativeRevision);

  const stableRevision = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  assert.equal(stableRevision.ok, true);
  if (!stableRevision.ok) return;
  assert.equal(stableRevision.nativeRevision, showResponse.nativeRevision);

  const unknownTask = await source.execute({ schemaVersion: 1, operation: "show", taskId: "MISSING-1", input: {} });
  assertFailure(unknownTask);
  assert.equal(unknownTask.error.code, "NOT_FOUND");

  const staleClaim = await source.execute({
    schemaVersion: 1,
    operation: "claim",
    taskId,
    expectedNativeRevision: `${showResponse.nativeRevision}-stale`,
    idempotencyKey: "C-1:QK-1:claim:evt-stale",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  });
  assertFailure(staleClaim);
  assert.equal(staleClaim.error.code, "STALE_REVISION");

  const claimRequest = {
    schemaVersion: 1 as const,
    operation: "claim" as const,
    taskId,
    expectedNativeRevision: showResponse.nativeRevision!,
    idempotencyKey: "C-1:QK-1:claim:evt-1",
    input: {
      campaignId: "C-1",
      owner: "supervisor:S-1",
      claimedAt: "2026-07-21T00:00:00.000Z",
    },
  };
  const firstClaim = await source.execute(claimRequest);
  assert.equal(firstClaim.ok, true);
  const replayClaim = await source.execute(claimRequest);
  assert.deepEqual(replayClaim, firstClaim);

  const conflictingClaim = await source.execute({
    ...claimRequest,
    input: { ...claimRequest.input, owner: "supervisor:S-2" },
  });
  assertFailure(conflictingClaim);
  assert.equal(conflictingClaim.error.code, "SOURCE_CONFLICT");

  // When capabilities omit an operation, execute must reject it with PROTOCOL_VIOLATION.
  // Full-capability drivers that advertise every op skip this check — no under-advertising required.
  const unsupported = ALL_OPERATIONS.find((operation) => !capabilities.operations.includes(operation));
  if (unsupported) {
    const unsupportedResponse = await source.execute(buildUnsupportedRequest(unsupported, taskId, showResponse.nativeRevision!));
    assertFailure(unsupportedResponse);
    assert.equal(unsupportedResponse.error.code, "PROTOCOL_VIOLATION");
  }
}

function buildUnsupportedRequest(
  operation: TaskSourceOperation,
  taskId: string,
  nativeRevision: string,
): TaskSourceRequest {
  switch (operation) {
    case "capabilities":
      return { schemaVersion: 1, operation: "capabilities", input: {} };
    case "validate":
      return { schemaVersion: 1, operation: "validate", input: {} };
    case "list":
      return { schemaVersion: 1, operation: "list", input: {} };
    case "show":
      return { schemaVersion: 1, operation: "show", taskId, input: {} };
    case "verify":
      return { schemaVersion: 1, operation: "verify", taskId, input: { scope: "task" } };
    case "claim":
      return {
        schemaVersion: 1,
        operation: "claim",
        taskId,
        expectedNativeRevision: nativeRevision,
        idempotencyKey: `C-1:${taskId}:claim:evt-unsupported`,
        input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
      };
    case "release":
      return {
        schemaVersion: 1,
        operation: "release",
        taskId,
        expectedNativeRevision: nativeRevision,
        idempotencyKey: `C-1:${taskId}:release:evt-unsupported`,
        input: { campaignId: "C-1" },
      };
    case "block":
      return {
        schemaVersion: 1,
        operation: "block",
        taskId,
        expectedNativeRevision: nativeRevision,
        idempotencyKey: `C-1:${taskId}:block:evt-unsupported`,
        input: { reason: "blocked", unblockCondition: "unblock" },
      };
    case "submit-review":
    case "complete":
      return {
        schemaVersion: 1,
        operation,
        taskId,
        expectedNativeRevision: nativeRevision,
        idempotencyKey: `C-1:${taskId}:${operation}:evt-unsupported`,
        input: { evidenceRefs: [] },
      };
    case "attach-provenance":
      return {
        schemaVersion: 1,
        operation: "attach-provenance",
        taskId,
        expectedNativeRevision: nativeRevision,
        idempotencyKey: `C-1:${taskId}:attach-provenance:evt-unsupported`,
        input: {
          iteration: {
            schemaVersion: 1,
            id: "iter-1",
            startedAt: "2026-07-21T00:00:00.000Z",
            outcome: "ok",
          },
        },
      };
    case "propose":
      return {
        schemaVersion: 1,
        operation: "propose",
        taskId,
        expectedNativeRevision: nativeRevision,
        idempotencyKey: `C-1:${taskId}:propose:evt-unsupported`,
        input: { task: { id: "QK-2" } },
      };
  }
}
