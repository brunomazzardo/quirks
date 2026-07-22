import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultCodexPluginsDir, installCodexHost } from "../../hosts/codex/install.mjs";
import { uninstallCodexHost } from "../../hosts/codex/uninstall.mjs";
import { discoverCodexSkills } from "../../hosts/codex/discover.mjs";
import { installManagedLink } from "../../hosts/shared/link-install.mjs";
import { loadCanonicalSkillIds } from "../../hosts/shared/marketplace-install.mjs";

const repoRoot = path.resolve(".");

test("default codex install root resolves to ~/.codex/skills honoring the env override", () => {
  const original = process.env.QUIRKS_CODEX_PLUGINS_DIR;
  delete process.env.QUIRKS_CODEX_PLUGINS_DIR;
  try {
    assert.equal(defaultCodexPluginsDir(), path.join(os.homedir(), ".codex", "skills"));
    process.env.QUIRKS_CODEX_PLUGINS_DIR = "/tmp/custom-codex-root";
    assert.equal(defaultCodexPluginsDir(), "/tmp/custom-codex-root");
  } finally {
    if (original === undefined) delete process.env.QUIRKS_CODEX_PLUGINS_DIR;
    else process.env.QUIRKS_CODEX_PLUGINS_DIR = original;
  }
});

test("codex install creates plugin symlink without copying skills", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-codex-install-"));
  const pluginsDir = path.join(sandbox, "plugins");
  const result = await installCodexHost({ sourceRoot: repoRoot, pluginsDir });
  assert.equal(result.action, "created");
  const link = await lstat(path.join(pluginsDir, "quirks"));
  assert.ok(link.isSymbolicLink());
  const discovered = await discoverCodexSkills({ layoutRoot: repoRoot });
  const expected = await loadCanonicalSkillIds(repoRoot);
  assert.deepEqual(discovered.skills.map((skill) => skill.id), expected);
  await uninstallCodexHost({ pluginsDir, sourceRoot: repoRoot });
  await rm(sandbox, { recursive: true, force: true });
});

test("codex install is idempotent when link already points at source", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-codex-idem-"));
  const pluginsDir = path.join(sandbox, "plugins");
  await installCodexHost({ sourceRoot: repoRoot, pluginsDir });
  const second = await installCodexHost({ sourceRoot: repoRoot, pluginsDir });
  assert.equal(second.action, "unchanged");
  await uninstallCodexHost({ pluginsDir, sourceRoot: repoRoot });
  await rm(sandbox, { recursive: true, force: true });
});

test("codex managed link refuses to replace a real directory", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-codex-dir-"));
  const destination = path.join(sandbox, "plugins", "quirks");
  await mkdir(destination, { recursive: true });
  await assert.rejects(
    () => installManagedLink({ sourceRoot: repoRoot, destination, marker: "codex-plugin" }),
    /refusing to overwrite/,
  );
  await rm(sandbox, { recursive: true, force: true });
});
