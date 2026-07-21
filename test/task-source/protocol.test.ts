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
  await assert.rejects(
    () => createTaskSource(context, {
      credentialResolver: {
        async resolve() {
          return { LINEAR_API_KEY: "injected" };
        },
      },
    }),
    (error: QuirksError) => error.code === "UNSUPPORTED_VERSION",
  );
});
