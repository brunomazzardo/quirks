import assert from "node:assert/strict";
import { cp, lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installClaudeHost } from "../../hosts/claude/install.mjs";
import { discoverClaudeSkills } from "../../hosts/claude/discover.mjs";
import { installCursorHost } from "../../hosts/cursor/install.mjs";
import { discoverCursorSkills } from "../../hosts/cursor/discover.mjs";
import { validateSkills } from "../../scripts/validate-skills.mjs";

const repoRoot = path.resolve(".");

test("integration: installed host layouts discover the same canonical skills", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "quirks-host-discovery-"));
  const sourceRoot = path.join(sandbox, "quirks-source");
  await cp(repoRoot, sourceRoot, {
    recursive: true,
    filter: (src) => !src.includes("node_modules") && !src.includes(".git") && !src.includes(".worktrees"),
  });

  const validation = await validateSkills({ root: sourceRoot });
  const expected = validation.skills.map((skill) => skill.id).toSorted();

  const claudePlugins = path.join(sandbox, "claude", "plugins");
  await installClaudeHost({ sourceRoot, pluginsDir: claudePlugins });
  const claudeLink = await lstat(path.join(claudePlugins, "quirks"));
  assert.ok(claudeLink.isSymbolicLink());
  const claude = await discoverClaudeSkills({ layoutRoot: sourceRoot });

  const cursorSkills = path.join(sandbox, "cursor", "skills");
  await installCursorHost({ sourceRoot, skillsDir: cursorSkills });
  const cursor = await discoverCursorSkills({ layoutRoot: sourceRoot });

  assert.deepEqual(claude.skills.map((skill) => skill.id), expected);
  assert.deepEqual(cursor.skills.map((skill) => skill.id), expected);
  await rm(sandbox, { recursive: true, force: true });
});
