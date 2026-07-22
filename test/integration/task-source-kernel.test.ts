import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const sourceFixture = path.resolve("test/fixtures/json-project");
const originalStateDir = process.env.QUIRKS_STATE_DIR;

test.after(() => {
  if (originalStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
  else process.env.QUIRKS_STATE_DIR = originalStateDir;
});

async function freshFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-integration-"));
  await cp(sourceFixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  process.env.QUIRKS_STATE_DIR = path.join(root, ".quirks-state");
  return root;
}

test("JSON fixture validates, lists, shows, and synchronizes through the same CLI", async () => {
  const cli = new URL("../../src/cli/quirks-tasks.js", import.meta.url).pathname;
  const cwd = await freshFixture();
  try {
    const validate = JSON.parse((await execFileAsync(process.execPath, [cli, "validate", "--json"], { cwd })).stdout);
    assert.equal(validate.ok, true);
    assert.equal(validate.driver, "json");
    assert.deepEqual(validate.schemaErrors, []);

    const list = JSON.parse((await execFileAsync(process.execPath, [cli, "list", "--json"], { cwd })).stdout);
    assert.equal(list.ok, true);
    assert.equal(list.tasks[0].source.driver, "json");

    const show = JSON.parse((await execFileAsync(process.execPath, [cli, "show", "QK-1", "--json"], { cwd })).stdout);
    assert.equal(show.ok, true);
    assert.equal(show.task.id, "QK-1");

    const proposalPath = path.join(cwd, ".quirks", "proposals", "QK-2.json");
    await mkdir(path.dirname(proposalPath), { recursive: true });
    await writeFile(proposalPath, JSON.stringify({
      id: "QK-2",
      title: "Proposed through CLI",
      kind: "implementation",
      priority: "P1",
      status: "proposed",
      dependsOn: [],
      workflow: { family: "superpowers", phase: "execute", designGate: { required: false } },
      execution: {
        effort: "standard",
        risk: [],
        capabilities: ["repository-write"],
        parallelismKeys: ["QK-2"],
        humanGates: [],
        completionBoundary: "accepted-commit",
      },
      sourceRefs: [],
      deliverables: ["CLI proposal"],
      acceptanceCriteria: ["Task is durable"],
      verification: ["pnpm test"],
      provenance: { schemaVersion: 1, iterations: [] },
      coordination: null,
      statusDetail: null,
    }));
    const propose = JSON.parse((await execFileAsync(process.execPath, [
      cli,
      "propose",
      "QK-2",
      "--task-file",
      ".quirks/proposals/QK-2.json",
      "--idempotency-key",
      "brainstorm:QK-2:propose:v1",
      "--json",
    ], { cwd })).stdout);
    assert.equal(propose.ok, true);
    assert.equal(propose.task.id, "QK-2");

    const proposed = JSON.parse((await execFileAsync(process.execPath, [cli, "show", "QK-2", "--json"], { cwd })).stdout);
    assert.equal(proposed.task.title, "Proposed through CLI");

    const sync = JSON.parse((await execFileAsync(process.execPath, [cli, "sync", "--json"], { cwd })).stdout);
    assert.equal(sync.ok, true);
    assert.equal(sync.pending, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("unknown commands fail without printing help to stdout JSON", async () => {
  const cli = new URL("../../src/cli/quirks-tasks.js", import.meta.url).pathname;
  await assert.rejects(
    () => execFileAsync(process.execPath, [cli, "unknown", "--json"]),
    (error: { code?: number; stdout?: string }) => error.code === 2 && error.stdout === "",
  );
});

test("quirks-campaign reports usage when invoked without a command", async () => {
  const cli = new URL("../../src/cli/quirks-campaign.js", import.meta.url).pathname;
  await assert.rejects(
    () => execFileAsync(process.execPath, [cli]),
    (error: { code?: number; stderr?: string }) =>
      error.code === 2 &&
      error.stderr === "Usage: quirks-campaign <command> [options]\n",
  );
});
