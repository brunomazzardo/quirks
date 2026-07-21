import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { validateSkills } from "../../scripts/validate-skills.mjs";

const REQUIRED_SKILLS = [
  "dispatching-external-agents",
  "writing-tasks",
  "updating-tasks",
  "executing-tasks",
] as const;

test("validates canonical skill directories and codex plugin manifest", async () => {
  const report = await validateSkills({ root: path.resolve(".") });
  assert.equal(report.ok, true);
  assert.deepEqual(report.skills.map((skill) => skill.id).sort(), [...REQUIRED_SKILLS].sort());
  assert.equal(report.plugin.name, "quirks");
  assert.match(report.plugin.skillsPath ?? "", /skills$/);
});

test("dogfood reference names the interim Superpowers dispatcher path", async () => {
  const { readFile } = await import("node:fs/promises");
  const dogfood = await readFile(path.resolve("references/dogfood.md"), "utf8");
  assert.match(dogfood, /dispatching-external-agents/);
  assert.match(dogfood, /quirks-campaign/);
  assert.match(dogfood, /transition/i);
});
