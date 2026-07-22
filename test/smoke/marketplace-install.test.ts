import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { validatePackage } from "../../scripts/package-plugin.mjs";
import {
  discoverInstalledSkillIds,
  installAllHosts,
  loadCanonicalSkillIds,
  uninstallAllHosts,
} from "../../hosts/shared/marketplace-install.mjs";
import { pathKind } from "../../hosts/shared/link-install.mjs";

const execFileAsync = promisify(execFile);
const APPROVED = process.env.QUIRKS_SMOKE_APPROVED === "approve-marketplace-install";
const repoRoot = path.resolve(".");
const installScript = path.resolve("scripts/quirks-install.mjs");
const uninstallScript = path.resolve("scripts/quirks-uninstall.mjs");

function envWithoutApprovalGate() {
  const env = { ...process.env };
  delete env.QUIRKS_SMOKE_APPROVED;
  return env;
}

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
  const foreignMarkers = {
    claude: path.join(sandboxRoots.claude, "foreign-marker.txt"),
    codex: path.join(sandboxRoots.codex, "foreign-marker.txt"),
    cursor: path.join(sandboxRoots.cursor, "foreign-marker.txt"),
  };
  const foreignDirs = {
    claude: path.join(sandboxRoots.claude, "other-plugin"),
    codex: path.join(sandboxRoots.codex, "other-plugin"),
    cursor: path.join(sandboxRoots.cursor, "other-plugin"),
  };
  for (const host of ["claude", "codex", "cursor"] as const) {
    await mkdir(sandboxRoots[host], { recursive: true });
    await writeFile(foreignMarkers[host], `foreign-${host}\n`, "utf8");
    await mkdir(path.join(foreignDirs[host], "nested"), { recursive: true });
  }
  const installed = await installAllHosts({ sourceRoot: repoRoot, roots: sandboxRoots });
  assert.deepEqual(installed.map((entry) => entry.action), ["created", "created", "created"]);
  for (const host of ["claude", "codex", "cursor"] as const) {
    assert.deepEqual(await discoverInstalledSkillIds(host, sandboxRoots[host]), CANONICAL_SKILLS);
    assert.equal(await readFile(foreignMarkers[host], "utf8"), `foreign-${host}\n`);
    assert.equal(await pathKind(foreignDirs[host]), "directory");
    assert.equal(await pathKind(path.join(sandboxRoots[host], "quirks")), "symlink");
  }
  const second = await installAllHosts({ sourceRoot: repoRoot, roots: sandboxRoots });
  assert.deepEqual(second.map((entry) => entry.action), ["unchanged", "unchanged", "unchanged"]);
  const uninstalled = await uninstallAllHosts({ sourceRoot: repoRoot, roots: sandboxRoots });
  assert.deepEqual(uninstalled.map((entry) => entry.action), ["removed", "removed", "removed"]);
  for (const host of ["claude", "codex", "cursor"] as const) {
    assert.equal(await pathKind(path.join(sandboxRoots[host], "quirks")), "missing");
    assert.equal(await readFile(foreignMarkers[host], "utf8"), `foreign-${host}\n`);
    assert.equal(await pathKind(foreignDirs[host]), "directory");
  }
  const secondUninstall = await uninstallAllHosts({ sourceRoot: repoRoot, roots: sandboxRoots });
  assert.deepEqual(secondUninstall.map((entry) => entry.action), ["absent", "absent", "absent"]);
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

test("marketplace install blocked without approval gate", { skip: APPROVED }, async () => {
  const env = envWithoutApprovalGate();
  await assert.rejects(
    () => execFileAsync(process.execPath, [installScript, "--all", "--source", repoRoot, "--json"], { env }),
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      assert.notEqual(error.code, 0);
      assert.match(String(error.stderr ?? error.message), /QUIRKS_SMOKE_APPROVED=approve-marketplace-install/);
      return true;
    },
  );
  await assert.rejects(
    () => execFileAsync(process.execPath, [uninstallScript, "--all", "--source", repoRoot, "--json"], { env }),
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      assert.notEqual(error.code, 0);
      assert.match(String(error.stderr ?? error.message), /QUIRKS_SMOKE_APPROVED=approve-marketplace-install/);
      return true;
    },
  );
});
