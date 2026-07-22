import assert from "node:assert/strict";
import test from "node:test";
import { QuirksError } from "../../src/core/errors.js";
import { createTaskSource } from "../../src/task-source/factory.js";
import type { ProjectContext } from "../../src/project/types.js";
import { assertTaskSourceContract } from "./contract.js";
import { FakeTaskSource } from "./fake-source.js";

test("fake source satisfies the provider-neutral contract", async () => {
  await assertTaskSourceContract(() => new FakeTaskSource());
});

test("fake propose validates candidates against json-task-file-v1 like the real adapter", async () => {
  const source = new FakeTaskSource();
  const candidate = {
    id: "QK-BAD",
    title: "",
    kind: "implementation",
    priority: "P2",
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
    sourceRefs: [],
    deliverables: [],
    acceptanceCriteria: ["Passes"],
    verification: ["pnpm test"],
    provenance: { schemaVersion: 1, iterations: [] },
    coordination: null,
    statusDetail: null,
  };
  // A candidate that violates the per-task schema is rejected at the shared
  // protocol layer for the fake exactly as for the real adapter.
  await assert.rejects(
    () => source.execute({
      schemaVersion: 1,
      operation: "propose",
      taskId: "QK-BAD",
      expectedNativeRevision: `sha256:${"0".repeat(64)}`,
      idempotencyKey: "C-1:QK-BAD:propose:evt-1",
      input: { task: candidate },
    }),
    (error: unknown) => error instanceof QuirksError && error.code === "SCHEMA_INVALID",
  );

  const valid = await source.execute({
    schemaVersion: 1,
    operation: "propose",
    taskId: "QK-GOOD",
    expectedNativeRevision: `sha256:${"0".repeat(64)}`,
    idempotencyKey: "C-1:QK-GOOD:propose:evt-1",
    input: { task: { ...candidate, id: "QK-GOOD", title: "Valid candidate" } },
  });
  assert.equal(valid.ok, true);
});

test("fake propose enforces envelope-level json-task-file-v1 rules like the real adapter", async () => {
  const source = new FakeTaskSource();
  // Fill the envelope to the schema's 1024-task cap (QK-1 pre-exists).
  for (let index = 2; index <= 1024; index += 1) {
    source.upsertTask(`QK-${index}`);
  }
  const overflow = await source.execute({
    schemaVersion: 1,
    operation: "propose",
    taskId: "QK-1025",
    expectedNativeRevision: `sha256:${"0".repeat(64)}`,
    idempotencyKey: "C-1:QK-1025:propose:evt-1",
    input: {
      task: {
        id: "QK-1025",
        title: "One task past the envelope cap",
        kind: "implementation",
        priority: "P2",
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
        sourceRefs: [],
        deliverables: [],
        acceptanceCriteria: ["Passes"],
        verification: ["pnpm test"],
        provenance: { schemaVersion: 1, iterations: [] },
        coordination: null,
        statusDetail: null,
      },
    },
  });
  assert.equal(overflow.ok, false);
  if (overflow.ok) return;
  assert.equal(overflow.error.code, "SCHEMA_INVALID");
});

test("mutation identity is campaign/task/operation/event scoped", async () => {
  const source = new FakeTaskSource();
  const response = await source.execute({
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: "sha256:one",
    idempotencyKey: "C-1:QK-1:claim:evt-1",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  });
  assert.equal(response.operation, "claim");
});

function minimalContext(taskSource: ProjectContext["config"]["taskSource"]): ProjectContext {
  return {
    root: "/tmp/quirks",
    repositoryId: "sha256:" + "a".repeat(64),
    configPath: ".agents/quirks.json",
    configTracked: true,
    configHash: "sha256:" + "b".repeat(64),
    config: {
      schemaVersion: 1,
      protocol: "quirks-project-v1",
      taskSource,
      workflowPolicy: { skills: {} },
    },
    effectiveWorkflowPolicy: {
      skills: {},
      nativeStatusMap: { ready: "ready" },
      evidenceMap: { "accepted-commit": ["commit"] },
      allowedCompletionBoundaries: ["accepted-commit"],
    },
  };
}

test("createTaskSource rejects unknown drivers with UNSUPPORTED_VERSION", async () => {
  const context = minimalContext({ driver: "json", path: ".quirks/tasks.json" });
  (context.config.taskSource as { driver: string }).driver = "github";
  await assert.rejects(
    () => createTaskSource(context),
    (error: QuirksError) => error.code === "UNSUPPORTED_VERSION",
  );
});

test("createTaskSource requires a credential resolver for aliased external sources", async () => {
  const context = minimalContext({
    driver: "external",
    command: ["node", "adapter.mjs"],
    credentialAlias: "linear-prod",
  });
  await assert.rejects(
    () => createTaskSource(context),
    (error: QuirksError) => error.code === "SOURCE_UNAVAILABLE",
  );
});

test("createTaskSource accepts an injected credential resolver for external sources", async () => {
  const context = minimalContext({
    driver: "external",
    command: ["node", "adapter.mjs"],
    credentialAlias: "linear-prod",
  });
  const source = await createTaskSource(context, {
    credentialResolver: {
      async resolve() {
        return { LINEAR_API_KEY: "injected" };
      },
    },
  });
  assert.ok(source);
});
