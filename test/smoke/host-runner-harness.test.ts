import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertBoundedEvidenceValue,
  blockedEvidence,
  digestBoundedPayload,
  projectMatrixMarkdown,
  validateHostRunnerEvidence,
} from "../../src/smoke/evidence.js";
import {
  installSmokeHostExecutable,
  prepareSmokeFixtureRoot,
  runHostRunnerCell,
  writeSmokeHostsConfig,
  writeSmokeProfilesConfig,
} from "../../src/smoke/host-runner.js";

async function executableFakeRunner(scriptName: string, configDir: string): Promise<string> {
  const fixtureDir = path.resolve("test/fixtures/fake-runners");
  await cp(path.join(fixtureDir, "shared-modes.mjs"), path.join(configDir, "shared-modes.mjs"));
  const source = path.join(fixtureDir, scriptName);
  const target = path.join(configDir, scriptName);
  const original = await readFile(source, "utf8");
  await writeFile(target, `#!/usr/bin/env node\n${original}`, "utf8");
  await chmod(target, 0o755);
  return target;
}

async function createHarnessConfig(): Promise<{
  configDir: string;
  fixtureRoot: string;
  hostExecutable: string;
  executables: { claude: string; codex: string; cursor: string };
}> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-smoke-config-"));
  const fixtureRoot = await prepareSmokeFixtureRoot();
  const claude = await executableFakeRunner("fake-claude.mjs", configDir);
  const codex = await executableFakeRunner("fake-codex.mjs", configDir);
  const cursor = await executableFakeRunner("fake-cursor.mjs", configDir);
  const hostExecutable = await installSmokeHostExecutable(configDir);
  await writeSmokeHostsConfig(configDir, {
    claude: hostExecutable,
    codex: hostExecutable,
    cursor: hostExecutable,
  });
  await writeSmokeProfilesConfig(configDir, { claude, codex, cursor }, "claude");
  return {
    configDir,
    fixtureRoot,
    hostExecutable,
    executables: { claude, codex, cursor },
  };
}

test("evidence rejects credential-shaped strings and home paths", () => {
  assert.throws(() => assertBoundedEvidenceValue("Bearer abc.def.ghi", "token"), /credential-shaped/);
  assert.throws(() => assertBoundedEvidenceValue(os.homedir(), "path"), /home path/);
});

test("blocked evidence is schema-valid", () => {
  const evidence = blockedEvidence({
    host: "codex",
    runner: "claude",
    reason: "missing-approval",
  });
  assert.equal(validateHostRunnerEvidence(evidence).outcome, "blocked");
});

test("matrix markdown projection is deterministic", () => {
  const left = projectMatrixMarkdown([
    blockedEvidence({ host: "claude", runner: "codex", reason: "missing-approval" }),
  ]);
  const right = projectMatrixMarkdown([
    blockedEvidence({ host: "claude", runner: "codex", reason: "missing-approval" }),
  ]);
  assert.equal(left, right);
  assert.match(left, /claude/);
});

test("approved smoke executes a supplied host/runner cell", async () => {
  const { configDir, fixtureRoot, executables } = await createHarnessConfig();
  await writeSmokeProfilesConfig(configDir, executables, "claude");
  const { evidence } = await runHostRunnerCell({
    host: "codex",
    runner: "claude",
    fixtureRoot,
    configDir,
    approved: true,
  });
  assert.equal(evidence.outcome, "passed");
  assert.match(evidence.artifactDigest, /^[a-f0-9]{64}$/);
  assert.equal(evidence.sessionAvailable, true);
});

test("unapproved smoke is blocked without executing host", async () => {
  const { configDir, fixtureRoot } = await createHarnessConfig();
  const { evidence } = await runHostRunnerCell({
    host: "codex",
    runner: "claude",
    fixtureRoot,
    configDir,
    approved: false,
  });
  assert.equal(evidence.outcome, "blocked");
  assert.equal(evidence.deviations[0], "missing-approval");
});

test("artifact digest is deterministic for bounded payloads", () => {
  const payload = { campaignId: "cmp-1", dispatchedJobs: 1, sessionCount: 1 };
  assert.equal(digestBoundedPayload(payload), digestBoundedPayload(payload));
});
