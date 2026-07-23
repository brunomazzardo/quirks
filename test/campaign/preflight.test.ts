import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { runPreflight } from "../../src/campaign/preflight.js";

const execFileAsync = promisify(execFile);
const fixture = path.resolve("test/fixtures/campaign-project");

async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-preflight-"));
  await cp(fixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Quirks Test"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  return root;
}

test("preflight is read-only, expands dependencies, and flags missing design dependencies", async () => {
  const root = await freshRepo();
  const tasksPath = path.join(root, ".quirks/tasks.json");
  const before = await readFile(tasksPath, "utf8");

  const result = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-200"],
    externalRoutingEnabled: false,
  });

  assert.equal(result.mutatedRepository, false);
  assert.equal(await readFile(tasksPath, "utf8"), before);
  assert.deepEqual(result.envelope.taskIds, ["QK-100", "QK-200"]);
  assert.equal(result.blockers.some((blocker) => blocker.includes("QK-100")), true);
  assert.match(result.envelope.digest, /^sha256:/);
  assert.match(result.envelope.hashes.config, /^sha256:/);
  assert.match(result.envelope.hashes.workflowPolicy, /^sha256:/);
  assert.match(result.envelope.hashes.instructions, /^sha256:/);
  assert.equal(result.envelope.routing["QK-200"]?.primary.profileId, "placeholder");
  assert.equal(result.syncHealth.ok, true);

  // QK-200: implementation, effort "standard", risk [] -> reviewer must be elevated one tier above.
  assert.equal(result.envelope.routing["QK-200"]?.primary.tier, "standard");
  assert.equal(result.envelope.routing["QK-200"]?.primary.effort, "standard");
  assert.equal(result.envelope.routing["QK-200"]?.fallbacks[0]?.profileId, "placeholder-reviewer");
  assert.equal(result.envelope.routing["QK-200"]?.fallbacks[0]?.tier, "high");

  // QK-100: design, effort "high", risk ["architecture"] -> judgment-heavy floor keeps reviewer at principal.
  assert.equal(result.envelope.routing["QK-100"]?.primary.tier, "high");
  assert.equal(result.envelope.routing["QK-100"]?.fallbacks[0]?.profileId, "placeholder-reviewer");
  assert.equal(result.envelope.routing["QK-100"]?.fallbacks[0]?.tier, "principal");
});

test("preflight lands requested max concurrency in the digest-bound envelope", async () => {
  const root = await freshRepo();

  const defaulted = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-200"],
    externalRoutingEnabled: false,
  });
  assert.equal(defaulted.envelope.budgets.maxConcurrency, 1);

  const widened = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-200"],
    externalRoutingEnabled: false,
    maxConcurrency: 3,
  });
  assert.equal(widened.envelope.budgets.maxConcurrency, 3);

  const tamperedDigest = computeEnvelopeDigest({
    ...stripDigest(widened.envelope),
    budgets: { ...widened.envelope.budgets, maxConcurrency: 1 },
  });
  assert.notEqual(tamperedDigest, widened.envelope.digest);
});

test("preflight reserves retry headroom in the task budget", async () => {
  const root = await freshRepo();
  const result = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-200"],
    externalRoutingEnabled: false,
  });
  // Attempts are charged against maxTasks per dispatch, so the envelope must
  // leave headroom for maxRetries re-dispatches beyond the first attempts.
  assert.equal(result.envelope.taskIds.length, 2);
  assert.equal(result.envelope.budgets.maxTasks, result.envelope.taskIds.length + result.envelope.budgets.maxRetries);
});

test("preflight rejects max concurrency below 1", async () => {
  const root = await freshRepo();
  await assert.rejects(
    () => runPreflight({
      repositoryRoot: root,
      selectedTaskIds: ["QK-200"],
      externalRoutingEnabled: false,
      maxConcurrency: 0,
    }),
    /maxConcurrency/,
  );
});

test("preflight blocks a proposed non-target closure member instead of deferring the failure to start", async () => {
  const root = await freshRepo();
  const tasksPath = path.join(root, ".quirks/tasks.json");
  const tasks = JSON.parse(await readFile(tasksPath, "utf8")) as {
    tasks: Array<{ id: string; kind: string; status: string; workflow: Record<string, unknown> }>;
  };
  // Make the dependency a plain implementation task so the blocker under test
  // is the proposed-status one, not the design-gate blocker.
  const dependency = tasks.tasks.find((task) => task.id === "QK-100")!;
  dependency.kind = "implementation";
  dependency.status = "proposed";
  dependency.workflow = { family: "superpowers", phase: "execute", designGate: { required: false } };
  await writeFile(tasksPath, JSON.stringify(tasks));

  const result = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-200"],
    externalRoutingEnabled: false,
  });

  const blocker = result.blockers.find((entry) => entry.includes("QK-100") && entry.includes("proposed"));
  assert.ok(blocker, `expected a blocker naming the proposed closure member, got: ${JSON.stringify(result.blockers)}`);
});

test("preflight rejects dependency cycles", async () => {
  const root = await freshRepo();
  const tasksPath = path.join(root, ".quirks/tasks.json");
  const tasks = JSON.parse(await readFile(tasksPath, "utf8")) as { tasks: Array<{ id: string; dependsOn: string[] }> };
  tasks.tasks.find((task) => task.id === "QK-100")!.dependsOn = ["QK-200"];
  await writeFile(tasksPath, JSON.stringify(tasks));

  await assert.rejects(
    () => runPreflight({ repositoryRoot: root, selectedTaskIds: ["QK-200"], externalRoutingEnabled: false }),
    /Dependency cycle/,
  );
});
