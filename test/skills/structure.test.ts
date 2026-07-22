import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateSkills } from "../../scripts/validate-skills.mjs";

const REQUIRED_SKILLS = [
  "delegated-brainstorming",
  "dispatching-external-agents",
  "executing-tasks",
  "running-agent-campaigns",
  "updating-tasks",
  "writing-tasks",
] as const;

test("validates canonical skill directories and codex plugin manifest", async () => {
  const report = await validateSkills({ root: path.resolve(".") });
  assert.equal(report.ok, true);
  assert.deepEqual(report.skills.map((skill) => skill.id).toSorted(), [...REQUIRED_SKILLS].toSorted());
  assert.equal(report.plugin.name, "quirks");
  assert.match(report.plugin.skillsPath ?? "", /skills$/);
});

test("skill references to nonexistent CLI subcommands fail validation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-skill-cli-check-"));
  try {
    const skillDir = path.join(root, "skills", "broken-cli");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: broken-cli",
        "description: Fixture skill naming a nonexistent CLI subcommand.",
        "---",
        "",
        "# Broken CLI fixture",
        "",
        "1. Run `quirks-tasks sync --json` first.",
        "2. Query the store with `quirks-campaign resume-candidate --json`.",
        "3. Then run `quirks-tasks claim-candidat --json` and branch on the output.",
        "",
      ].join("\n"),
      "utf8",
    );

    const report = await validateSkills({ root });
    const fixtureSkill = report.skills.find((skill) => skill.id === "broken-cli");
    assert.ok(fixtureSkill, "fixture skill must be scanned");
    assert.equal(fixtureSkill.ok, false);
    assert.match(fixtureSkill.errors.join("\n"), /unknown quirks-tasks subcommand `claim-candidat`/);
    assert.doesNotMatch(fixtureSkill.errors.join("\n"), /subcommand `sync`/);
    assert.doesNotMatch(fixtureSkill.errors.join("\n"), /subcommand `resume-candidate`/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dogfood reference names the interim Superpowers dispatcher path", async () => {
  const { readFile } = await import("node:fs/promises");
  const dogfood = await readFile(path.resolve("references/dogfood.md"), "utf8");
  assert.match(dogfood, /dispatching-external-agents/);
  assert.match(dogfood, /quirks-campaign/);
  assert.match(dogfood, /transition/i);
});
