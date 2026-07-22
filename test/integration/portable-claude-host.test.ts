import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runPreflight } from "../../src/campaign/preflight.js";
import { hostArgv } from "../host/portable/shared.js";
import { host as claudeHost } from "../host/portable/claude/config.js";

const execFileAsync = promisify(execFile);
const fixture = path.resolve("test/fixtures/portable/json-repo");

async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-portable-claude-"));
  await cp(fixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  return root;
}

test("claude host portable fixture maps to quirks-campaign preflight argv", async () => {
  const root = await freshRepo();
  const argv = hostArgv(claudeHost, root, "PORT-JSON-1");
  assert.deepEqual(argv.slice(0, 3), ["quirks-campaign", "preflight", "--repository"]);
  const preflight = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["PORT-JSON-1"],
    externalRoutingEnabled: false,
  });
  assert.equal(preflight.blockers.length, 0);
});
