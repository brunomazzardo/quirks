import assert from "node:assert/strict";
import test from "node:test";
import { queryKeys } from "../../../src/ui/client/query-options.js";

test("query keys contain bounded identity only", () => {
  assert.deepEqual(queryKeys.existingTasks(), ["ui", "existing-tasks"]);
  assert.deepEqual(queryKeys.preflight("C-1"), ["ui", "preflight", "C-1"]);
  assert.deepEqual(queryKeys.taskHistory("QK-1"), ["ui", "task-history", "QK-1"]);
  const serialized = JSON.stringify([
    queryKeys.existingTasks(),
    queryKeys.preflight("C-1"),
    queryKeys.taskHistory("QK-1"),
  ]);
  assert.doesNotMatch(serialized, /token|digest|qkview_|qkapprove_/i);
});
