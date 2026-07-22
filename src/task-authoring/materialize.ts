import { QuirksError } from "../core/errors.js";
import { canonicalJson } from "../core/canonical-json.js";
import { assertRepositoryRelativePath } from "../core/repository-path.js";
import type { TaskSourceResponse } from "../task-source/types.js";
import type {
  MaterializedTask,
  MaterializePlannedTasksInput,
  NativeTaskCandidate,
  PlannedTaskRef,
  SourceRef,
} from "./types.js";

/** Revision sentinel used by TaskSource `propose` for tasks that do not exist yet. */
const NEW_TASK_REVISION = `sha256:${"0".repeat(64)}`;

const FULL_LOWERCASE_SHA = /^[0-9a-f]{40}$/;

function assertPlanCommit(commit: string): void {
  if (!FULL_LOWERCASE_SHA.test(commit)) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Plan commit must be a full lowercase SHA: ${JSON.stringify(commit)}`);
  }
}

function assertPlanPath(value: string): void {
  try {
    assertRepositoryRelativePath(value);
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", `Plan path must be repository-relative: ${JSON.stringify(value)}`);
  }
}

function planRefsFor(plan: PlannedTaskRef): SourceRef[] {
  return plan.tasks.map((task) => ({ kind: "plan" as const, path: plan.path, commit: plan.commit, task }));
}

function assertBoundedPartition(input: MaterializePlannedTasksInput): void {
  if (input.proposals.length === 0) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Materialization requires at least one approved proposal");
  }
  if (!input.idempotencyNamespace || input.idempotencyNamespace.includes(":propose:")) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Materialization requires a stable idempotency namespace");
  }

  const seenTaskIds = new Set<string>();
  const ownedPlanTasks = new Set<string>();
  for (const proposal of input.proposals) {
    if (seenTaskIds.has(proposal.task.id)) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Duplicate task id ${proposal.task.id} across proposals`);
    }
    seenTaskIds.add(proposal.task.id);

    assertPlanPath(proposal.plan.path);
    assertPlanCommit(proposal.plan.commit);
    if (proposal.plan.tasks.length === 0) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Proposal ${proposal.task.id} must own at least one numbered plan task`);
    }
    const withinProposal = new Set<number>();
    for (const taskNumber of proposal.plan.tasks) {
      if (!Number.isInteger(taskNumber) || taskNumber <= 0) {
        throw new QuirksError("PROTOCOL_VIOLATION", `Proposal ${proposal.task.id} references an invalid plan task number`);
      }
      if (withinProposal.has(taskNumber)) {
        throw new QuirksError("PROTOCOL_VIOLATION", `Duplicate plan task ${taskNumber} inside proposal ${proposal.task.id}`);
      }
      withinProposal.add(taskNumber);
      const ownership = `${proposal.plan.path}#${taskNumber}`;
      if (ownedPlanTasks.has(ownership)) {
        throw new QuirksError(
          "PROTOCOL_VIOLATION",
          `Plan tasks overlap across proposals: ${proposal.plan.path} task ${taskNumber}`,
        );
      }
      ownedPlanTasks.add(ownership);
    }

    for (const ref of proposal.task.sourceRefs) {
      if (ref.kind === "plan" && ref.path === proposal.plan.path) {
        throw new QuirksError(
          "PROTOCOL_VIOLATION",
          `Proposal ${proposal.task.id} must not pre-populate plan refs for ${proposal.plan.path}; they are appended from the approved partition`,
        );
      }
    }
  }
}

function candidateWithPlanRefs(candidate: NativeTaskCandidate, plan: PlannedTaskRef): NativeTaskCandidate {
  return { ...candidate, sourceRefs: [...candidate.sourceRefs, ...planRefsFor(plan)] };
}

function requireOk<O extends TaskSourceResponse>(response: O, label: string): Extract<O, { ok: true }> {
  if (!response.ok) {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      `Task source ${label} failed: ${response.error.code} ${response.error.message}`,
    );
  }
  return response as Extract<O, { ok: true }>;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Materialize a user-approved task partition into durable Quirks tasks through
 * TaskSource authority. Every mutation is a semantic `propose` with a stable
 * idempotency key; the materializer never opens or edits a provider task file.
 */
export async function materializePlannedTasks(input: MaterializePlannedTasksInput): Promise<MaterializedTask[]> {
  assertBoundedPartition(input);

  requireOk(await input.source.execute({ schemaVersion: 1, operation: "validate", input: {} }), "validate");

  const materialized: MaterializedTask[] = [];
  for (const proposal of input.proposals) {
    const task = candidateWithPlanRefs(proposal.task, proposal.plan);
    requireOk(
      await input.source.execute({
        schemaVersion: 1,
        operation: "propose",
        taskId: task.id,
        expectedNativeRevision: NEW_TASK_REVISION,
        idempotencyKey: `${input.idempotencyNamespace}:propose:${task.id}`,
        input: { task },
      }),
      `propose ${task.id}`,
    );

    const shown = requireOk(
      await input.source.execute({ schemaVersion: 1, operation: "show", taskId: task.id, input: {} }),
      `show ${task.id}`,
    );
    const readBack = shown.data as { id: string; sourceRefs: readonly SourceRef[]; workflow: unknown };
    if (!sameJson(readBack.sourceRefs, task.sourceRefs)) {
      throw new QuirksError(
        "PROTOCOL_VIOLATION",
        `Materialized task ${task.id} does not carry the exact expected source refs`,
      );
    }
    if (!sameJson(readBack.workflow, task.workflow)) {
      throw new QuirksError(
        "PROTOCOL_VIOLATION",
        `Materialized task ${task.id} does not preserve the approved workflow policy`,
      );
    }
    const nativeRevision = shown.nativeRevision;
    if (!nativeRevision) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Task source did not return a native revision for ${task.id}`);
    }
    materialized.push({ id: task.id, nativeRevision, sourceRefs: readBack.sourceRefs });
  }
  return materialized;
}
