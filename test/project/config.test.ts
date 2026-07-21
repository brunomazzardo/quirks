import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, symlink, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { loadProjectContext } from "../../src/project/config.js";

const execFileAsync = promisify(execFile);

const minimalConfig = {
  schemaVersion: 1,
  protocol: "quirks-project-v1",
  taskSource: { driver: "json", path: ".quirks/tasks.json" },
  workflowPolicy: { skills: {} },
} as const;

async function initRepo(root: string): Promise<void> {
  await execFileAsync("git", ["init", root]);
  await mkdir(path.join(root, ".agents"), { recursive: true });
}

test("loads committed JSON source configuration from the canonical repository", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify({
    schemaVersion: 1,
    protocol: "quirks-project-v1",
    taskSource: { driver: "json", path: ".quirks/tasks.json" },
    workflowPolicy: { skills: {} },
  }));
  const context = await loadProjectContext(root, { mode: "inspection" });
  assert.equal(context.root, await realpath(root));
  assert.equal(context.config.taskSource.driver, "json");
  assert.match(context.repositoryId, /^sha256:[a-f0-9]{64}$/);
});

test("rejects unsafe repository-relative config paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify(minimalConfig));

  for (const configPath of ["../escape.json", "/tmp/quirks.json", "a\\b"]) {
    await assert.rejects(
      () => loadProjectContext(root, { mode: "inspection", configPath }),
      (error: Error & { code?: string }) => error.code === "INVALID_REPOSITORY_PATH",
      `expected rejection for ${JSON.stringify(configPath)}`,
    );
  }
});

test("rejects config files that escape the repository via symlink", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "quirks-outside-"));
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(outside, "quirks.json"), JSON.stringify(minimalConfig));
  await symlink(path.join(outside, "quirks.json"), path.join(root, ".agents/quirks.json"));
  await assert.rejects(
    () => loadProjectContext(root, { mode: "inspection" }),
    (error: Error & { code?: string }) => error.code === "PROTOCOL_VIOLATION",
  );
});

test("inspection mode allows an untracked project configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify(minimalConfig));
  const context = await loadProjectContext(root, { mode: "inspection" });
  assert.equal(context.configTracked, false);
});

test("unattended mode rejects an untracked project configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify(minimalConfig));
  await assert.rejects(
    () => loadProjectContext(root, { mode: "unattended" }),
    (error: Error & { code?: string }) => error.code === "PROTOCOL_VIOLATION",
  );
});

test("unattended mode accepts a tracked project configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify(minimalConfig));
  await execFileAsync("git", ["-C", root, "add", ".agents/quirks.json"]);
  const context = await loadProjectContext(root, { mode: "unattended" });
  assert.equal(context.configTracked, true);
});

test("fills JSON-driver workflow defaults without mutating committed config", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify(minimalConfig));
  const context = await loadProjectContext(root, { mode: "inspection" });
  assert.deepEqual(context.config.workflowPolicy, { skills: {} });
  assert.equal(context.effectiveWorkflowPolicy.nativeStatusMap.ready, "ready");
  assert.deepEqual(context.effectiveWorkflowPolicy.allowedCompletionBoundaries, [
    "accepted-commit",
    "campaign-merge",
    "target-merge",
    "remote-push",
  ]);
  assert.deepEqual(context.effectiveWorkflowPolicy.evidenceMap["accepted-commit"], ["commit", "review", "verification"]);
});

test("effective workflow policy defaults are isolated from caller mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify(minimalConfig));

  const first = await loadProjectContext(root, { mode: "inspection" });
  (first.effectiveWorkflowPolicy.nativeStatusMap as Record<string, string>).ready = "blocked";
  (first.effectiveWorkflowPolicy.allowedCompletionBoundaries as string[]).push("accepted-commit");
  (first.effectiveWorkflowPolicy.evidenceMap as Record<string, string[]>)["accepted-commit"] = ["deployment"];

  const second = await loadProjectContext(root, { mode: "inspection" });
  assert.equal(second.effectiveWorkflowPolicy.nativeStatusMap.ready, "ready");
  assert.deepEqual(second.effectiveWorkflowPolicy.allowedCompletionBoundaries, [
    "accepted-commit",
    "campaign-merge",
    "target-merge",
    "remote-push",
  ]);
  assert.deepEqual(second.effectiveWorkflowPolicy.evidenceMap["accepted-commit"], ["commit", "review", "verification"]);
});

test("rejects invalid JSON project configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), "{ not-json");
  await assert.rejects(
    () => loadProjectContext(root, { mode: "inspection" }),
    (error: Error & { code?: string }) => error.code === "PROTOCOL_VIOLATION",
  );
});

test("external task source fails closed without explicit workflow policy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify({
    ...minimalConfig,
    taskSource: { driver: "external", command: ["quirks-tasks", "list"] },
  }));
  await assert.rejects(
    () => loadProjectContext(root, { mode: "inspection" }),
    (error: Error & { code?: string }) => error.code === "PROTOCOL_VIOLATION",
  );
});

test("external task source treats empty workflow maps as absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await initRepo(root);
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify({
    ...minimalConfig,
    taskSource: { driver: "external", command: ["quirks-tasks", "list"] },
    workflowPolicy: {
      skills: {},
      nativeStatusMap: {},
      evidenceMap: {},
    },
  }));
  await assert.rejects(
    () => loadProjectContext(root, { mode: "inspection" }),
    (error: Error & { code?: string }) => error.code === "PROTOCOL_VIOLATION",
  );
});
