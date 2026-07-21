import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { loadPlanOutline } from "../../src/campaign/plan-outline.js";

const execFileAsync = promisify(execFile);

async function gitRepoWithPlan(planContents: string): Promise<{ root: string; commit: string; planPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-plan-outline-"));
  const planPath = "docs/plan.md";
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, planPath), planContents, "utf8");
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Quirks Test"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  const commit = (await execFileAsync("git", ["-C", root, "commit", "-m", "plan"])).stdout.match(/\[.+ ([0-9a-f]+)\]/)?.[1];
  if (!commit) throw new Error("missing commit");
  return { root, commit, planPath };
}

test("parses exact task and step headings from commit-pinned plan", async () => {
  const fixture = await gitRepoWithPlan(`### Task 14: Supervisor orchestration\n\n- [ ] **Step 1: Write failing tests**\n- [ ] **Step 2: Build**\n`);
  const outline = await loadPlanOutline(fixture.root, [{ kind: "plan", path: fixture.planPath, commit: fixture.commit, task: 14 }]);
  assert.equal(outline.tasks.length, 1);
  assert.equal(outline.tasks[0]?.task, 14);
  assert.equal(outline.tasks[0]?.steps.length, 2);
});

test("rejects duplicate step headings", async () => {
  const fixture = await gitRepoWithPlan(`### Task 14: Supervisor orchestration\n\n- [ ] **Step 1: One**\n- [ ] **Step 1: Duplicate**\n`);
  await assert.rejects(
    () => loadPlanOutline(fixture.root, [{ kind: "plan", path: fixture.planPath, commit: fixture.commit, task: 14 }]),
    /Duplicate step/,
  );
});
