import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const sourceFixture = path.resolve("test/fixtures/json-project");
const externalFixture = path.resolve("test/fixtures/portable/external-repo");
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

function largeProposedTask(id: string) {
  const prose = Array.from({ length: 64 }, (_, index) => `field-${index}:${"x".repeat(1_000)}`);
  const commitRefs = Array.from({ length: 64 }, () => "a".repeat(40));
  return {
    ...proposedTask(id),
    deliverables: prose,
    acceptanceCriteria: prose,
    verification: prose,
    provenance: {
      schemaVersion: 1,
      iterations: Array.from({ length: 128 }, (_, index) => ({
        id: `large-${index}`,
        outcome: "completed",
        completionBoundary: "accepted-commit",
        commitRefs,
      })),
    },
  };
}

async function freshExternalFixture(mode: "malformed" | "limited"): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-external-cli-"));
  await cp(externalFixture, root, { recursive: true });
  const adapter = path.join(root, "adapter.mjs");
  await writeFile(adapter, `
import { writeFile } from "node:fs/promises";
const input = await new Promise((resolve, reject) => {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { body += chunk; });
  process.stdin.on("end", () => resolve(body));
  process.stdin.on("error", reject);
});
const request = JSON.parse(input.trim());
const base = {
  schemaVersion: 1,
  protocol: "task-source-v1",
  driver: "test-external",
  concurrencyStrength: "local-only",
  provenanceWriteMode: "structured",
  commentWriteMode: "none",
  idempotencyLookup: "state",
  authorityClasses: ["repository"],
  completionBoundaries: ["accepted-commit"],
  maxRequestBytes: 1048576,
  maxResponseBytes: 1048576,
};
if (request.operation === "capabilities") {
  const data = ${JSON.stringify(mode)} === "malformed"
    ? { ...base, operations: ["capabilities"], driver: "" }
    : { ...base, operations: ["capabilities"] };
  process.stdout.write(JSON.stringify({ schemaVersion: 1, operation: "capabilities", ok: true, data }) + "\\n");
} else {
  await writeFile("dispatch.marker", request.operation);
  process.stdout.write(JSON.stringify({ schemaVersion: 1, operation: request.operation, ok: false, error: { code: "PROTOCOL_VIOLATION", message: "unexpected dispatch", retryable: false } }) + "\\n");
}
`, "utf8");
  const configPath = path.join(root, ".agents/quirks.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    taskSource: { command: string[] };
  };
  config.taskSource.command = [process.execPath, adapter];
  await writeFile(configPath, `${JSON.stringify(config)}\n`);
  await execFileAsync("git", ["init", root]);
  return { root, stateDir: path.join(root, ".quirks-state") };
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

test("large persisted proposals return a compact acknowledged mutation result", async () => {
  const fixture = await freshFixture();
  try {
    const taskId = "QK-DGF-LARGE";
    const requestFile = await writeRequest(fixture, "large-propose", {
      schemaVersion: 1,
      operation: "propose",
      taskId,
      expectedNativeRevision: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      idempotencyKey: `C-TEST:${taskId}:propose:large`,
      input: { task: largeProposedTask(taskId) },
    });
    const result = await runTasksCli(fixture, ["propose", "--request-file", requestFile, "--json"]);
    assert.equal(result.ok, true);
    assert.equal(result.operation, "propose");
    assert.deepEqual(result.mutation, {
      state: "acknowledged",
      operation: "propose",
      taskId,
      nativeRevision: (await showTask(fixture, taskId)).nativeRevision,
    });
    assert.equal(result.pending, 0);
    assert.equal(result.conflicts, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("mutation commands reject malformed or unsupported external capabilities before dispatch", async () => {
  for (const mode of ["malformed", "limited"] as const) {
    const fixture = await freshExternalFixture(mode);
    try {
      const requestFile = await writeRequest(fixture, "propose", {
        schemaVersion: 1,
        operation: "propose",
        taskId: "QK-2",
        expectedNativeRevision: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        idempotencyKey: "C-TEST:QK-2:propose:external",
        input: { task: proposedTask("QK-2") },
      });
      await assert.rejects(
        () => execFileAsync(process.execPath, [cli, "propose", "--request-file", requestFile, "--json"], {
          cwd: fixture.root,
          env: { ...process.env, QUIRKS_STATE_DIR: fixture.stateDir },
        }),
        (error: { code?: number; stdout?: string }) => error.code === 3 && error.stdout === "",
      );
      await assert.rejects(() => access(path.join(fixture.root, "dispatch.marker")));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
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

    await mutate("complete", { evidenceRefs: ["commit:cli-1", "review:cli-1", "verification:pnpm-test"] }, 4);
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

    await mkdir(path.join(requestsDir, "not-a-file"));
    await expectRejected(".quirks/requests/not-a-file");
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
