export type TaskSourceOperation =
  | "capabilities"
  | "validate"
  | "list"
  | "show"
  | "claim"
  | "submit-review"
  | "attach-provenance"
  | "complete"
  | "block"
  | "release"
  | "propose"
  | "verify"
  | "list-goals"
  | "show-goal"
  | "propose-goal"
  | "update-goal";

export type ReadOperation =
  | "capabilities"
  | "validate"
  | "list"
  | "show"
  | "verify"
  | "list-goals"
  | "show-goal";

/** Goal mutations carry a goalId rather than a taskId, so they are their own family. */
export type GoalMutationOperation = "propose-goal" | "update-goal";
export type MutationOperation = Exclude<TaskSourceOperation, ReadOperation | GoalMutationOperation>;

export type GoalState = "active" | "done" | "abandoned";

/**
 * The asserted goal record. Its `state` is a claim someone made, never a
 * rollup: every member task can complete while the goal is not achieved,
 * which is what `doneWhen` exists to decide.
 */
export interface NativeGoal {
  readonly id: string;
  readonly title: string;
  readonly why?: string;
  readonly whyRef?: unknown;
  readonly doneWhen?: readonly string[];
  readonly state: GoalState;
  readonly stateReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type EmptyInput = Readonly<Record<string, never>>;

interface InputByOperation {
  capabilities: EmptyInput;
  validate: EmptyInput;
  list: { status?: string };
  show: EmptyInput;
  verify: { scope: "campaign" | "task" };
  claim: { campaignId: string; owner: string; claimedAt: string };
  "submit-review": { evidenceRefs: readonly string[] };
  "attach-provenance": { iteration: unknown };
  complete: { evidenceRefs: readonly string[] };
  block: { reason: string; unblockCondition: string };
  release: { campaignId: string };
  propose: { task: unknown };
  "list-goals": { state?: GoalState };
  "show-goal": EmptyInput;
  "propose-goal": { goal: NativeGoal };
  "update-goal": {
    title?: string;
    why?: string;
    doneWhen?: readonly string[];
    state?: GoalState;
    stateReason?: string;
  };
}

interface RequestBase<O extends TaskSourceOperation> {
  schemaVersion: 1;
  operation: O;
  input: Readonly<InputByOperation[O]>;
}

type SourceWideReadRequest = {
  [O in "capabilities" | "validate" | "list" | "list-goals"]: RequestBase<O>;
}["capabilities" | "validate" | "list" | "list-goals"];

type GoalReadRequest = RequestBase<"show-goal"> & { goalId: string };

export type GoalMutationRequest =
  | (RequestBase<"propose-goal"> & { goalId: string; idempotencyKey: string })
  | (RequestBase<"update-goal"> & {
      goalId: string;
      expectedNativeRevision: string;
      idempotencyKey: string;
    });

type TaskReadRequest = RequestBase<"show"> & { taskId: string };
type VerifyRequest = RequestBase<"verify"> & { taskId?: string };

export type MutationRequest = {
  [O in MutationOperation]: RequestBase<O> & {
    taskId: string;
    expectedNativeRevision: string;
    idempotencyKey: string;
  };
}[MutationOperation];

export type TaskSourceRequest =
  | SourceWideReadRequest
  | TaskReadRequest
  | VerifyRequest
  | MutationRequest
  | GoalReadRequest
  | GoalMutationRequest;

interface ResponseBase<O extends TaskSourceOperation> {
  schemaVersion: 1;
  operation: O;
}

type SuccessResponse<O extends TaskSourceOperation> = ResponseBase<O> & {
  ok: true;
  nativeRevision?: string;
  data: unknown;
};

type FailureResponse<O extends TaskSourceOperation> = ResponseBase<O> & {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
};

export type TaskSourceResponse = {
  [O in TaskSourceOperation]: SuccessResponse<O> | FailureResponse<O>;
}[TaskSourceOperation];

export interface TaskSourceCapabilities {
  schemaVersion: 1;
  protocol: "task-source-v1";
  driver: string;
  concurrencyStrength: "atomic" | "optimistic" | "local-only" | "none";
  provenanceWriteMode: "structured" | "append-only" | "none";
  commentWriteMode: "structured" | "append-only" | "none";
  idempotencyLookup: "none" | "state" | "key";
  operations: readonly TaskSourceOperation[];
  authorityClasses: readonly ("repository" | "network" | "remote-git" | "external-system" | "production")[];
  completionBoundaries: readonly ("accepted-commit" | "campaign-merge" | "target-merge" | "remote-push")[];
  maxRequestBytes: number;
  maxResponseBytes: number;
}
