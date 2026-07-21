import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openWorkspace } from "../../src/ui/open-workspace.js";

test("does not persist rendered HTML under campaign artifacts", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-open-"));
  process.env.QUIRKS_STATE_DIR = stateDir;
  const result = await openWorkspace({ campaignId: "C-1", ports: "fake", keepAlive: false });
  const files = await readdir(path.join(stateDir, "repositories"), { recursive: true });
  assert.equal(result.ok, true);
  assert.ok(!files.some((f) => String(f).endsWith(".html")));
});
