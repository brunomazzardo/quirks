import assert from "node:assert/strict";
import test from "node:test";
import { materializePlannedTasks } from "../../src/task-authoring/materialize.js";
import type { NativeTaskCandidate } from "../../src/task-authoring/types.js";
import type { TaskSourceRequest, TaskSourceResponse } from "../../src/task-source/types.js";
import type { TaskSource } from "../../src/task-source/task-source.js";
import { FakeTaskSource } from "../task-source/fake-source.js";

const PLAN_COMMIT = "a".repeat(40);
const SPEC_COMMIT = "b".repeat(40);

function taskCandidate(id: string, overrides: Partial<NativeTaskCandidate> = {}): NativeTaskCandidate {
  return {
    id,
    title: `Candidate ${id}`,
    kind: "implementation",
    priority: "P1",
    status: "proposed",
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
    sourceRefs: [{ kind: "spec", path: "docs/specs/design.md", commit: SPEC_COMMIT }],
    deliverables: ["Working feature"],
    acceptanceCriteria: ["Feature passes verification"],
    verification: ["pnpm check"],
    provenance: { schemaVersion: 1, iterations: [] },
    coordination: null,
    statusDetail: null,
    ...overrides,
  };
}

test("one cohesive feature becomes one task with every selected plan task ref", async () => {
  const source = new FakeTaskSource();
  const result = await materializePlannedTasks({
    source,
    idempotencyNamespace: "brainstorm:contextual-prompts",
    proposals: [{
      task: taskCandidate("QK-PRM-001"),
      plan: { path: "docs/superpowers/plans/2026-07-22-contextual-copy-prompts.md", commit: PLAN_COMMIT, tasks: [1, 2, 3] },
    }],
  });
  assert.deepEqual(result.map((entry) => entry.id), ["QK-PRM-001"]);
  assert.deepEqual(
    result[0]!.sourceRefs.filter((ref) => ref.kind === "plan").map((ref) => ref.task),
    [1, 2, 3],
  );
  const specRefs = result[0]!.sourceRefs.filter((ref) => ref.kind === "spec");
  assert.deepEqual(specRefs, [{ kind: "spec", path: "docs/specs/design.md", commit: SPEC_COMMIT }]);
  assert.match(result[0]!.nativeRevision, /^sha256:/);
});

test("validates the task source before any mutation is issued", async () => {
  const operations: string[] = [];
  const failing: TaskSource = {
    async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
      operations.push(request.operation);
      return {
        schemaVersion: 1,
        operation: request.operation,
        ok: false,
        error: { code: "SOURCE_UNAVAILABLE", message: "validation failed", retryable: false },
      } as TaskSourceResponse;
    },
  };
  await assert.rejects(
    () => materializePlannedTasks({
      source: failing,
      idempotencyNamespace: "brainstorm:test",
      proposals: [{
        task: taskCandidate("QK-PRM-001"),
        plan: { path: "docs/plan.md", commit: PLAN_COMMIT, tasks: [1] },
      }],
    }),
    /validation failed|task source/i,
  );
  assert.deepEqual(operations, ["validate"], "must stop after failed validation without proposing");
});

test("rejects overlapping plan-task ownership across proposals before mutating", async () => {
  const source = new FakeTaskSource();
  await assert.rejects(
    () => materializePlannedTasks({
      source,
      idempotencyNamespace: "brainstorm:test",
      proposals: [
        { task: taskCandidate("QK-A-001"), plan: { path: "docs/plan.md", commit: PLAN_COMMIT, tasks: [1, 2] } },
        { task: taskCandidate("QK-B-001"), plan: { path: "docs/plan.md", commit: PLAN_COMMIT, tasks: [2, 3] } },
      ],
    }),
    /overlap/i,
  );
});

test("rejects duplicate task ids and duplicate plan task numbers", async () => {
  const source = new FakeTaskSource();
  await assert.rejects(
    () => materializePlannedTasks({
      source,
      idempotencyNamespace: "brainstorm:test",
      proposals: [
        { task: taskCandidate("QK-A-001"), plan: { path: "docs/plan.md", commit: PLAN_COMMIT, tasks: [1] } },
        { task: taskCandidate("QK-A-001"), plan: { path: "docs/other-plan.md", commit: PLAN_COMMIT, tasks: [1] } },
      ],
    }),
    /duplicate/i,
  );
  await assert.rejects(
    () => materializePlannedTasks({
      source,
      idempotencyNamespace: "brainstorm:test",
      proposals: [
        { task: taskCandidate("QK-A-001"), plan: { path: "docs/plan.md", commit: PLAN_COMMIT, tasks: [2, 2] } },
      ],
    }),
    /duplicate/i,
  );
});

test("rejects malformed plan commits and non-repository-relative plan paths", async () => {
  const source = new FakeTaskSource();
  await assert.rejects(
    () => materializePlannedTasks({
      source,
      idempotencyNamespace: "brainstorm:test",
      proposals: [
        { task: taskCandidate("QK-A-001"), plan: { path: "docs/plan.md", commit: "abc123", tasks: [1] } },
      ],
    }),
    /commit/i,
  );
  await assert.rejects(
    () => materializePlannedTasks({
      source,
      idempotencyNamespace: "brainstorm:test",
      proposals: [
        { task: taskCandidate("QK-A-001"), plan: { path: "/etc/passwd", commit: PLAN_COMMIT, tasks: [1] } },
      ],
    }),
    /path/i,
  );
  await assert.rejects(
    () => materializePlannedTasks({
      source,
      idempotencyNamespace: "brainstorm:test",
      proposals: [
        { task: taskCandidate("QK-A-001"), plan: { path: "../outside.md", commit: PLAN_COMMIT, tasks: [1] } },
      ],
    }),
    /path/i,
  );
});

test("uses stable idempotency keys so repeated materialization replays instead of conflicting", async () => {
  const source = new FakeTaskSource();
  const input = {
    source,
    idempotencyNamespace: "brainstorm:contextual-prompts",
    proposals: [{
      task: taskCandidate("QK-PRM-001"),
      plan: { path: "docs/plan.md", commit: PLAN_COMMIT, tasks: [1, 2] },
    }],
  };
  const first = await materializePlannedTasks(input);
  const second = await materializePlannedTasks(input);
  assert.deepEqual(second.map((entry) => entry.id), first.map((entry) => entry.id));
  assert.deepEqual(second[0]!.sourceRefs, first[0]!.sourceRefs);
});

test("fails when the read-back task does not carry the exact expected source refs", async () => {
  const source = new FakeTaskSource();
  const lying: TaskSource = {
    async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
      const response = await source.execute(request);
      if (request.operation === "show" && response.ok) {
        const data = response.data as { sourceRefs: readonly unknown[] };
        return { ...response, data: { ...(response.data as Record<string, unknown>), sourceRefs: data.sourceRefs.slice(0, 1) } } as TaskSourceResponse;
      }
      return response;
    },
  };
  await assert.rejects(
    () => materializePlannedTasks({
      source: lying,
      idempotencyNamespace: "brainstorm:test",
      proposals: [{
        task: taskCandidate("QK-PRM-001"),
        plan: { path: "docs/plan.md", commit: PLAN_COMMIT, tasks: [1, 2] },
      }],
    }),
    /source refs/i,
  );
});

test("verifies the read-back workflow policy matches the approved candidate", async () => {
  const source = new FakeTaskSource();
  const rewriting: TaskSource = {
    async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
      const response = await source.execute(request);
      if (request.operation === "show" && response.ok) {
        return {
          ...response,
          data: {
            ...(response.data as Record<string, unknown>),
            workflow: { family: "superpowers", phase: "execute", designGate: { required: false }, rewritten: true },
          },
        } as TaskSourceResponse;
      }
      return response;
    },
  };
  await assert.rejects(
    () => materializePlannedTasks({
      source: rewriting,
      idempotencyNamespace: "brainstorm:test",
      proposals: [{
        task: taskCandidate("QK-PRM-001"),
        plan: { path: "docs/plan.md", commit: PLAN_COMMIT, tasks: [1] },
      }],
    }),
    /workflow/i,
  );
});
