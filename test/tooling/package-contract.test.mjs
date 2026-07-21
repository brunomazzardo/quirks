// test/tooling/package-contract.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("package pins the approved dependency-free runtime", async () => {
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.packageManager, "pnpm@10.30.3");
  assert.equal(pkg.engines.node, ">=24.18.0");
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.equal(pkg.devDependencies.typescript, "7.0.2");
  assert.equal(pkg.devDependencies.ajv, "8.20.0");
  assert.equal(pkg.devDependencies["ajv-formats"], "3.0.1");
  assert.equal(pkg.devDependencies.oxlint, "1.74.0");
  assert.equal(pkg.scripts.test, "pnpm build && node scripts/run-tests.mjs");
});
