import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installClaudeHost } from "../../hosts/claude/install.mjs";
import { uninstallClaudeHost } from "../../hosts/claude/uninstall.mjs";
import { installManagedLink } from "../../hosts/shared/link-install.mjs";

const repoRoot = path.resolve(".");

test("claude install creates plugin symlink without overwriting foreign files", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-claude-install-"));
  const pluginsDir = path.join(sandbox, "plugins");
  const result = await installClaudeHost({ sourceRoot: repoRoot, pluginsDir });
  assert.equal(result.action, "created");
  const link = await lstat(path.join(pluginsDir, "quirks"));
  assert.ok(link.isSymbolicLink());
  const second = await installClaudeHost({ sourceRoot: repoRoot, pluginsDir });
  assert.equal(second.action, "unchanged");
  await uninstallClaudeHost({ pluginsDir, sourceRoot: repoRoot });
  await rm(sandbox, { recursive: true, force: true });
});

test("claude install is idempotent when link already points at source", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-claude-idem-"));
  const pluginsDir = path.join(sandbox, "plugins");
  await installClaudeHost({ sourceRoot: repoRoot, pluginsDir });
  const second = await installClaudeHost({ sourceRoot: repoRoot, pluginsDir });
  assert.equal(second.action, "unchanged");
  await uninstallClaudeHost({ pluginsDir, sourceRoot: repoRoot });
  await rm(sandbox, { recursive: true, force: true });
});

test("managed link refuses to replace a real directory", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-claude-dir-"));
  const destination = path.join(sandbox, "plugins", "quirks");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(destination, { recursive: true });
  await assert.rejects(
    () => installManagedLink({ sourceRoot: repoRoot, destination, marker: "claude-plugin" }),
    /refusing to overwrite/,
  );
  await rm(sandbox, { recursive: true, force: true });
});
