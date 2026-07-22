import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { discoverClaudeSkills } from "../../hosts/claude/discover.mjs";
import { discoverCursorSkills } from "../../hosts/cursor/discover.mjs";
import { validateSkills } from "../../scripts/validate-skills.mjs";

const repoRoot = path.resolve(".");

test("canonical skills are discoverable from claude and cursor layouts", async () => {
  const validation = await validateSkills({ root: repoRoot });
  const expected = validation.skills.map((skill) => skill.id).toSorted();
  const claude = await discoverClaudeSkills({ layoutRoot: repoRoot });
  const cursor = await discoverCursorSkills({ layoutRoot: repoRoot });
  assert.deepEqual(claude.skills.map((skill) => skill.id), expected);
  assert.deepEqual(cursor.skills.map((skill) => skill.id), expected);
});

test("codex plugin manifest resolves skills directory", async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, ".codex-plugin/plugin.json"), "utf8")) as {
    skills: string;
  };
  const skillsRoot = path.resolve(repoRoot, manifest.skills);
  const claude = await discoverClaudeSkills({ layoutRoot: skillsRoot.replace(/[/\\]skills$/, "") });
  assert.ok(claude.skills.length > 0);
});
