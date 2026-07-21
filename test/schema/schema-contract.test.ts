import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateSchema } from "../../src/schema/validate.js";

const nativeTask = {
  id: "QK-1",
  title: "Test task",
  kind: "implementation",
  priority: "P1",
  status: "ready",
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
  acceptanceCriteria: ["Focused test passes"],
  verification: ["pnpm test"],
  provenance: { schemaVersion: 1, iterations: [] },
};

const validFile = {
  schemaVersion: 1,
  tasks: [nativeTask],
};

const validNormalizedTask = {
  schemaVersion: 1,
  ...nativeTask,
  source: {
    driver: "json",
    nativeId: "QK-1",
    webUrl: null,
  },
  nativeRevision: "opaque-revision",
};

test("accepts the v1 JSON task file and rejects unknown fields", () => {
  assert.equal(validateSchema("json-task-file-v1", validFile), validFile);
  assert.throws(
    () => validateSchema("json-task-file-v1", { ...validFile, surprise: true }),
    /must NOT have additional properties/,
  );
});

test("rejects unsupported schema versions", () => {
  assert.throws(
    () => validateSchema("json-task-file-v1", { ...validFile, schemaVersion: 2 }),
    /schemaVersion/,
  );
});

test("accepts committed project config and task inventory", async () => {
  const projectConfig = JSON.parse(await readFile(".agents/quirks.json", "utf8"));
  const taskFile = JSON.parse(await readFile(".quirks/tasks.json", "utf8"));
  assert.equal(validateSchema("project-config-v1", projectConfig), projectConfig);
  assert.equal(validateSchema("json-task-file-v1", taskFile), taskFile);
});

test("accepts a complete normalized task with derived fields", () => {
  assert.equal(validateSchema("normalized-task-v1", validNormalizedTask), validNormalizedTask);
});

test("accepts HTTPS sourceRef urls without credentials", () => {
  const taskFile = {
    ...validFile,
    tasks: [{
      ...nativeTask,
      sourceRefs: [{
        kind: "spec",
        path: "docs/spec.md",
        commit: "a".repeat(40),
        url: "https://example.com/spec",
      }],
    }],
  };
  assert.equal(validateSchema("json-task-file-v1", taskFile), taskFile);
});

test("rejects duplicate task ids in json-task-file-v1", () => {
  assert.throws(
    () => validateSchema("json-task-file-v1", {
      schemaVersion: 1,
      tasks: [nativeTask, { ...nativeTask, title: "Duplicate" }],
    }),
    /unique task ids/,
  );
});

test("accepts task-source request and response union members", () => {
  const request = {
    schemaVersion: 1,
    operation: "capabilities",
    input: {},
  };
  const successResponse = {
    schemaVersion: 1,
    operation: "capabilities",
    ok: true,
    data: { supportedOperations: ["list"] },
  };
  const failureResponse = {
    schemaVersion: 1,
    operation: "capabilities",
    ok: false,
    error: { code: "UNAVAILABLE", message: "driver offline", retryable: true },
  };

  assert.equal(validateSchema("task-source-request-v1", request), request);
  assert.equal(validateSchema("task-source-response-v1", successResponse), successResponse);
  assert.equal(validateSchema("task-source-response-v1", failureResponse), failureResponse);
});
