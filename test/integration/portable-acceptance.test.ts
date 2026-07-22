import assert from "node:assert/strict";
import test from "node:test";
import { validatePackage } from "../../scripts/package-plugin.mjs";
import { validateSkills } from "../../scripts/validate-skills.mjs";
import { discoverClaudeSkills } from "../../hosts/claude/discover.mjs";
import { discoverCursorSkills } from "../../hosts/cursor/discover.mjs";
import { PORTABLE_HOST_MATRIX } from "../host/portable/shared.js";

const repoRoot = process.cwd();

test("full portable acceptance: package, skills, host matrix, and discovery align", async () => {
  const skills = await validateSkills({ root: repoRoot });
  const pkg = await validatePackage({ root: repoRoot });
  const claude = await discoverClaudeSkills({ layoutRoot: repoRoot });
  const cursor = await discoverCursorSkills({ layoutRoot: repoRoot });
  assert.equal(skills.ok, true);
  assert.equal(pkg.ok, true);
  assert.equal(claude.skills.length, skills.skills.length);
  assert.equal(cursor.skills.length, skills.skills.length);
  assert.equal(PORTABLE_HOST_MATRIX.length, 9);
});
