import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, lstat, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { installCursorHost } from "../../hosts/cursor/install.mjs";
import { runPreflight } from "../../src/campaign/preflight.js";
import { hostArgv } from "../host/portable/shared.js";
import { host as cursorHost } from "../host/portable/cursor/config.js";

const execFileAsync = promisify(execFile);
const fixture = path.resolve("test/fixtures/portable/json-repo");
const repoRoot = path.resolve(".");

test("cursor host portable fixture installs managed link and reaches preflight", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-portable-cursor-"));
  const projectRoot = path.join(sandbox, "project");
  await cp(fixture, projectRoot, { recursive: true });
  await execFileAsync("git", ["init", projectRoot]);
  await execFileAsync("git", ["-C", projectRoot, "config", "user.email", "cursor@quirks.test"]);
  await execFileAsync("git", ["-C", projectRoot, "config", "user.name", "Portable Cursor"]);
  await execFileAsync("git", ["-C", projectRoot, "add", "."]);
  await execFileAsync("git", ["-C", projectRoot, "commit", "-m", "fixture"]);
  const skillsDir = path.join(sandbox, ".cursor", "skills");
  await installCursorHost({ sourceRoot: repoRoot, skillsDir });
  const link = await lstat(path.join(skillsDir, "quirks"));
  assert.ok(link.isSymbolicLink());
  const argv = hostArgv(cursorHost, projectRoot, "PORT-JSON-1");
  assert.equal(argv.at(-1), "--json");
  const preflight = await runPreflight({
    repositoryRoot: projectRoot,
    selectedTaskIds: ["PORT-JSON-1"],
    externalRoutingEnabled: false,
  });
  assert.equal(preflight.blockers.length, 0);
});
