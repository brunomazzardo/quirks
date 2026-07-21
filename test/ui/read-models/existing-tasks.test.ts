import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildExistingTasksProjection } from "../../../src/ui/read-models/existing-tasks.js";
import { loadProjectContext } from "../../../src/project/config.js";
import { validateSchema } from "../../../src/schema/validate.js";

const execFileAsync = promisify(execFile);

async function freshRepo(fixture: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-existing-tasks-"));
  await cp(path.resolve(fixture), root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Quirks Test"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  return root;
}

test("projects provider-neutral tasks with sync freshness and local-only notices", async () => {
  const root = await freshRepo("test/fixtures/json-project");
  const context = await loadProjectContext(root, { mode: "inspection" });
  const projection = await buildExistingTasksProjection(context);
  assert.equal(projection.coordinationNotice, "Local coordination only");
  assert.equal(projection.leaseNotice, "No shared lease");
  assert.equal(projection.source.driver, "json");
  assert.ok(projection.tasks.some((task) => task.id === "QK-1"));
  validateSchema("ui-existing-tasks-v1", projection);
});

test("retains hostile strings without escaping at projection layer", async () => {
  const root = await freshRepo("test/ui/fixtures/hostile-project");
  const context = await loadProjectContext(root, { mode: "inspection" });
  const projection = await buildExistingTasksProjection(context);
  const hostile = projection.tasks.find((task) => task.id === "HOSTILE-1");
  assert.ok(hostile);
  assert.equal(hostile.title, "\u202E<script>alert(1)</script>\u202D");
  assert.ok(hostile.blockers.some((blocker) => blocker.includes('"><img src=x onerror=alert(1)>')));
  assert.ok(!JSON.stringify(projection).includes("Must not leak full acceptance criteria bodies"));
});
