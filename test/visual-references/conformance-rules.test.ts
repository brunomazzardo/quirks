import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// Compiled tests run from `dist/test/visual-references`, so the repository root
// is three levels up — the same convention `test/visual-references/manifest.test.ts` uses.
const ROOT = path.resolve(import.meta.dirname, "../../..");
const RULES_PATH = "test/ui/fixtures/visual-conformance-rules.json";
const MANIFEST_PATH = "docs/visual-references/quirks-ui/manifest.json";

interface ConformanceSurface {
  id: string;
  route: string;
  /** Manifest reference id, or null for surfaces with no governing wireframe. */
  reference: string | null;
  state: string;
  rules: readonly string[];
}

interface AcceptedDivergence {
  id: string;
  summary: string;
  pointer: string;
}

interface ConformanceRules {
  schemaVersion: number;
  protocol: string;
  theme: string;
  animations: string;
  /** Platform the committed screenshot baselines were captured on. */
  baselinePlatform: string;
  baselineDirectory: string;
  maxDiffPixelRatio: number;
  determinism: readonly string[];
  viewports: Record<string, { width: number; height: number }>;
  surfaces: readonly ConformanceSurface[];
  /** Handoff §6.A: prompt/copy surfaces are context-only, never screenshot-gated. */
  promptSurfaces: string;
  acceptedDivergences: readonly AcceptedDivergence[];
}

async function readRules(): Promise<ConformanceRules> {
  return JSON.parse(await readFile(path.join(ROOT, RULES_PATH), "utf8"));
}

async function readManifestIds(): Promise<Set<string>> {
  const manifest = JSON.parse(await readFile(path.join(ROOT, MANIFEST_PATH), "utf8")) as {
    references: { id: string }[];
  };
  return new Set(manifest.references.map((entry) => entry.id));
}

test("defines exact reproduction rules for the five shipped views", async () => {
  const rules = await readRules();
  assert.equal(rules.schemaVersion, 1);
  assert.equal(rules.protocol, "quirks-ui-visual-conformance-v1");
  assert.equal(rules.theme, "light");
  assert.equal(rules.animations, "disabled");
  assert.deepEqual(rules.viewports, {
    desktop: { width: 1280, height: 800 },
    compact: { width: 390, height: 844 },
  });
  assert.deepEqual(
    rules.surfaces.map((surface) => surface.id),
    ["preflight", "tasks", "campaigns", "campaign-detail", "task-history"],
  );
  for (const surface of rules.surfaces) {
    assert.ok(surface.route.startsWith("/"), `${surface.id} names its route`);
    assert.ok(surface.rules.length > 0, `${surface.id} names at least one governed rule`);
    assert.ok(surface.state.length > 0, `${surface.id} names its fixture state`);
  }
});

test("binds every governed surface to a manifest reference and leaves ungoverned surfaces honest", async () => {
  const rules = await readRules();
  const manifestIds = await readManifestIds();
  const byId = new Map(rules.surfaces.map((surface) => [surface.id, surface]));
  assert.equal(byId.get("preflight")?.reference, "approval-workspace-v3");
  assert.equal(byId.get("tasks")?.reference, "tasks-and-campaign-history-v4");
  assert.equal(byId.get("campaigns")?.reference, "tasks-and-campaign-history-v4");
  assert.equal(byId.get("task-history")?.reference, "task-provenance-history-v5");
  // Handoff §6.B: campaign detail has no governing wireframe — primitives only.
  assert.equal(byId.get("campaign-detail")?.reference, null);
  for (const surface of rules.surfaces) {
    if (surface.reference !== null) {
      assert.ok(manifestIds.has(surface.reference), `${surface.id} references a cataloged manifest id`);
    }
  }
});

test("records prompt surfaces as context-only per the §6.A amendment", async () => {
  const rules = await readRules();
  assert.equal(rules.promptSurfaces, "context-only");
});

test("lists the accepted divergences with resolvable decision pointers", async () => {
  const rules = await readRules();
  const ids = rules.acceptedDivergences.map((divergence) => divergence.id);
  for (const required of [
    "preflight-topbar-identity",
    "compact-nav-strategy",
    "runner-health-nav-absent",
    "no-dead-controls",
    "cards-defer-titles-to-table",
    "recorded-stat-not-spend",
    "ink-token-drift",
    "history-stats-not-invented",
  ]) {
    assert.ok(ids.includes(required), `accepted divergence ${required} must be listed`);
  }
  for (const divergence of rules.acceptedDivergences) {
    assert.ok(divergence.summary.length > 0, `${divergence.id} carries a summary`);
    const [pointerPath] = divergence.pointer.split("#");
    assert.ok(pointerPath, `${divergence.id} carries a pointer`);
    await access(path.join(ROOT, pointerPath));
  }
});

test("commits a reviewed screenshot baseline for every surface and viewport", async () => {
  const rules = await readRules();
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  for (const surface of rules.surfaces) {
    for (const viewportName of Object.keys(rules.viewports)) {
      const baseline = path.join(
        ROOT,
        rules.baselineDirectory,
        `${surface.id}-${viewportName}-${rules.baselinePlatform}.png`,
      );
      const header = (await readFile(baseline)).subarray(0, 4);
      assert.ok(
        header.equals(PNG_MAGIC),
        `${surface.id}-${viewportName} baseline must be a PNG captured on ${rules.baselinePlatform}`,
      );
    }
  }
});

test("declares the determinism constraints for reproducible baselines", async () => {
  const rules = await readRules();
  assert.equal(rules.baselinePlatform, "darwin");
  assert.equal(rules.baselineDirectory, "test/visual-references/baselines");
  assert.ok(rules.maxDiffPixelRatio > 0 && rules.maxDiffPixelRatio <= 0.02, "threshold is sane");
  const constraints = rules.determinism.join(" ");
  for (const keyword of ["font", "animation", "viewport", "clock", "fixture"]) {
    assert.match(constraints, new RegExp(keyword, "i"), `determinism constraints mention ${keyword}`);
  }
});
