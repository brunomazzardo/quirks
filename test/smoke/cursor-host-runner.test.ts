import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SMOKE_MATRIX } from "../../src/smoke/types.js";
import {
  installSmokeHostExecutable,
  prepareSmokeFixtureRoot,
  runHostRunnerCell,
  writeSmokeHostsConfig,
  writeSmokeProfilesConfig,
} from "../../src/smoke/host-runner.js";

const APPROVED = process.env.QUIRKS_SMOKE_APPROVED === "approve-paid-runner-probes";

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

async function createHostConfig(host: "claude" | "codex" | "cursor") {
  const configDir = await mkdtemp(path.join(os.tmpdir(), `quirks-smoke-${host}-`));
  const claude = await executableFakeRunner("fake-claude.mjs", configDir);
  const codex = await executableFakeRunner("fake-codex.mjs", configDir);
  const cursor = await executableFakeRunner("fake-cursor.mjs", configDir);
  const hostExecutable = await installSmokeHostExecutable(configDir);
  await writeSmokeHostsConfig(configDir, {
    claude: hostExecutable,
    codex: hostExecutable,
    cursor: hostExecutable,
  });
  return { configDir, executables: { claude, codex, cursor } };
}

test("cursor host runner smoke matrix", { skip: !APPROVED }, async () => {
  const { configDir, executables } = await createHostConfig("cursor");
  for (const cell of SMOKE_MATRIX.filter((entry) => entry.host === "cursor")) {
    const fixtureRoot = await prepareSmokeFixtureRoot();
    await writeSmokeProfilesConfig(configDir, executables, cell.runner);
    const { evidence } = await runHostRunnerCell({
      host: cell.host,
      runner: cell.runner,
      fixtureRoot,
      configDir,
      approved: true,
    });
    assert.equal(evidence.outcome, "passed", `${cell.host}/${cell.runner}`);
    assert.equal(evidence.sessionAvailable, true);
  }
});

test("cursor host runner smoke blocked without approval gate", { skip: APPROVED }, () => {
  assert.equal(process.env.QUIRKS_SMOKE_APPROVED ?? "", "");
});
