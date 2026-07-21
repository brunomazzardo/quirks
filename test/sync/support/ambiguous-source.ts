import type { TaskSource } from "../../../src/task-source/task-source.js";
import type { MutationRequest, TaskSourceRequest, TaskSourceResponse } from "../../../src/task-source/types.js";

export class AmbiguousThenAcknowledgedSource implements TaskSource {
  mutationCalls = 0;
  readonly claimRequest: MutationRequest = {
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: "sha256:before",
    idempotencyKey: "C-1:QK-1:claim:evt-1",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  };

  constructor(private readonly options: { conflict?: boolean } = {}) {}

  async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
    if (request.operation === "claim") {
      this.mutationCalls += 1;
      if (this.options.conflict) {
        return {
          schemaVersion: 1,
          operation: "claim",
          ok: false,
          error: { code: "STALE_REVISION", message: "changed", retryable: false },
        };
      }
      throw Object.assign(new Error("connection lost after write"), { code: "SOURCE_UNAVAILABLE" });
    }
    if (request.operation === "show") {
      return {
        schemaVersion: 1,
        operation: "show",
        ok: true,
        nativeRevision: "sha256:after",
        data: { id: "QK-1", status: "claimed", coordination: { campaignId: "C-1" } },
      };
    }
    if (request.operation === "capabilities") {
      return {
        schemaVersion: 1,
        operation: "capabilities",
        ok: true,
        data: {
          schemaVersion: 1,
          protocol: "task-source-v1",
          driver: "test",
          concurrencyStrength: "optimistic",
          provenanceWriteMode: "none",
          commentWriteMode: "none",
          idempotencyLookup: "state",
          operations: ["capabilities", "show", "claim"],
          authorityClasses: ["external-system"],
          completionBoundaries: [],
          maxRequestBytes: 1_048_576,
          maxResponseBytes: 1_048_576,
        },
      };
    }
    return { schemaVersion: 1, operation: request.operation, ok: true, data: {} } as TaskSourceResponse;
  }
}
