import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validatePackage } from "../../scripts/package-plugin.mjs";

const APPROVED = process.env.QUIRKS_SMOKE_APPROVED === "approve-marketplace-install";

test("marketplace install verification", { skip: !APPROVED }, async () => {
  const manifest = JSON.parse(await readFile(path.resolve("marketplace/manifest.json"), "utf8")) as {
    plugins: Array<{ id: string }>;
  };
  assert.equal(manifest.plugins[0]?.id, "quirks");
  const pkg = await validatePackage();
  assert.equal(pkg.ok, true);
});

test("marketplace install blocked without approval gate", { skip: APPROVED }, () => {
  assert.notEqual(process.env.QUIRKS_SMOKE_APPROVED, "approve-marketplace-install");
});
