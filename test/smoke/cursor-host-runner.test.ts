import assert from "node:assert/strict";
import { access, constants } from "node:fs/promises";
import { chmod, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateHostRunnerEvidence } from "../../src/smoke/evidence.js";
import { SMOKE_MATRIX } from "../../src/smoke/types.js";
import {
  installSmokeHostExecutable,
  prepareSmokeFixtureRoot,
  runHostRunnerCell,
  writeSmokeHostsConfig,
  writeSmokeProfilesConfig,
} from "../../src/smoke/host-runner.js";

const APPROVED = process.env.QUIRKS_SMOKE_APPROVED === "approve-paid-runner-probes";

async function resolveExecutable(name: string): Promise<string | undefined> {
  const searchPath = process.env.PATH?.split(path.delimiter) ?? [];
  for (const directory of searchPath) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return undefined;
}

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

async function createHostConfig() {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-smoke-cursor-"));
  const claude = await executableFakeRunner("fake-claude.mjs", configDir);
  const codex = await executableFakeRunner("fake-codex.mjs", configDir);
  const cursor = await executableFakeRunner("fake-cursor.mjs", configDir);
  const realCursorHost = await resolveExecutable("cursor-agent");
  const orchestratorFallback = await installSmokeHostExecutable(configDir);
  await writeSmokeHostsConfig(configDir, {
    claude: "claude",
    codex: "codex",
    cursor: realCursorHost ?? "cursor-agent",
  });
  return { configDir, executables: { claude, codex, cursor }, realCursorHost, orchestratorFallback };
}

test("cursor host runner smoke matrix", { skip: !APPROVED }, async () => {
  const { configDir, executables, realCursorHost, orchestratorFallback } = await createHostConfig();
  if (!realCursorHost) {
    return;
  }
  for (const cell of SMOKE_MATRIX.filter((entry) => entry.host === "cursor")) {
    const fixtureRoot = await prepareSmokeFixtureRoot();
    await writeSmokeProfilesConfig(configDir, executables, cell.runner);
    const { evidence } = await runHostRunnerCell({
      host: cell.host,
      runner: cell.runner,
      fixtureRoot,
      configDir,
      approved: true,
      orchestratorExecutable: orchestratorFallback,
    });
    validateHostRunnerEvidence(evidence);
    assert.notEqual(evidence.deviations.includes("host-orchestrator-shim"), true);
    assert.ok(
      evidence.outcome === "passed" || evidence.outcome === "failed" || evidence.outcome === "blocked",
      `${cell.host}/${cell.runner} returned ${evidence.outcome}`,
    );
  }
});

test("cursor host runner smoke blocked without approval gate", { skip: APPROVED }, async () => {
  const { configDir, executables } = await createHostConfig();
  const fixtureRoot = await prepareSmokeFixtureRoot();
  await writeSmokeProfilesConfig(configDir, executables, "cursor");
  const { evidence } = await runHostRunnerCell({
    host: "cursor",
    runner: "cursor",
    fixtureRoot,
    configDir,
    approved: false,
  });
  assert.equal(evidence.outcome, "blocked");
  assert.equal(evidence.deviations[0], "missing-approval");
});
