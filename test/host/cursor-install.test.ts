import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installCursorHost } from "../../hosts/cursor/install.mjs";
import { uninstallCursorHost } from "../../hosts/cursor/uninstall.mjs";

const repoRoot = path.resolve(".");

test("cursor install creates managed skills link", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-cursor-install-"));
  const skillsDir = path.join(sandbox, ".cursor", "skills");
  const result = await installCursorHost({ sourceRoot: repoRoot, skillsDir });
  assert.equal(result.action, "created");
  const link = await lstat(path.join(skillsDir, "quirks"));
  assert.ok(link.isSymbolicLink());
  await uninstallCursorHost({ skillsDir, sourceRoot: repoRoot });
  await rm(sandbox, { recursive: true, force: true });
});

test("cursor uninstall only removes expected managed link", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-cursor-uninstall-"));
  const skillsDir = path.join(sandbox, ".cursor", "skills");
  await installCursorHost({ sourceRoot: repoRoot, skillsDir });
  const removed = await uninstallCursorHost({ skillsDir, sourceRoot: repoRoot });
  assert.equal(removed.action, "removed");
  const absent = await uninstallCursorHost({ skillsDir, sourceRoot: repoRoot });
  assert.equal(absent.action, "absent");
  await rm(sandbox, { recursive: true, force: true });
});
