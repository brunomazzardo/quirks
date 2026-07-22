import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateHostRunnerEvidence } from "../../src/smoke/evidence.js";
import { SMOKE_MATRIX } from "../../src/smoke/types.js";
import {
  prepareSmokeFixtureRoot,
  resolveExecutable,
  runHostRunnerCell,
  writeSmokeHostsConfig,
  writeSmokeProfilesConfig,
} from "../../src/smoke/host-runner.js";

const APPROVED = process.env.QUIRKS_SMOKE_APPROVED === "approve-paid-runner-probes";

async function createHostConfig() {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-smoke-claude-"));
  const claude = await resolveExecutable("claude");
  const codex = await resolveExecutable("codex");
  const cursor = await resolveExecutable("cursor-agent");
  if (!claude || !codex || !cursor) {
    return { configDir, executables: undefined, realClaudeHost: claude };
  }
  await writeSmokeHostsConfig(configDir, { claude, codex, cursor });
  return { configDir, executables: { claude, codex, cursor }, realClaudeHost: claude };
}

test("claude host runner smoke matrix", { skip: !APPROVED }, async () => {
  const { configDir, executables, realClaudeHost } = await createHostConfig();
  if (!realClaudeHost || !executables) {
    return;
  }
  for (const cell of SMOKE_MATRIX.filter((entry) => entry.host === "claude")) {
    const fixtureRoot = await prepareSmokeFixtureRoot();
    await writeSmokeProfilesConfig(configDir, executables, cell.runner);
    const { evidence } = await runHostRunnerCell({
      host: cell.host,
      runner: cell.runner,
      fixtureRoot,
      configDir,
      approved: true,
    });
    validateHostRunnerEvidence(evidence);
    assert.equal(evidence.deviations.includes("host-orchestrator-fallback"), false);
    assert.ok(
      evidence.outcome === "passed" || evidence.outcome === "failed" || evidence.outcome === "blocked",
      `${cell.host}/${cell.runner} returned ${evidence.outcome}`,
    );
  }
});

test("claude host runner smoke blocked without approval gate", { skip: APPROVED }, async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-smoke-claude-blocked-"));
  const claude = await resolveExecutable("claude") ?? "claude";
  const codex = await resolveExecutable("codex") ?? "codex";
  const cursor = await resolveExecutable("cursor-agent") ?? "cursor-agent";
  const fixtureDir = path.resolve("test/fixtures/fake-runners");
  await cp(path.join(fixtureDir, "shared-modes.mjs"), path.join(configDir, "shared-modes.mjs"));
  for (const [name, script] of [
    ["fake-claude.mjs", "fake-claude.mjs"],
    ["fake-codex.mjs", "fake-codex.mjs"],
    ["fake-cursor.mjs", "fake-cursor.mjs"],
  ] as const) {
    const source = path.join(fixtureDir, script);
    const target = path.join(configDir, name);
    const original = await readFile(source, "utf8");
    await writeFile(target, `#!/usr/bin/env node\n${original}`, "utf8");
    await chmod(target, 0o755);
  }
  await writeSmokeHostsConfig(configDir, { claude, codex, cursor });
  const fixtureRoot = await prepareSmokeFixtureRoot();
  await writeSmokeProfilesConfig(configDir, {
    claude: path.join(configDir, "fake-claude.mjs"),
    codex: path.join(configDir, "fake-codex.mjs"),
    cursor: path.join(configDir, "fake-cursor.mjs"),
  }, "claude");
  const { evidence } = await runHostRunnerCell({
    host: "claude",
    runner: "claude",
    fixtureRoot,
    configDir,
    approved: false,
  });
  assert.equal(evidence.outcome, "blocked");
  assert.equal(evidence.deviations[0], "missing-approval");
});
