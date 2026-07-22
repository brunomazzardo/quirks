import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runPreflight } from "../../src/campaign/preflight.js";
import { validatePackage } from "../../scripts/package-plugin.mjs";
import { hostArgv } from "../host/portable/shared.js";
import { host as codexHost } from "../host/portable/codex/config.js";

const execFileAsync = promisify(execFile);
const fixture = path.resolve("test/fixtures/portable/json-repo");

async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-portable-codex-"));
  await cp(fixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "codex@quirks.test"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Portable Codex"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  return root;
}

test("codex host portable fixture validates package layout before preflight", async () => {
  const root = await freshRepo();
  const packageReport = await validatePackage({ root: path.resolve(".") });
  assert.equal(packageReport.ok, true);
  const argv = hostArgv(codexHost, root, "PORT-JSON-1");
  assert.equal(argv.includes("preflight"), true);
  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["PORT-JSON-1"],
    externalRoutingEnabled: false,
  });
  assert.equal(preflight.mutatedRepository, false);
});
