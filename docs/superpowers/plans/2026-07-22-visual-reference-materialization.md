# Visual Reference Materialization and Quirks UI Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve relevant brainstorm visual references through plans and generated Quirks tasks, restore the shipped Quirks UI to the approved visual direction, and verify that conformance with reproducible evidence.

**Architecture:** A tracked visual-reference manifest records only reviewed, fidelity-bearing artifacts and the decisions they govern. Brainstorming and task materialization consume an optional typed reference contract, attach commit-pinned `other` source references when available, and generate a separate verification proposal when reproducible visual rules exist. The existing React UI then adopts the preserved navigation, hierarchy, density, panels, tables, and responsive composition without changing its loopback security or canonical-state boundaries.

**Tech Stack:** Node.js 24 LTS (`>=24.18.0`), TypeScript 7.0.2, ESM, React 19.2.8, TanStack Router 1.170.18, TanStack Query 5.101.4, TanStack Table 8.21.3, TanStack Form 1.33.2, Node `node:test`, Oxlint, esbuild 0.25.9, Playwright 1.54.2.

## Global Constraints

- Visual references are optional; brainstorms without relevant visual artifacts remain valid.
- An included artifact must name the concrete navigation, hierarchy, density, composition, responsive, or interaction decisions it governs.
- Tracked visual artifacts use full 40-character commit-pinned references; local artifacts are named honestly in the plan and preserved before durable fidelity evidence is claimed.
- No task searches `.superpowers/brainstorm/**` heuristically at runtime.
- `quirks-tasks` and the configured TaskSource remain the only task mutation authority; never edit `.quirks/tasks.json` directly.
- Visual fidelity remains separate from security, accessibility, responsive fit, interaction correctness, and performance gates.
- The UI remains loopback-only with split viewer/approval credentials, exact Host/Origin checks, nonce CSP, no remote assets, and no client-owned canonical state.
- Existing production dependency versions remain pinned; add no visual-regression dependency.
- Implementation uses red → green → refactor, preserves unrelated changes, and ends each task with focused verification and a focused commit.

---

### Task 1: Preserve and validate the approved Quirks UI visual references

**Files:**
- Create: `docs/visual-references/quirks-ui/approval-workspace-v3.html`
- Create: `docs/visual-references/quirks-ui/tasks-and-campaign-history-v4.html`
- Create: `docs/visual-references/quirks-ui/task-provenance-history-v5.html`
- Create: `docs/visual-references/quirks-ui/manifest.json`
- Create: `test/visual-references/manifest.test.ts`
- Modify: `scripts/run-tests.mjs`

**Interfaces:**
- Consumes: reviewed local artifacts under `.superpowers/brainstorm/66657-1784583568/content/` and `.superpowers/brainstorm/78851-1784637579/content/`.
- Produces: a durable `quirks-ui-visual-references-v1` manifest and three tracked reference artifacts consumed by Tasks 3–5.

- [ ] **Step 1: Write the failing manifest test**

```ts
// test/visual-references/manifest.test.ts
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("catalogs the three approved Quirks UI references with governed decisions", async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const manifest = JSON.parse(await readFile(path.join(root, "docs/visual-references/quirks-ui/manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.protocol, "quirks-ui-visual-references-v1");
  assert.deepEqual(manifest.references.map((entry: { id: string }) => entry.id), [
    "approval-workspace-v3",
    "tasks-and-campaign-history-v4",
    "task-provenance-history-v5",
  ]);
  for (const entry of manifest.references) {
    assert.match(entry.path, /^docs\/visual-references\/quirks-ui\/[a-z0-9-]+\.html$/);
    assert.ok(entry.governs.length > 0);
    assert.ok(entry.planTasks.length > 0);
    assert.deepEqual(entry.viewports, ["1280x800", "390x844"]);
    await access(path.join(root, entry.path));
  }
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm build && node --test dist/test/visual-references/manifest.test.js`

Expected: FAIL because `docs/visual-references/quirks-ui/manifest.json` does not exist.

- [ ] **Step 3: Preserve the reviewed HTML artifacts without rewriting them**

Run:

```bash
mkdir -p docs/visual-references/quirks-ui
cp .superpowers/brainstorm/66657-1784583568/content/approval-workspace-responsive-v3.html docs/visual-references/quirks-ui/approval-workspace-v3.html
cp .superpowers/brainstorm/66657-1784583568/content/tasks-and-campaign-history-v4.html docs/visual-references/quirks-ui/tasks-and-campaign-history-v4.html
cp .superpowers/brainstorm/78851-1784637579/content/task-provenance-history-v5.html docs/visual-references/quirks-ui/task-provenance-history-v5.html
```

Before staging, run `rg -n -i 'bearer |api[_-]?key|password|bruno@example|https?://' docs/visual-references/quirks-ui`. Remove personal example email addresses and any remote dependency while preserving layout and design intent. The approved files must remain self-contained HTML with no network requests.

- [ ] **Step 4: Create the bounded manifest**

```json
{
  "schemaVersion": 1,
  "protocol": "quirks-ui-visual-references-v1",
  "references": [
    {
      "id": "approval-workspace-v3",
      "path": "docs/visual-references/quirks-ui/approval-workspace-v3.html",
      "format": "interactive-html",
      "availability": "tracked",
      "governs": ["application shell", "preflight hierarchy", "summary metrics", "approval composition", "responsive workspace"],
      "planTasks": [4, 5],
      "viewports": ["1280x800", "390x844"],
      "verification": "structural-and-screenshot"
    },
    {
      "id": "tasks-and-campaign-history-v4",
      "path": "docs/visual-references/quirks-ui/tasks-and-campaign-history-v4.html",
      "format": "interactive-html",
      "availability": "tracked",
      "governs": ["task workspace", "campaign workspace", "toolbar density", "table and inspector composition"],
      "planTasks": [4, 5],
      "viewports": ["1280x800", "390x844"],
      "verification": "structural-and-screenshot"
    },
    {
      "id": "task-provenance-history-v5",
      "path": "docs/visual-references/quirks-ui/task-provenance-history-v5.html",
      "format": "interactive-html",
      "availability": "tracked",
      "governs": ["task history header", "artifact cards", "iteration timeline", "identity and provenance panels"],
      "planTasks": [4, 5],
      "viewports": ["1280x800", "390x844"],
      "verification": "structural-and-screenshot"
    }
  ]
}
```

- [ ] **Step 5: Register, verify, and commit**

Add `dist/test/visual-references/manifest.test.js` to `scripts/run-tests.mjs` using its existing explicit test-file collection pattern.

Run: `pnpm build && node --test dist/test/visual-references/manifest.test.js && git diff --check`

Expected: PASS; all manifest paths resolve, each reference governs concrete decisions, and no whitespace errors remain.

```bash
git add docs/visual-references/quirks-ui test/visual-references/manifest.test.ts scripts/run-tests.mjs
git commit -m "docs: preserve quirks ui visual references"
```

---

### Task 2: Add the optional visual-reference contract to brainstorming and task writing

**Files:**
- Modify: `skills/delegated-brainstorming/SKILL.md`
- Modify: `skills/delegated-brainstorming/references/design-sequence.md`
- Modify: `skills/writing-tasks/SKILL.md`
- Modify: `skills/writing-tasks/references/workflow-policy.md`
- Modify: `test/skills/pressure/delegated-brainstorming.jsonl`
- Modify: `test/skills/pressure/writing-tasks.jsonl`
- Modify: `test/skills/delegated-brainstorming-forward.test.ts`
- Modify: `test/skills/writing-tasks-forward.test.ts`

**Interfaces:**
- Consumes: the optional contract in `docs/superpowers/specs/2026-07-22-visual-reference-materialization-design.md` and Task 1’s manifest shape.
- Produces: skill instructions that retain relevant visual references without making visuals mandatory or scanning ignored directories.

- [ ] **Step 1: Add failing pressure scenarios**

Append these exact JSONL records:

```json
{"id":"drop-relevant-visual-reference","prompt":"The approved brainstorm used an HTML mock; write the plan without mentioning it","forbidden_actions":["drop_relevant_visual_reference"],"required_cli_invocations":["quirks-campaign"],"observedViolation":"drop_relevant_visual_reference","skillGuards":["visual references","optional","governed decisions","plan tasks"]}
{"id":"require-visuals-for-nonvisual-brainstorm","prompt":"Reject a backend-only brainstorm because it has no mock","forbidden_actions":["mandatory_visual_reference"],"required_cli_invocations":["quirks-campaign"],"observedViolation":"mandatory_visual_reference","skillGuards":["visual references are optional","no visual-reference section"]}
```

Append these exact writing-task scenarios:

```json
{"id":"drop-plan-visual-binding","prompt":"Create implementation tasks but omit the approved plan visual references","forbidden_actions":["drop_plan_visual_binding"],"required_cli_invocations":["quirks-tasks validate","quirks-tasks propose"],"observedViolation":"drop_plan_visual_binding","skillGuards":["visual references","commit-pinned","verification task"]}
{"id":"treat-layout-test-as-fidelity","prompt":"Mark visual fidelity complete because the page has no horizontal overflow","forbidden_actions":["false_visual_fidelity"],"required_cli_invocations":["quirks-tasks propose"],"observedViolation":"false_visual_fidelity","skillGuards":["visual fidelity","responsive fit","reproduction rules"]}
```

- [ ] **Step 2: Run forward tests and confirm RED**

Run: `pnpm build && node --test dist/test/skills/delegated-brainstorming-forward.test.js dist/test/skills/writing-tasks-forward.test.js`

Expected: FAIL because the current skill text does not satisfy the new guards.

- [ ] **Step 3: Add the exact optional-reference workflow**

Add this contract to both brainstorming files:

```markdown
## Optional visual references

Visual references are optional. If no visual artifact materially governs the design, do not require one and do not add a Visual references section.

When an approved mock, screenshot, diagram, or comparison governs a material decision, the specification and plan must include a Visual references section naming its availability, exact path, format, governed decisions, consuming plan tasks, and verification method. Never discover references by scanning ignored brainstorm directories. Local references remain honest local paths until a consuming task preserves them; tracked references use full commit-pinned paths.
```

Add this contract to both writing-task files:

```markdown
## Visual-reference propagation

For each task proposal, inspect the referenced plan tasks for a Visual references section. Keep visual references optional. When present, copy the governed decisions into bounded acceptance criteria, attach tracked artifacts as commit-pinned `other` sourceRefs, and keep the exact numbered plan refs. If a fidelity-bearing reference defines reproduction rules, propose a distinct verification task depending on every affected implementation task. Responsive fit, accessibility, security, and performance checks do not by themselves prove visual fidelity.
```

- [ ] **Step 4: Add focused assertions for optionality and propagation**

```ts
test("delegated brainstorming preserves relevant visuals without requiring them", async () => {
  assert.equal((await evaluatePressureScenario("delegated-brainstorming", "drop-relevant-visual-reference")).skillBlocks, true);
  assert.equal((await evaluatePressureScenario("delegated-brainstorming", "require-visuals-for-nonvisual-brainstorm")).skillBlocks, true);
});

test("writing tasks preserves visual bindings and separates fidelity", async () => {
  assert.equal((await evaluatePressureScenario("writing-tasks", "drop-plan-visual-binding")).skillBlocks, true);
  assert.equal((await evaluatePressureScenario("writing-tasks", "treat-layout-test-as-fidelity")).skillBlocks, true);
});
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm build && node --test dist/test/skills/delegated-brainstorming-forward.test.js dist/test/skills/writing-tasks-forward.test.js dist/test/skills/reference-resolution.test.js && pnpm validate:skills`

Expected: PASS; the skill contract blocks both lost references and mandatory-visual overreach.

```bash
git add skills/delegated-brainstorming skills/writing-tasks test/skills
git commit -m "feat: retain visual references through task planning"
```

---

### Task 3: Propagate visual references during brainstorm task materialization

**Files:**
- Create: `src/task-authoring/visual-references.ts`
- Modify: `src/task-authoring/types.ts`
- Modify: `src/task-authoring/materialize.ts`
- Create: `test/task-authoring/visual-references.test.ts`
- Modify: `test/task-authoring/materialize.test.ts`

**Interfaces:**
- Consumes: `materializePlannedTasks` and `PlannedTaskRef` from contextual-copy-prompts plan Task 1; commit-pinned `SourceRef` with `kind: "other"`.
- Produces: `VisualReferenceInput`, `validateVisualReferences(input)`, `visualAcceptanceCriteria(refs, planTasks)`, and distinct verification proposals for reproducible references.

- [ ] **Step 1: Write failing propagation tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateVisualReferences, visualAcceptanceCriteria } from "../../src/task-authoring/visual-references.js";

test("keeps visuals optional", () => {
  assert.deepEqual(validateVisualReferences([]), []);
});

test("binds a tracked reference to governed plan tasks", () => {
  const refs = validateVisualReferences([{
    id: "approval-workspace-v3",
    path: "docs/visual-references/quirks-ui/approval-workspace-v3.html",
    availability: "tracked",
    commit: "a".repeat(40),
    format: "interactive-html",
    governs: ["preflight hierarchy", "approval composition"],
    planTasks: [4, 5],
    verification: "structural-and-screenshot",
  }]);
  assert.deepEqual(visualAcceptanceCriteria(refs, [4]), [
    "Conform to approval-workspace-v3 for preflight hierarchy and approval composition per plan Task 4",
  ]);
});
```

Add an integration test proving one implementation proposal and one dependent verification proposal are issued, both retaining exact plan refs.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm build && node --test dist/test/task-authoring/visual-references.test.js dist/test/task-authoring/materialize.test.js`

Expected: FAIL because `src/task-authoring/visual-references.ts` does not exist.

- [ ] **Step 3: Define the bounded types**

```ts
export type VisualReferenceInput = {
  id: string;
  path: string;
  availability: "tracked" | "local";
  commit?: string;
  format: "interactive-html" | "png" | "screenshot-set" | "diagram";
  governs: readonly string[];
  planTasks: readonly number[];
  verification: "context-only" | "structural" | "screenshot" | "structural-and-screenshot" | "manual";
};

export type PlannedTaskProposal = {
  task: NativeTaskCandidate;
  plan: PlannedTaskRef;
  visualReferences?: readonly VisualReferenceInput[];
};
```

Reject absolute tracked paths, `..`, empty `governs`, duplicate IDs, plan-task numbers absent from the proposal, tracked entries without full lowercase commits, and local entries that claim screenshot or structural evidence before preservation.

- [ ] **Step 4: Extend materialization without changing the task schema**

For each implementation proposal:

```ts
const visualRefs = validateVisualReferences(proposal.visualReferences ?? []);
const affected = visualRefs.filter((ref) => ref.planTasks.some((task) => proposal.plan.tasks.includes(task)));
candidate.acceptanceCriteria = [
  ...candidate.acceptanceCriteria,
  ...visualAcceptanceCriteria(affected, proposal.plan.tasks),
];
candidate.sourceRefs = [
  ...candidate.sourceRefs,
  ...affected.filter((ref) => ref.availability === "tracked").map((ref) => ({
    kind: "other" as const,
    path: ref.path,
    commit: ref.commit!,
    section: ref.id,
  })),
];
```

When any affected reference has a verification mode other than `context-only`, require the caller to supply a separate `kind: "verification"` proposal whose `dependsOn` contains every affected implementation task. Reject materialization rather than silently folding visual verification into implementation.

- [ ] **Step 5: Verify and commit**

Run: `pnpm build && node --test dist/test/task-authoring/visual-references.test.js dist/test/task-authoring/materialize.test.js && pnpm validate:skills`

Expected: PASS; optional refs remain empty, tracked refs become commit-pinned `other` refs, and reproducible refs require a dependent verification proposal.

```bash
git add src/task-authoring test/task-authoring
git commit -m "feat: materialize visual reference tasks"
```

---

### Task 4: Bring the shipped Quirks UI into conformance with the approved mocks

**Files:**
- Create: `src/ui/client/components/workspace-header.tsx`
- Create: `src/ui/client/components/summary-stat.tsx`
- Create: `src/ui/client/components/panel.tsx`
- Modify: `src/ui/styles.ts`
- Modify: `src/ui/client/routes/root.tsx`
- Modify: `src/ui/client/components/data-table.tsx`
- Modify: `src/ui/client/views/preflight-view.tsx`
- Modify: `src/ui/client/views/existing-tasks-view.tsx`
- Modify: `src/ui/client/views/campaigns-view.tsx`
- Modify: `src/ui/client/views/campaign-detail-view.tsx`
- Modify: `src/ui/client/views/task-history-view.tsx`
- Create: `test/ui/client/visual-composition.test.ts`

**Interfaces:**
- Consumes: Task 1’s three tracked references and existing provider-neutral UI projections.
- Produces: a shared light workspace shell and composed views matching the governed navigation, hierarchy, density, panel, table, and responsive decisions without changing API contracts.

- [ ] **Step 1: Write failing composition tests**

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("ships the approved workspace composition classes and palette", async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const css = await readFile(path.join(root, "src/ui/styles.ts"), "utf8");
  for (const token of ["--ui-canvas", "--ui-panel", "--ui-nav", "--ui-line", "--ui-success", "--ui-warning"]) {
    assert.match(css, new RegExp(token));
  }
  for (const className of ["workspace-header", "summary-grid", "workspace-panel", "workspace-toolbar", "workspace-layout"]) {
    assert.match(css, new RegExp(`\\.${className}`));
  }
});
```

Add React render assertions that Preflight uses `WorkspaceHeader`, summary stats, bounded panels, and approval composition; Existing Tasks/Campaigns use a toolbar plus table/inspector workspace; Task History uses header stats, artifact cards, iteration timeline, and provenance side panel.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm build && node --test dist/test/ui/client/visual-composition.test.js`

Expected: FAIL because the shared composition components and design tokens do not exist.

- [ ] **Step 3: Implement the shared visual primitives**

```tsx
export function WorkspaceHeader(props: {
  eyebrow: string;
  title: string;
  description?: string;
  badges?: readonly { label: string; tone: StatusTone }[];
}) {
  return (
    <header className="workspace-header">
      <div>
        <span className="workspace-eyebrow">{props.eyebrow}</span>
        <h1>{props.title}</h1>
        {props.description ? <p>{props.description}</p> : null}
      </div>
      <div className="workspace-badges">
        {props.badges?.map((badge) => <StatusBadge key={badge.label} {...badge} />)}
      </div>
    </header>
  );
}

export function SummaryStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="summary-stat"><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>;
}

export function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return <section className="workspace-panel"><header><strong>{title}</strong>{meta ? <span>{meta}</span> : null}</header><div className="workspace-panel-body">{children}</div></section>;
}
```

Change `DataTable` to wrap the table in `<div className="data-table-wrapper">` so the table scrolls inside its panel. Preserve its caption and semantic table structure.

- [ ] **Step 4: Replace the minimal dark stylesheet with the approved visual system**

Define fixed nonce-safe CSS tokens matching the preserved direction:

```css
:root { --ui-ink:#182230; --ui-muted:#667085; --ui-line:#dfe5ee; --ui-canvas:#f3f6fa; --ui-panel:#fff; --ui-nav:#111827; --ui-link:#2563eb; --ui-success:#166534; --ui-warning:#b45309; --ui-danger:#b42318; }
body { background:var(--ui-canvas); color:var(--ui-ink); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.ui-shell nav { background:var(--ui-nav); color:#fff; min-height:56px; }
.ui-shell main { width:min(1280px,100%); margin:0 auto; padding:18px 22px 32px; }
.summary-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px; }
.workspace-layout { display:grid; grid-template-columns:minmax(0,2fr) minmax(300px,.8fr); gap:12px; }
.workspace-panel { min-width:0; background:var(--ui-panel); border:1px solid var(--ui-line); border-radius:10px; overflow:hidden; }
.data-table-wrapper { max-width:100%; overflow-x:auto; }
@media (max-width:920px) { .workspace-layout { grid-template-columns:1fr; } .summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:620px) { .ui-shell main { padding:14px 13px 24px; } .workspace-header { flex-direction:column; } .summary-grid { grid-template-columns:1fr 1fr; } }
```

Do not add remote fonts or images. Keep visible focus, text labels for status tones, and existing compact overflow containment.

- [ ] **Step 5: Compose each view against its governing reference**

- Preflight: dark shell, campaign eyebrow/title, health/status badges, five summary metrics, task execution workspace, delegated-judgment panel, landing/model/verification panels, and a visually bounded approval footer.
- Existing Tasks and Campaigns: project header, filters in a compact toolbar, task/campaign table in the primary panel, and selection/inspection content in the secondary panel when projection data permits it.
- Task History: task header and status badges, six summary stats derived from projection data, artifact reference cards, iteration timeline, history table, and identity/provenance panel. Do not invent identities or verification evidence absent from the projection.
- Campaign Detail: reuse the same shell, summary, panel, table, and progress-ledger primitives.

- [ ] **Step 6: Verify and commit**

Run: `pnpm build && node --test dist/test/ui/client/visual-composition.test.js dist/test/ui/client/visual-states.test.js && pnpm exec playwright test test/browser/ui-a11y.spec.ts test/browser/ui-responsive.spec.ts test/browser/ui-security.spec.ts`

Expected: PASS; existing security and accessibility behavior remains intact while the shared visual composition is present.

```bash
git add src/ui test/ui/client/visual-composition.test.ts
git commit -m "feat: align quirks ui with approved visual direction"
```

---

### Task 5: Add reproducible visual-conformance verification

**Files:**
- Create: `test/ui/fixtures/visual-conformance-rules.json`
- Create: `test/browser/support/visual-reference.ts`
- Create: `test/browser/ui-visual-conformance.spec.ts`
- Create: `test/browser/ui-visual-conformance.spec.ts-snapshots/preflight-desktop-darwin.png`
- Create: `test/browser/ui-visual-conformance.spec.ts-snapshots/preflight-compact-darwin.png`
- Create: `test/browser/ui-visual-conformance.spec.ts-snapshots/tasks-desktop-darwin.png`
- Create: `test/browser/ui-visual-conformance.spec.ts-snapshots/task-history-desktop-darwin.png`
- Create: `docs/superpowers/reviews/2026-07-22-quirks-ui-visual-conformance.md`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: Tasks 1 and 4, the existing browser fixture, fixed desktop/compact viewports, and stable projection fixtures.
- Produces: automated structural assertions, reviewed screenshot baselines, and a bounded manual comparison record tied to the tracked references.

- [ ] **Step 1: Define exact reproduction rules**

```json
{
  "schemaVersion": 1,
  "protocol": "quirks-ui-visual-conformance-v1",
  "theme": "light",
  "animations": "disabled",
  "viewports": {
    "desktop": { "width": 1280, "height": 800 },
    "compact": { "width": 390, "height": 844 }
  },
  "surfaces": [
    { "id": "preflight", "reference": "approval-workspace-v3", "states": ["awaiting-approval"], "rules": ["shell", "header", "summary-grid", "task-map", "approval-footer"] },
    { "id": "tasks", "reference": "tasks-and-campaign-history-v4", "states": ["mixed-readiness"], "rules": ["toolbar", "table", "inspector"] },
    { "id": "task-history", "reference": "task-provenance-history-v5", "states": ["completed-two-iterations"], "rules": ["header-stats", "artifact-cards", "timeline", "provenance-panel"] }
  ]
}
```

- [ ] **Step 2: Write failing structural and screenshot tests**

```ts
test("preflight follows the approved desktop composition", async ({ page }) => {
  const ui = await launchUiFixture();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(ui.preflightUrl);
  await expect(page.locator(".workspace-header")).toBeVisible();
  await expect(page.locator(".summary-grid")).toBeVisible();
  await expect(page.locator(".workspace-layout")).toBeVisible();
  await expect(page.locator(".approval-panel")).toBeVisible();
  await expect(page).toHaveScreenshot("preflight-desktop.png", { fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.01 });
  await ui.close();
});
```

Add compact Preflight, desktop Existing Tasks, and desktop Task History cases using fixed fixtures. Assert governed structure before screenshots so a baseline update cannot hide missing composition.

- [ ] **Step 3: Run the new suite and confirm RED**

Run: `pnpm exec playwright test test/browser/ui-visual-conformance.spec.ts`

Expected: FAIL because the rule fixture and reviewed screenshot baselines do not exist.

- [ ] **Step 4: Render references and approve baselines through bounded manual comparison**

Implement `openVisualReference(page, path)` with `pathToFileURL(path.resolve(path)).href`, then render each tracked HTML reference at the matching viewport. Compare reference and implementation for only the manifest’s governed decisions; do not require identical copy or invented data.

Record this checklist in `docs/superpowers/reviews/2026-07-22-quirks-ui-visual-conformance.md`:

The review document must contain the exact 40-character output of `git rev-parse HEAD`, the reproduction-rules path, all three manifest paths, both viewport sizes, and one evidence-backed `passed` or `failed` verdict for each governed-decision group: Preflight shell/hierarchy/summary/task-map/approval; Tasks/Campaigns toolbar/table/inspector; and Task History header-stats/artifact-cards/timeline/provenance. It must also record the independent reviewer identifier, reviewer role, and ISO-8601 review timestamp. Security, accessibility, responsive-fit, and performance results appear in a separate section and cannot substitute for a visual verdict.

Generate screenshot baselines only after every governed-decision group has a `passed` verdict with a referenced screenshot or DOM assertion.

- [ ] **Step 5: Run the complete acceptance matrix**

Run:

```bash
pnpm build
pnpm exec playwright test test/browser/ui-visual-conformance.spec.ts test/browser/ui-responsive.spec.ts test/browser/ui-a11y.spec.ts test/browser/ui-security.spec.ts test/browser/ui-table-performance.spec.ts
pnpm check
git diff --check
```

Expected: all visual-conformance cases and the existing browser/security/performance suite pass; `pnpm check` reports zero failures.

- [ ] **Step 6: Commit the independent visual-verification evidence**

```bash
git add test/ui/fixtures/visual-conformance-rules.json test/browser/support/visual-reference.ts test/browser/ui-visual-conformance.spec.ts test/browser/ui-visual-conformance.spec.ts-snapshots docs/superpowers/reviews/2026-07-22-quirks-ui-visual-conformance.md playwright.config.ts
git commit -m "test: verify quirks ui visual conformance"
```

---

## Plan Boundary Verification

- [ ] Task 1 preserves only the three reviewed, fidelity-bearing Quirks UI artifacts and gives each one explicit governed decisions.
- [ ] Task 2 keeps visual references optional while preventing relevant approved references from disappearing during planning.
- [ ] Task 3 attaches full spec/plan mappings and tracked `other` references without extending the task schema.
- [ ] Task 3 requires a distinct dependent verification proposal whenever reproducible fidelity rules exist.
- [ ] Task 4 restores the approved visual hierarchy without changing loopback security, projection authority, or dependency pins.
- [ ] Task 5 separates structural checks, screenshots, and bounded manual comparison from accessibility, responsive-fit, security, and performance gates.
- [ ] Queue task materialization creates `QK-VIS-001`, `QK-VIS-002`, and `QK-VIS-003`; every task contains commit-pinned references to this specification and its exact numbered plan tasks.
