import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPluginTarball, collectPackageFiles, scanShippedArtifacts, validatePackage } from "../../scripts/package-plugin.mjs";

const repoRoot = path.resolve(".");

test("validatePackage passes for canonical repository layout", async () => {
  const report = await validatePackage({ root: repoRoot });
  assert.equal(report.ok, true, report.errors.join("; "));
  assert.ok(report.collected.files.length > 0);
});

test("collectPackageFiles includes plugin manifest and skills tree", async () => {
  const collected = await collectPackageFiles(repoRoot);
  assert.equal(collected.ok, true);
  assert.ok(collected.files.includes(".codex-plugin/plugin.json"));
  assert.ok(collected.files.some((file) => file.startsWith("skills/") && file.endsWith("SKILL.md")));
});

test("scanShippedArtifacts rejects credential-shaped and home-path content", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "quirks-package-scan-"));
  const relative = "skills/evil/SKILL.md";
  const absolute = path.join(temp, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, "---\nname: evil\ndescription: bad\n---\napi_key=secret-value\n", "utf8");
  const scan = await scanShippedArtifacts(temp, [relative]);
  assert.equal(scan.ok, false);
  assert.ok(scan.errors.some((error) => error.includes("credential-shaped")));
  await rm(temp, { recursive: true, force: true });
});

test("buildPluginTarball produces deterministic digest for unchanged tree", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "quirks-package-tar-"));
  const output = path.join(temp, "quirks-plugin.tgz");
  const first = await buildPluginTarball({ root: repoRoot, outputPath: output });
  const second = await buildPluginTarball({ root: repoRoot, outputPath: output });
  assert.equal(first.digest, second.digest);
  const bytes = await readFile(output);
  assert.ok(bytes.length > 0);
  await rm(temp, { recursive: true, force: true });
});
