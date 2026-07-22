import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { CliParseError, parseArgs } from "../../src/cli/args.js";
import { exitCodeForError } from "../../src/cli/output.js";
import { QuirksError } from "../../src/core/errors.js";
import { loadProjectContext } from "../../src/project/config.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import type { SyncIntent } from "../../src/sync/types.js";

const execFileAsync = promisify(execFile);
const jsonProjectFixture = path.resolve("test/fixtures/json-project");
const tasksCli = path.resolve("dist/src/cli/quirks-tasks.js");

test("parseArgs accepts the supported command shapes", () => {
  assert.deepEqual(parseArgs(["validate", "--json"]), { command: "validate", json: true });
  assert.deepEqual(parseArgs(["list", "--config", ".agents/quirks.json", "--status", "ready"]), {
    command: "list",
    configPath: ".agents/quirks.json",
    status: "ready",
    json: false,
  });
  assert.deepEqual(parseArgs(["show", "QK-1", "--json"]), { command: "show", taskId: "QK-1", json: true });
  assert.deepEqual(
    parseArgs([
      "propose",
      "QK-2",
      "--task-file",
      ".quirks/proposals/QK-2.json",
      "--idempotency-key",
      "brainstorm:QK-2:propose:v1",
      "--json",
    ]),
    {
      command: "propose",
      taskId: "QK-2",
      taskFile: ".quirks/proposals/QK-2.json",
      idempotencyKey: "brainstorm:QK-2:propose:v1",
      json: true,
    },
  );
  assert.deepEqual(parseArgs(["sync"]), { command: "sync", json: false });
  assert.deepEqual(parseArgs(["claim-candidate", "--json"]), { command: "claim-candidate", json: true });
});

test("claim-candidate rejects positionals and mutation-only flags", () => {
  assert.throws(() => parseArgs(["claim-candidate", "QK-1"]), CliParseError);
  assert.throws(() => parseArgs(["claim-candidate", "--request-file", ".quirks/requests/x.json"]), CliParseError);
  assert.throws(() => parseArgs(["claim-candidate", "--status", "ready"]), CliParseError);
});

test("mutation commands require a repository-relative request file", () => {
  assert.deepEqual(parseArgs(["propose", "--request-file", ".quirks/requests/propose.json", "--json"]), {
    command: "propose",
    requestFile: ".quirks/requests/propose.json",
    json: true,
  });
  for (const command of ["claim", "submit-review", "attach-provenance", "complete", "block", "release"]) {
    assert.deepEqual(parseArgs([command, "--request-file", ".quirks/requests/request.json"]), {
      command,
      requestFile: ".quirks/requests/request.json",
      json: false,
    });
  }
  assert.throws(() => parseArgs(["complete", "--request-file", "../outside.json"]), /repository-relative/);
});

test("parseArgs rejects duplicate flags, unknown options, and extra positionals", () => {
  assert.throws(() => parseArgs(["validate", "--json", "--json"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--config", "a", "--config", "b"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--unknown"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "-c"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--config"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "extra"]), CliParseError);
  assert.throws(() => parseArgs(["show", "QK-1", "extra"]), CliParseError);
  assert.throws(() => parseArgs(["propose", "QK-2", "--task-file", "task.json"]), CliParseError);
  assert.throws(() => parseArgs(["propose", "QK-2", "--idempotency-key", "key"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--status", "ready"]), CliParseError);
});

test("exitCodeForError maps domain and availability failures", () => {
  assert.equal(exitCodeForError(new QuirksError("SCHEMA_INVALID", "bad")), 3);
  assert.equal(exitCodeForError(new QuirksError("SOURCE_CONFLICT", "stale")), 3);
  assert.equal(exitCodeForError(new QuirksError("SOURCE_UNAVAILABLE", "down")), 4);
  assert.equal(exitCodeForError(new Error("boom")), 1);
});

type CandidateFixture = { root: string; stateDir: string };

function ledgerTask(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Task ${id}`,
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
    acceptanceCriteria: ["Candidate query passes"],
    verification: ["pnpm test"],
    provenance: { schemaVersion: 1, iterations: [] },
    coordination: null,
    statusDetail: null,
    ...overrides,
  };
}

async function candidateFixture(tasks: Record<string, unknown>[]): Promise<CandidateFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-claim-candidate-"));
  await cp(jsonProjectFixture, root, { recursive: true });
  await mkdir(path.join(root, ".quirks"), { recursive: true });
  await writeFile(
    path.join(root, ".quirks/tasks.json"),
    `${JSON.stringify({ schemaVersion: 1, tasks }, null, 2)}\n`,
    "utf8",
  );
  await execFileAsync("git", ["init", root]);
  return { root, stateDir: path.join(root, ".quirks-state") };
}

async function runClaimCandidate(fixture: CandidateFixture): Promise<Record<string, unknown>> {
  const result = await execFileAsync(process.execPath, [tasksCli, "claim-candidate", "--json"], {
    cwd: fixture.root,
    env: { ...process.env, QUIRKS_STATE_DIR: fixture.stateDir },
  });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

test("claim-candidate picks the eligible ready task over a dependency-blocked one", async () => {
  const fixture = await candidateFixture([
    ledgerTask("QK-A", { priority: "P1" }),
    ledgerTask("QK-B", { priority: "P0", dependsOn: ["QK-C"] }),
    ledgerTask("QK-C", { priority: "P3", status: "claimed" }),
  ]);
  try {
    assert.deepEqual(await runClaimCandidate(fixture), {
      ok: true,
      available: true,
      task: { id: "QK-A", title: "Task QK-A", status: "ready", dependsOnSatisfied: true },
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("claim-candidate orders by priority and breaks ties by ascending id", async () => {
  const fixture = await candidateFixture([
    ledgerTask("QK-0", { priority: "P3", status: "completed" }),
    ledgerTask("QK-1", { priority: "P2" }),
    ledgerTask("QK-3", { priority: "P0", dependsOn: ["QK-0"] }),
    ledgerTask("QK-2", { priority: "P0" }),
  ]);
  try {
    const result = await runClaimCandidate(fixture);
    assert.deepEqual(result, {
      ok: true,
      available: true,
      task: { id: "QK-2", title: "Task QK-2", status: "ready", dependsOnSatisfied: true },
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("claim-candidate reports no_ready_tasks for empty or fully blocked ledgers", async () => {
  const empty = await candidateFixture([]);
  try {
    assert.deepEqual(await runClaimCandidate(empty), { ok: true, available: false, reason: "no_ready_tasks" });
  } finally {
    await rm(empty.root, { recursive: true, force: true });
  }

  const blocked = await candidateFixture([
    ledgerTask("QK-A", { dependsOn: ["QK-B"] }),
    ledgerTask("QK-B", { status: "claimed" }),
  ]);
  try {
    assert.deepEqual(await runClaimCandidate(blocked), { ok: true, available: false, reason: "no_ready_tasks" });
  } finally {
    await rm(blocked.root, { recursive: true, force: true });
  }
});

test("claim-candidate reports pending_sync while outbox intents remain pending", async () => {
  const fixture = await candidateFixture([ledgerTask("QK-A", { priority: "P0" })]);
  try {
    const context = await loadProjectContext(fixture.root, { mode: "inspection" });
    const outboxPath = path.join(
      fixture.stateDir,
      "repositories",
      context.repositoryId.replace(":", "-"),
      "sync-outbox.jsonl",
    );
    const intent: SyncIntent = {
      schemaVersion: 1,
      intentId: "C-1:QK-A:claim:evt-1",
      campaignId: "C-1",
      taskId: "QK-A",
      operation: "claim",
      requestHash: "sha256:abc",
      request: {
        schemaVersion: 1,
        operation: "claim",
        taskId: "QK-A",
        expectedNativeRevision: "sha256:before",
        idempotencyKey: "C-1:QK-A:claim:evt-1",
        input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-22T00:00:00.000Z" },
      },
      state: "pending",
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    await SyncOutbox.open(outboxPath).enqueue(intent);
    assert.deepEqual(await runClaimCandidate(fixture), { ok: true, available: false, reason: "pending_sync" });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
