import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const sourceFixture = path.resolve("test/fixtures/json-project");
const cli = path.resolve("dist/src/cli/quirks-tasks.js");
const sourceTasksWrapper = path.resolve("scripts/quirks-tasks");

type Fixture = { root: string; stateDir: string };

async function freshFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-tasks-mutations-"));
  await cp(sourceFixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  return { root, stateDir: path.join(root, ".quirks-state") };
}

async function runTasksCli(fixture: Fixture, argv: readonly string[]) {
  const result = await execFileAsync(process.execPath, [cli, ...argv], {
    cwd: fixture.root,
    env: { ...process.env, QUIRKS_STATE_DIR: fixture.stateDir },
  });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function showTask(fixture: Fixture, taskId: string) {
  const result = await runTasksCli(fixture, ["show", taskId, "--json"]);
  return result.task as Record<string, unknown>;
}

async function writeRequest(fixture: Fixture, name: string, request: unknown): Promise<string> {
  const relative = `.quirks/requests/${name}.json`;
  await mkdir(path.join(fixture.root, ".quirks/requests"), { recursive: true });
  await writeFile(path.join(fixture.root, relative), `${JSON.stringify(request)}\n`);
  return relative;
}

function proposedTask(id: string) {
  return {
    id,
    title: "CLI proposed task",
    kind: "implementation",
    priority: "P2",
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
    acceptanceCriteria: ["CLI mutation succeeds"],
    verification: ["pnpm test"],
    provenance: { schemaVersion: 1, iterations: [] },
    coordination: null,
    statusDetail: null,
  };
}

test("propose mutates only through the configured task source", async () => {
  const fixture = await freshFixture();
  try {
    const taskId = "QK-DGF-TEST";
    const requestFile = await writeRequest(fixture, "propose", {
      schemaVersion: 1,
      operation: "propose",
      taskId,
      expectedNativeRevision: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      idempotencyKey: `C-TEST:${taskId}:propose:1`,
      input: { task: proposedTask(taskId) },
    });

    const result = await runTasksCli(fixture, ["propose", "--request-file", requestFile, "--json"]);
    assert.equal(result.operation, "propose");
    assert.equal(result.ok, true);
    assert.equal((await showTask(fixture, taskId)).status, "ready");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("mutation commands preserve semantic task transitions and acknowledge the outbox", async () => {
  const fixture = await freshFixture();
  try {
    const taskId = "QK-1";
    const campaignId = "C-TEST";
    const mutate = async (operation: string, input: unknown, sequence: number) => {
      const task = await showTask(fixture, taskId);
      const requestFile = await writeRequest(fixture, `${operation}-${sequence}`, {
        schemaVersion: 1,
        operation,
        taskId,
        expectedNativeRevision: task.nativeRevision,
        idempotencyKey: `${campaignId}:${taskId}:${operation}:${sequence}`,
        input,
      });
      const result = await runTasksCli(fixture, [operation, "--request-file", requestFile, "--json"]);
      assert.equal(result.ok, true);
      assert.equal(result.operation, operation);
      assert.equal(result.pending, 0);
      assert.equal(result.conflicts, 0);
    };

    await mutate("claim", { campaignId, owner: "cli:test", claimedAt: "2026-07-22T00:00:00.000Z" }, 1);
    assert.equal((await showTask(fixture, taskId)).status, "claimed");

    await mutate(
      "attach-provenance",
      {
        iteration: {
          id: "cli-iteration-1",
          outcome: "completed",
          completionBoundary: "accepted-commit",
          startedAt: "2026-07-22T00:00:00.000Z",
        },
      },
      2,
    );

    await mutate("submit-review", { evidenceRefs: ["review:cli-1"] }, 3);
    assert.equal((await showTask(fixture, taskId)).status, "in_review");

    await mutate("complete", { evidenceRefs: ["commit:cli-1"] }, 4);
    assert.equal((await showTask(fixture, taskId)).status, "completed");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("mutation request files reject escapes, schema violations, mismatched operations, and oversized input", async () => {
  const fixture = await freshFixture();
  try {
    const requestsDir = path.join(fixture.root, ".quirks/requests");
    await mkdir(requestsDir, { recursive: true });
    const baseRequest = {
      schemaVersion: 1,
      operation: "claim",
      taskId: "QK-1",
      expectedNativeRevision: (await showTask(fixture, "QK-1")).nativeRevision,
      idempotencyKey: "C-TEST:QK-1:claim:invalid",
      input: { campaignId: "C-TEST", owner: "cli:test", claimedAt: "2026-07-22T00:00:00.000Z" },
    };

    const expectRejected = async (requestFile: string, expectedCode = 3) => {
      await assert.rejects(
        () => execFileAsync(process.execPath, [cli, "claim", "--request-file", requestFile, "--json"], {
          cwd: fixture.root,
          env: { ...process.env, QUIRKS_STATE_DIR: fixture.stateDir },
        }),
        (error: { code?: number; stdout?: string }) => error.code === expectedCode && error.stdout === "",
      );
    };

    await writeFile(path.join(requestsDir, "unknown.json"), `${JSON.stringify({ ...baseRequest, unexpected: true })}\n`);
    await expectRejected(".quirks/requests/unknown.json");

    await writeFile(path.join(requestsDir, "wrong-operation.json"), `${JSON.stringify({ ...baseRequest, operation: "release" })}\n`);
    await expectRejected(".quirks/requests/wrong-operation.json");

    const outside = `${fixture.root}-outside.json`;
    await writeFile(outside, `${JSON.stringify(baseRequest)}\n`);
    await symlink(outside, path.join(requestsDir, "escape.json"));
    await expectRejected(".quirks/requests/escape.json", 2);

    await writeFile(path.join(requestsDir, "oversized.json"), "x".repeat(1_048_577));
    await expectRejected(".quirks/requests/oversized.json");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(`${fixture.root}-outside.json`, { force: true });
  }
});

test("source-tree tasks wrapper runs the built CLI", async () => {
  const fixture = await freshFixture();
  try {
    const result = await execFileAsync(sourceTasksWrapper, ["validate", "--json"], {
      cwd: fixture.root,
      env: { ...process.env, QUIRKS_STATE_DIR: fixture.stateDir },
    });
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, driver: "json", schemaErrors: [] });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
