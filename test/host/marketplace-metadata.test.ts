import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const manifestPath = path.resolve("marketplace/manifest.json");
const CREDENTIAL_PATTERN = /(?:api[_-]?key|secret|password|bearer)\s*[=:]\s*\S+/i;
const HOME_PATH_PATTERN = /(?:\/Users\/|\/home\/)[^/\s]+/;

test("marketplace manifest has bounded fields and no credential-shaped strings", async () => {
  const raw = await readFile(manifestPath, "utf8");
  assert.equal(CREDENTIAL_PATTERN.test(raw), false);
  assert.equal(HOME_PATH_PATTERN.test(raw), false);
  const manifest = JSON.parse(raw) as {
    schemaVersion: number;
    protocol: string;
    plugins: Array<{ id: string; hosts: string[]; skillsPath: string }>;
  };
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.protocol, "quirks-marketplace-v1");
  assert.equal(manifest.plugins.length, 1);
  assert.equal(manifest.plugins[0]?.id, "quirks");
  assert.deepEqual(manifest.plugins[0]?.hosts.toSorted(), ["claude", "codex", "cursor"]);
  assert.equal(manifest.plugins[0]?.skillsPath, "skills");
});
