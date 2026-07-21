import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateSchema } from "../../src/schema/validate.js";

const validFile = {
  schemaVersion: 1,
  tasks: [{
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
  }],
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
