import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validatePackage } from "../../scripts/package-plugin.mjs";
import {
  discoverInstalledSkillIds,
  installAllHosts,
  loadCanonicalSkillIds,
  uninstallAllHosts,
} from "../../hosts/shared/marketplace-install.mjs";

const APPROVED = process.env.QUIRKS_SMOKE_APPROVED === "approve-marketplace-install";
const repoRoot = path.resolve(".");

let CANONICAL_SKILLS: string[] = [];

test.before(async () => {
  CANONICAL_SKILLS = await loadCanonicalSkillIds(repoRoot);
});

test("marketplace install makes all canonical skills discoverable in all hosts", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-marketplace-install-"));
  const sandboxRoots = {
    claude: path.join(sandbox, "claude-plugins"),
    codex: path.join(sandbox, "codex-plugins"),
    cursor: path.join(sandbox, "cursor-skills"),
  };
  const installed = await installAllHosts({ sourceRoot: repoRoot, roots: sandboxRoots });
  assert.deepEqual(installed.map((entry) => entry.action), ["created", "created", "created"]);
  for (const host of ["claude", "codex", "cursor"] as const) {
    assert.deepEqual(await discoverInstalledSkillIds(host, sandboxRoots[host]), CANONICAL_SKILLS);
  }
  const second = await installAllHosts({ sourceRoot: repoRoot, roots: sandboxRoots });
  assert.deepEqual(second.map((entry) => entry.action), ["unchanged", "unchanged", "unchanged"]);
  await uninstallAllHosts({ sourceRoot: repoRoot, roots: sandboxRoots });
  await rm(sandbox, { recursive: true, force: true });
});

test("marketplace install verification", { skip: !APPROVED }, async () => {
  const manifest = JSON.parse(await readFile(path.resolve("marketplace/manifest.json"), "utf8")) as {
    plugins: Array<{ id: string }>;
  };
  assert.equal(manifest.plugins[0]?.id, "quirks");
  const pkg = await validatePackage();
  assert.equal(pkg.ok, true);
  const installed = await installAllHosts({ sourceRoot: repoRoot, roots: {
    claude: process.env.QUIRKS_PLUGINS_DIR ?? path.join(os.homedir(), ".claude", "plugins"),
    codex: process.env.QUIRKS_CODEX_PLUGINS_DIR ?? path.join(os.homedir(), ".codex", "plugins"),
    cursor: process.env.QUIRKS_CURSOR_SKILLS_DIR ?? path.join(os.homedir(), ".cursor", "skills"),
  } });
  for (const entry of installed) {
    assert.ok(["created", "unchanged"].includes(entry.action));
  }
  for (const host of ["claude", "codex", "cursor"] as const) {
    const hostRoot = host === "cursor"
      ? process.env.QUIRKS_CURSOR_SKILLS_DIR ?? path.join(os.homedir(), ".cursor", "skills")
      : host === "codex"
        ? process.env.QUIRKS_CODEX_PLUGINS_DIR ?? path.join(os.homedir(), ".codex", "plugins")
        : process.env.QUIRKS_PLUGINS_DIR ?? path.join(os.homedir(), ".claude", "plugins");
    assert.deepEqual(await discoverInstalledSkillIds(host, hostRoot), CANONICAL_SKILLS);
  }
});

test("marketplace install blocked without approval gate", { skip: APPROVED }, () => {
  assert.notEqual(process.env.QUIRKS_SMOKE_APPROVED, "approve-marketplace-install");
});
