import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { auditTaskTruth } from "../../src/audit/task-truth.js";

test("completed release tasks have passing external evidence", async () => {
  const audit = await auditTaskTruth({ repositoryRoot: path.resolve(".") });
  assert.deepEqual(audit.errors, []);
});
