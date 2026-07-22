import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { validateSkills } from "../../scripts/validate-skills.mjs";

test("every local markdown reference in a shipped skill resolves", async () => {
  const report = await validateSkills({ root: path.resolve(".") });
  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.deepEqual(report.skills.flatMap((skill) => skill.errors), []);
});
