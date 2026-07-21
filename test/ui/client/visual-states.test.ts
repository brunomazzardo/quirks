import assert from "node:assert/strict";
import test from "node:test";
import { readinessBadge } from "../../../src/ui/client/visual-states.js";

test("maps readiness to text and tone rather than color alone", () => {
  assert.deepEqual(readinessBadge("ready"), { label: "Ready", tone: "success" });
  assert.deepEqual(readinessBadge("conflict"), { label: "Conflict", tone: "danger" });
});
