import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// Compiled tests run from `dist/test/visual-references`, so the repository root
// is three levels up — the same convention `test/skills/harness.ts` uses.
const ROOT = path.resolve(import.meta.dirname, "../../..");
const MANIFEST_PATH = "docs/visual-references/quirks-ui/manifest.json";

interface ManifestEntry {
  id: string;
  path: string;
  format: string;
  availability: string;
  governs: readonly string[];
  planTasks: readonly number[];
  viewports: readonly string[];
  verification: string;
}

async function readManifest(): Promise<{ schemaVersion: number; protocol: string; references: ManifestEntry[] }> {
  return JSON.parse(await readFile(path.join(ROOT, MANIFEST_PATH), "utf8"));
}

test("catalogs the three approved Quirks UI references with governed decisions", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.protocol, "quirks-ui-visual-references-v1");
  assert.deepEqual(manifest.references.map((entry) => entry.id), [
    "approval-workspace-v3",
    "tasks-and-campaign-history-v4",
    "task-provenance-history-v5",
  ]);
  for (const entry of manifest.references) {
    assert.match(entry.path, /^docs\/visual-references\/quirks-ui\/[a-z0-9-]+\.html$/);
    assert.ok(entry.governs.length > 0, `${entry.id} must name at least one governed decision`);
    assert.ok(entry.planTasks.length > 0, `${entry.id} must name at least one consuming plan task`);
    assert.deepEqual(entry.viewports, ["1280x800", "390x844"]);
    await access(path.join(ROOT, entry.path));
  }
});

test("declares tracked availability and a fidelity-bearing verification method", async () => {
  const manifest = await readManifest();
  for (const entry of manifest.references) {
    assert.equal(entry.availability, "tracked", `${entry.id} is preserved in the repository`);
    assert.equal(entry.format, "interactive-html");
    assert.equal(entry.verification, "structural-and-screenshot");
    assert.ok(
      entry.path.endsWith(`${entry.id}.html`),
      `${entry.id} must resolve to a path named after its stable id`,
    );
  }
});

test("preserved artifacts are self-contained with no remote dependency or personal data", async () => {
  const manifest = await readManifest();
  for (const entry of manifest.references) {
    const markup = await readFile(path.join(ROOT, entry.path), "utf8");
    assert.doesNotMatch(markup, /https?:\/\//i, `${entry.id} must not reference remote resources`);
    assert.doesNotMatch(markup, /bearer |api[_-]?key|password/i, `${entry.id} must not embed secret-shaped strings`);
    assert.doesNotMatch(markup, /[\w.+-]+@[\w-]+\.[\w.]+/, `${entry.id} must not embed personal email addresses`);
  }
});
