import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { JsonTaskSource } from "../../../src/task-source/json/json-task-source.js";
import { assertTaskSourceContract } from "../contract.js";

const execFileAsync = promisify(execFile);
const sourceFixture = path.resolve("test/fixtures/json-project");

async function freshFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-json-source-"));
  await cp(sourceFixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  process.env.QUIRKS_STATE_DIR = path.join(root, ".quirks-state");
  return root;
}

test("JSON driver satisfies the shared contract", async () => {
  await assertTaskSourceContract(async () => JsonTaskSource.open(await freshFixture()));
});

test("JSON driver rejects a stale claim without changing the file", async () => {
  const source = await JsonTaskSource.open(await freshFixture());
  const shown = await source.execute({ schemaVersion: 1, operation: "show", taskId: "QK-1", input: {} });
  if (!shown.ok) assert.fail(shown.error.message);
  const response = await source.execute({
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: `${shown.nativeRevision}-stale`,
    idempotencyKey: "C-1:QK-1:claim:evt-stale",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" },
  });
  if (response.ok) assert.fail("stale mutation succeeded");
  assert.equal(response.error.code, "STALE_REVISION");
});
