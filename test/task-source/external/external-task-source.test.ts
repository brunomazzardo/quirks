import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { QuirksError } from "../../../src/core/errors.js";
import { createTaskSource } from "../../../src/task-source/factory.js";
import { ExternalTaskSource } from "../../../src/task-source/external/external-task-source.js";
import type { ProjectContext } from "../../../src/project/types.js";
import { assertTaskSourceContract } from "../contract.js";

const adapterPath = path.resolve("test/fixtures/external-adapter/fake-adapter.mjs");

function fixtureSource(environment: Record<string, string> = { QUIRKS_TEST_MODE: "1" }) {
  return new ExternalTaskSource({
    command: [process.execPath, adapterPath],
    timeoutMs: 2_000,
    maxOutputBytes: 1_048_576,
    environment,
  });
}

test("passes one JSON request without invoking a shell", async () => {
  const source = fixtureSource();
  const response = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
  assert.equal(response.ok, true);
  assert.equal(response.operation, "capabilities");
});

test("rejects extra stdout after the response frame", async () => {
  const source = fixtureSource({ QUIRKS_FIXTURE_MODE: "extra-stdout" });
  await assert.rejects(
    () => source.execute({ schemaVersion: 1, operation: "list", input: {} }),
    (error: QuirksError) => error.code === "PROTOCOL_VIOLATION",
  );
});

test("rejects oversized adapter output", async () => {
  const source = fixtureSource({ QUIRKS_FIXTURE_MODE: "oversized" });
  await assert.rejects(
    () => source.execute({ schemaVersion: 1, operation: "list", input: {} }),
    (error: QuirksError) => error.code === "PROTOCOL_VIOLATION",
  );
});

test("rejects adapter timeouts as source outages", async () => {
  const timeoutMs = 500;
  const source = new ExternalTaskSource({
    command: [process.execPath, adapterPath],
    timeoutMs,
    maxOutputBytes: 1_048_576,
    environment: { QUIRKS_FIXTURE_MODE: "timeout" },
  });
  await assert.rejects(
    () => source.execute({ schemaVersion: 1, operation: "list", input: {} }),
    (error: QuirksError) =>
      error.code === "SOURCE_UNAVAILABLE" &&
      error.message.includes(`timed out after ${timeoutMs}ms`),
  );
});

test("rejects adapter crashes without a response frame as source outages", async () => {
  const source = fixtureSource({ QUIRKS_FIXTURE_MODE: "crash" });
  await assert.rejects(
    () => source.execute({ schemaVersion: 1, operation: "list", input: {} }),
    (error: QuirksError) => error.code === "SOURCE_UNAVAILABLE",
  );
});

test("rejects spawn failures as source outages", async () => {
  const source = new ExternalTaskSource({
    command: ["/no/such/adapter-binary"],
    timeoutMs: 2_000,
    maxOutputBytes: 1_048_576,
  });
  await assert.rejects(
    () => source.execute({ schemaVersion: 1, operation: "list", input: {} }),
    (error: QuirksError) => error.code === "SOURCE_UNAVAILABLE",
  );
});

test("rejects malformed adapter output", async () => {
  const source = fixtureSource({ QUIRKS_FIXTURE_MODE: "malformed" });
  await assert.rejects(
    () => source.execute({ schemaVersion: 1, operation: "list", input: {} }),
    (error: QuirksError) => error.code === "PROTOCOL_VIOLATION",
  );
});

test("rejects secret-shaped adapter output", async () => {
  const source = fixtureSource({ QUIRKS_FIXTURE_MODE: "secret" });
  await assert.rejects(
    () => source.execute({ schemaVersion: 1, operation: "list", input: {} }),
    (error: QuirksError) => error.code === "SECRET_REJECTED",
  );
});

test("returns adapter error bodies that exit zero", async () => {
  const source = fixtureSource({ QUIRKS_FIXTURE_MODE: "exit-zero-error" });
  const response = await source.execute({ schemaVersion: 1, operation: "list", input: {} });
  assert.equal(response.ok, false);
  if (response.ok) return;
  assert.equal(response.error.code, "ADAPTER_ERROR");
});

test("rejects stale response operations", async () => {
  const source = fixtureSource({ QUIRKS_FIXTURE_MODE: "stale" });
  await assert.rejects(
    () => source.execute({ schemaVersion: 1, operation: "list", input: {} }),
    (error: QuirksError) => error.code === "PROTOCOL_VIOLATION",
  );
});

test("supports validate, list, and show operations", async () => {
  const source = fixtureSource();
  const validate = await source.execute({ schemaVersion: 1, operation: "validate", input: {} });
  assert.equal(validate.ok, true);
  const list = await source.execute({ schemaVersion: 1, operation: "list", input: {} });
  assert.equal(list.ok, true);
  if (!list.ok) return;
  const tasks = (list.data as { tasks: Array<{ id: string }> }).tasks;
  const taskId = tasks[0]!.id;
  const show = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  assert.equal(show.ok, true);
});

test("scrubs inherited secrets from adapter environment", async () => {
  const previous = {
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    HOME: process.env.HOME,
  };
  process.env.NODE_OPTIONS = "--require /tmp/evil.js";
  process.env.GITHUB_TOKEN = "ghp_supersecret";
  try {
    const source = fixtureSource({ QUIRKS_FIXTURE_MODE: "env-probe" });
    const response = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
    assert.equal(response.ok, true);
    if (!response.ok) return;
    const data = response.data as {
      envKeys: string[];
      home: string | null;
    };
    assert.ok(!data.envKeys.includes("NODE_OPTIONS"));
    assert.ok(!data.envKeys.includes("GITHUB_TOKEN"));
    assert.ok(!data.envKeys.some((key) => key.startsWith("QUIRKS_") && key !== "QUIRKS_FIXTURE_MODE"));
    assert.notEqual(data.home, previous.HOME);
    assert.ok(data.home?.includes("quirks-adapter-"));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("fake external adapter satisfies the provider-neutral contract", async () => {
  await assertTaskSourceContract(() => fixtureSource());
});

function minimalContext(taskSource: ProjectContext["config"]["taskSource"]): ProjectContext {
  return {
    root: process.cwd(),
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

test("createTaskSource wires the external driver", async () => {
  const context = minimalContext({
    driver: "external",
    command: [process.execPath, adapterPath],
  });
  const source = await createTaskSource(context);
  const response = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
  assert.equal(response.ok, true);
});

test("createTaskSource accepts an injected credential resolver for external sources", async () => {
  const context = minimalContext({
    driver: "external",
    command: [process.execPath, adapterPath],
    credentialAlias: "linear-prod",
    credentialEnvironmentNames: ["LINEAR_API_KEY"],
  });
  let requestedNames: readonly string[] | undefined;
  const source = await createTaskSource(context, {
    credentialResolver: {
      async resolve(_alias, requestedEnvironmentNames) {
        requestedNames = requestedEnvironmentNames;
        return { LINEAR_API_KEY: "injected" };
      },
    },
  });
  assert.deepEqual(requestedNames, ["LINEAR_API_KEY"]);
  const response = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
  assert.equal(response.ok, true);
});
