# Quirks Skills and Git Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap canonical Quirks Agent Skills with test-driven skill authoring, deliver Wave 3 skills and Git worktree/review infrastructure, and foreshadow Wave 4 campaign-parent skills plus merge/push/provenance landing—without weakening the approved security, authority, or portable-campaign boundaries from the control plane and local UI plans.

**Architecture:** Plan 4 of the Quirks v1 suite. Skills contain judgment and workflow policy; dependency-free TypeScript enforces mechanical invariants already shipped in plans 1–3 (`TaskSource`, `quirks-tasks`, `quirks-campaign`, approval binding, runner dispatch, live progress). Wave 3 replaces the interim Superpowers dispatcher dogfood path with canonical `skills/dispatching-external-agents` and task-lifecycle skills, while implementing real `WorktreePort` Git isolation in parallel. Wave 4 authors the parent campaign skills and completes target landing (merge, exact approved push, compact provenance write-back). Host packaging, marketplace install, and the nine-cell smoke matrix belong to plan 5—not this plan.

**Tech Stack:** Node.js 24 LTS (`>=24.18.0`), TypeScript 7.0.2, ESM, pnpm 10.30.3, Node `node:test`, Ajv 8.20.0 plus `ajv-formats` 3.0.1 at build time only, Oxlint 1.74.0, Git argv-only via `execFile` (no shell strings).

## Ordered Plan Suite

| Order | Planned document | Starts after |
|---|---|---|
| 1 | `2026-07-21-quirks-foundation-task-sources.md` | approved design |
| 2 | `2026-07-21-quirks-campaign-control-plane.md` | foundation review (`QK-FND-013`) |
| 3 | `2026-07-21-quirks-local-control-ui.md` | foundation review; may execute alongside plan 2 |
| 4 | `2026-07-21-quirks-skills-git-integration.md` (this plan) | approved control-plane and UI boundaries (`QK-CTL-004`, `QK-UI-004`) |
| 5 | `2026-07-21-quirks-host-integration-acceptance.md` | approved UI, skills, Git, and runner boundaries |

### Inventory mapping

| Task inventory ID | Plan tasks | Wave |
|---|---|---|
| `QK-SKL-002` | Tasks 1–2 | 3 |
| `QK-SKL-005A` | Task 3 | 3 |
| `QK-SKL-005B` | Task 4 | 3 |
| `QK-SKL-005C` | Task 5 | 3 |
| `QK-GIT-001A` | Task 6 | 3 |
| `QK-GIT-001B` | Task 7 | 3 |
| `QK-SKL-003` | Foreshadow Task 8 | 4 |
| `QK-SKL-004` | Foreshadow Task 9 | 4 |
| `QK-GIT-002A` | Foreshadow Task 10 | 4 |
| `QK-GIT-002B` | Foreshadow Task 11 | 4 |

### File structure

```text
.codex-plugin/
  plugin.json
skills/
  dispatching-external-agents/
    SKILL.md
    references/
      claude.md
      codex.md
      cursor.md
  writing-tasks/
    SKILL.md
    references/
  updating-tasks/
    SKILL.md
    references/
  executing-tasks/
    SKILL.md
    references/
references/
  parent-protocol.md
  model-routing.md
  security-boundaries.md
  dogfood.md
  runners/
    claude.md
    codex.md
    cursor.md
scripts/
  validate-skills.mjs
src/git/
  types.ts
  argv.ts
  worktree.ts
  integration-branch.ts
  review-lane.ts
  cleanup.ts
  landing.ts                 # Wave 4 — merge/push only
  provenance-writeback.ts    # Wave 4 — task-source attach only
src/campaign/
  ports.ts                   # extend WorktreePort + LandingPort
  supervisor.ts              # wire real worktree + review lanes (Wave 3)
  git-inspect.ts             # unchanged read-only preflight helper
test/skills/
  structure.test.ts
  harness.ts
  pressure/
    dispatching-external-agents.jsonl
    writing-tasks.jsonl
    updating-tasks.jsonl
    executing-tasks.jsonl
  dispatching-external-agents-baseline.test.ts
  dispatching-external-agents-forward.test.ts
  writing-tasks-baseline.test.ts
  writing-tasks-forward.test.ts
  updating-tasks-baseline.test.ts
  updating-tasks-forward.test.ts
  executing-tasks-baseline.test.ts
  executing-tasks-forward.test.ts
test/git/
  worktree.test.ts
  integration-branch.test.ts
  review-lane.test.ts
  cleanup.test.ts
  support/git-fixture.ts
test/integration/
  skills-git-wave3.test.ts
```

## Global Constraints

- Runtime control-plane and Git modules have zero third-party production dependencies; skill prose is validated by repository scripts and deterministic tests, not by a runtime package.
- Build on the frozen kernel and shipped control plane. Do not reimplement task-source storage, envelope hashing, approval binding, runner argv builders, or UI security.
- Skills delegate mechanical work to `quirks-tasks` and `quirks-campaign` CLIs with `--json`. Skills never open `.quirks/tasks.json`, campaign journals, or runner profiles directly.
- Unknown schema fields, unsupported versions, secret-shaped protocol output, stale revisions, and oversized payloads fail closed.
- The selected task source owns canonical status. Skills surface sync/conflict state and submit only compact provenance candidates; they never mark tasks reviewed, done, merged, or pushed.
- Workers cannot merge, push, broaden scope, change campaign state or budgets, or approve their own work. Git landing remains supervisor/control-plane authority.
- All Git commands are argv arrays via `execFile`. No shell strings, no `git -c`, no force-push, hard reset, broad checkout/revert, or inferred remotes.
- All paths persisted in project or campaign data are repository-relative POSIX paths; reject absolute paths, `..` traversal, NUL bytes, and paths outside the canonical repository.
- Worktrees live under the platform application-state directory keyed by repository identity and campaign ID—not inside the target repository working tree.
- Quirks does not edit its own skills during a live campaign. Plugin learnings become separate tasks with skill TDD.
- Loopback HTML, CSP, browser tests, host harness wiring, marketplace packaging, and real-runner smoke belong to plans 3 and 5—not this plan.
- Every task follows red → green → refactor and ends with a focused commit. Run `pnpm check` before the Wave 3 boundary and again before Wave 4 landing tasks.

### Quirks dogfood: Superpowers dispatcher until skills land

Until this plan's Wave 3 tasks land, interactive Quirks development **dogfoods installed Superpowers** orchestration:

| Phase | Interactive orchestration | Mechanical authority |
|---|---|---|
| Before Task 2 merges | Superpowers `dispatching-external-agents`, `subagent-driven-development`, `executing-plans` | `quirks-tasks`, `quirks-campaign`, schemas, fake runners |
| After Task 2 merges | Canonical `skills/dispatching-external-agents` for runner dispatch judgment | same control plane |
| After Tasks 3–5 merge | Canonical task-lifecycle skills for focused task work | `quirks-tasks` only |
| After Foreshadow Task 9 merges (Wave 4) | Canonical `skills/running-agent-campaigns` for bounded multi-task dogfood | `quirks-campaign` + UI approval |

**Interactive dark boot** (Task 1) means the repository can keep shipping plans 1–3 and Wave 3 slices before every skill exists: bootstrap the canonical `skills/` tree, Codex plugin manifest, structure validator, and pressure-scenario harness while `references/dogfood.md` documents the interim Superpowers dispatcher path and the explicit transition checks to Quirks skills plus `quirks-campaign`.

Transition criteria (all required before retiring Superpowers dispatcher for Quirks repo work):

1. `pnpm check` passes with skill structure validation and the Task 2 forward suite green.
2. `skills/dispatching-external-agents` names `quirks-campaign`/`quirks-watchdog` as the durable parent and forbids host-native subagent ownership.
3. `AGENTS.md` lists the canonical skill allow-list; no project copies skills into target repositories.
4. Wave 4 `running-agent-campaigns` forward tests pass before unattended overnight Quirks self-campaigns.

---

### Task 1: Skill package bootstrap and interactive dark boot (`QK-SKL-002` part 1)

**Owned paths:**
- `.codex-plugin/`
- `references/dogfood.md`, `references/parent-protocol.md`, `references/security-boundaries.md`
- `scripts/validate-skills.mjs`
- `test/skills/structure.test.ts`
- `test/skills/harness.ts`
- `test/skills/pressure/` (skeleton files only)

**Exclusions:**
- Do not author production skill bodies beyond minimal frontmatter stubs required by the structure test.
- Do not wire host install scripts, Claude Code/Cursor symlink installers, or marketplace metadata (plan 5).
- Do not modify `src/campaign/*`, `src/ui/*`, or `src/runner/*`.
- Do not copy Superpowers skills into `skills/`; reference them only from `references/dogfood.md`.

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `references/parent-protocol.md`
- Create: `references/security-boundaries.md`
- Create: `references/dogfood.md`
- Create: `scripts/validate-skills.mjs`
- Create: `test/skills/structure.test.ts`
- Create: `test/skills/harness.ts`
- Create: `test/skills/pressure/.gitkeep`
- Create: `skills/dispatching-external-agents/SKILL.md` (stub frontmatter only)
- Create: `skills/writing-tasks/SKILL.md` (stub)
- Create: `skills/updating-tasks/SKILL.md` (stub)
- Create: `skills/executing-tasks/SKILL.md` (stub)
- Modify: `package.json` (`validate:skills` script)
- Modify: `scripts/run-tests.mjs` (include `test/skills`)

**Interfaces:**
- Consumes: design sections 5, 6, 18, 23.1; approved Agent Skills directory layout.
- Produces: `validateSkills({ root? }): Promise<SkillValidationReport>`, `loadPressureScenarios(skillId): PressureScenario[]`, documented dogfood transition in `references/dogfood.md`.

- [ ] **Step 1: Write the failing structure test**

```ts
// test/skills/structure.test.ts
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
  assert.match(report.plugin.skillsPath, /skills$/);
});

test("dogfood reference names the interim Superpowers dispatcher path", async () => {
  const { readFile } = await import("node:fs/promises");
  const dogfood = await readFile(path.resolve("references/dogfood.md"), "utf8");
  assert.match(dogfood, /dispatching-external-agents/);
  assert.match(dogfood, /quirks-campaign/);
  assert.match(dogfood, /transition/i);
});
```

- [ ] **Step 2: Run structure test and confirm bootstrap is absent**

Run: `node --test test/skills/structure.test.ts`

Expected: FAIL with missing `.codex-plugin/plugin.json` or `references/dogfood.md`.

- [ ] **Step 3: Implement bootstrap layout**

`.codex-plugin/plugin.json`:

```json
{
  "name": "quirks",
  "version": "0.0.0",
  "description": "Portable agent campaigns for repository task orchestration",
  "skills": "./skills"
}
```

`scripts/validate-skills.mjs` checks:

- each `skills/<id>/SKILL.md` exists with YAML frontmatter (`name`, `description`, bounded length);
- no credential-shaped strings, absolute home paths, or project-specific task commands in skill trees;
- `references/` files are relative-path safe;
- `.codex-plugin/plugin.json` `skills` entry resolves.

`references/dogfood.md` documents:

1. interim Superpowers dispatcher usage for Quirks repo interactive work;
2. mechanical authority remains `quirks-tasks` / `quirks-campaign`;
3. transition checklist to canonical skills (see Global Constraints);
4. explicit ban on copying skills into target repositories.

`test/skills/harness.ts` exports `loadPressureScenarios(skillId)` reading JSONL scenario fixtures (prompt, forbidden_actions, required_cli_invocations) for baseline/forward suites in later tasks.

- [ ] **Step 4: Run structure validation**

Run: `pnpm validate:skills && node --test dist/test/skills/structure.test.js`

Expected: PASS for manifest, four stub skills, and dogfood reference.

- [ ] **Step 5: Commit bootstrap**

```bash
git add .codex-plugin references scripts/validate-skills.mjs test/skills skills/dispatching-external-agents/SKILL.md skills/writing-tasks/SKILL.md skills/updating-tasks/SKILL.md skills/executing-tasks/SKILL.md package.json scripts/run-tests.mjs
git commit -m "feat: bootstrap quirks skill package for interactive dark boot"
```

---

### Task 2: `dispatching-external-agents` skill (`QK-SKL-002` part 2)

**Owned paths:**
- `skills/dispatching-external-agents/**`
- `references/runners/**`
- `test/skills/dispatching-external-agents-*.test.ts`
- `test/skills/pressure/dispatching-external-agents.jsonl`

**Exclusions:**
- Do not implement runner argv builders or dispatcher TypeScript (already in `src/runner/*`).
- Do not author `running-agent-campaigns`, `delegated-brainstorming`, or task-lifecycle skills.
- Do not add permission-bypass defaults or personal config paths to references.
- Do not claim host harness owns worker lifecycle.

**Files:**
- Modify: `skills/dispatching-external-agents/SKILL.md`
- Create: `skills/dispatching-external-agents/references/claude.md`
- Create: `skills/dispatching-external-agents/references/codex.md`
- Create: `skills/dispatching-external-agents/references/cursor.md`
- Create: `references/runners/claude.md`
- Create: `references/runners/codex.md`
- Create: `references/runners/cursor.md`
- Create: `test/skills/pressure/dispatching-external-agents.jsonl`
- Create: `test/skills/dispatching-external-agents-baseline.test.ts`
- Create: `test/skills/dispatching-external-agents-forward.test.ts`

**Interfaces:**
- Consumes: design sections 5.2, 11, 16, 23.1; shipped `src/runner/{claude,codex,cursor,dispatcher,watchdog}.ts`.
- Produces: baseline/forward evidence for runner dispatch pressure scenarios; skill text requiring `quirks-campaign`/`quirks-watchdog` parentage.

- [ ] **Step 1: Write failing baseline pressure test**

```ts
// test/skills/dispatching-external-agents-baseline.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario } from "./harness.js";

test("baseline agent violates control-plane parentage without the skill", async () => {
  const result = await evaluatePressureScenario("dispatching-external-agents", "host-subagent-parent");
  assert.equal(result.observedViolation, "host_native_subagent_as_parent");
  assert.equal(result.skillWouldForbid, true);
});
```

- [ ] **Step 2: Run baseline test without authored skill body**

Run: `node --test dist/test/skills/dispatching-external-agents-baseline.test.js`

Expected: FAIL because `skills/dispatching-external-agents/SKILL.md` is still a stub and `pressure/dispatching-external-agents.jsonl` is missing.

- [ ] **Step 3: Author skill and pressure scenarios**

`SKILL.md` must require:

- `quirks-campaign` + `quirks-watchdog` as durable parent (design 16.1, 16.3);
- argv-array dispatch only; never shell briefs;
- session UUID/thread capture before accepting results;
- permission-denied exit-zero classification;
- usage-limit recording without silent tier downgrade;
- on-disk artifact verification before success;
- cross-vendor reviewer preference for judgment-heavy review;
- explicit delegation to versioned runner references, not duplicated flags in the skill body.

`pressure/dispatching-external-agents.jsonl` includes at least:

- `host-subagent-parent`
- `prose-done-without-artifact`
- `permission-exit-zero-trust`
- `usage-limit-tier-downgrade`
- `shell-brief-interpolation`
- `unjournaled-detached-child`

Baseline tests assert each scenario's `observedViolation` without skill loaded. Forward tests assert `skillBlocks` after loading `SKILL.md`.

- [ ] **Step 4: Run baseline and forward suites**

Run: `pnpm validate:skills && node --test dist/test/skills/dispatching-external-agents-baseline.test.js dist/test/skills/dispatching-external-agents-forward.test.js`

Expected: PASS; forward suite blocks every recorded baseline violation.

- [ ] **Step 5: Commit dispatch skill**

```bash
git add skills/dispatching-external-agents references/runners test/skills/dispatching-external-agents-baseline.test.ts test/skills/dispatching-external-agents-forward.test.ts test/skills/pressure/dispatching-external-agents.jsonl
git commit -m "feat: add dispatching-external-agents skill with TDD evidence"
```

---

### Task 3: `writing-tasks` skill (`QK-SKL-005A`)

**Owned paths:**
- `skills/writing-tasks/**`
- `test/skills/writing-tasks-*.test.ts`
- `test/skills/pressure/writing-tasks.jsonl`

**Exclusions:**
- Do not modify `src/task-source/json/*` or JSON schema files.
- Do not open or edit task files directly in skill examples—only `quirks-tasks` commands.
- Do not implement updating or executing flows (Tasks 4–5).

**Files:**
- Modify: `skills/writing-tasks/SKILL.md`
- Create: `skills/writing-tasks/references/workflow-policy.md`
- Create: `test/skills/pressure/writing-tasks.jsonl`
- Create: `test/skills/writing-tasks-baseline.test.ts`
- Create: `test/skills/writing-tasks-forward.test.ts`

**Interfaces:**
- Consumes: design sections 5.4, 7, 8; shipped `quirks-tasks` `validate`/`propose` operations.
- Produces: skill text routing authoring through `quirks-tasks` with dependency and design-gate validation.

- [ ] **Step 1: Write failing baseline test**

```ts
// test/skills/writing-tasks-baseline.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario } from "./harness.js";

test("baseline agent edits JSON task file directly", async () => {
  const result = await evaluatePressureScenario("writing-tasks", "direct-json-edit");
  assert.equal(result.observedViolation, "bypass_task_source");
});
```

- [ ] **Step 2: Run baseline test against stub skill**

Run: `node --test dist/test/skills/writing-tasks-baseline.test.js`

Expected: FAIL with missing pressure fixture or stub skill.

- [ ] **Step 3: Author writing-tasks skill**

`SKILL.md` must:

- invoke `quirks-tasks validate` before proposing tasks;
- use semantic `propose` (when available) or documented CLI path—never raw JSON mutation;
- validate `dependsOn`, design gates, and `workflowPolicy.skills` alignment;
- reject tasks that broaden campaign scope or weaken design-gate defaults;
- submit only compact candidate references for provenance—no spec/plan bodies in task records.

Pressure scenarios: `direct-json-edit`, `skip-design-gate`, `unbounded-scope-creep`, `secret-in-task-prose`.

- [ ] **Step 4: Run writing-tasks baseline and forward suites**

Run: `node --test dist/test/skills/writing-tasks-baseline.test.js dist/test/skills/writing-tasks-forward.test.js`

Expected: PASS.

- [ ] **Step 5: Commit writing-tasks skill**

```bash
git add skills/writing-tasks test/skills/writing-tasks-baseline.test.ts test/skills/writing-tasks-forward.test.ts test/skills/pressure/writing-tasks.jsonl
git commit -m "feat: add writing-tasks skill with task-source-only authoring"
```

---

### Task 4: `updating-tasks` skill (`QK-SKL-005B`)

**Owned paths:**
- `skills/updating-tasks/**`
- `test/skills/updating-tasks-*.test.ts`
- `test/skills/pressure/updating-tasks.jsonl`

**Exclusions:**
- Do not modify sync reconciler internals beyond using public CLI contracts.
- Do not implement claim/complete/landing flows (Task 5 and Wave 4).
- Do not overwrite canonical status on provider conflict.

**Files:**
- Modify: `skills/updating-tasks/SKILL.md`
- Create: `skills/updating-tasks/references/sync-conflicts.md`
- Create: `test/skills/pressure/updating-tasks.jsonl`
- Create: `test/skills/updating-tasks-baseline.test.ts`
- Create: `test/skills/updating-tasks-forward.test.ts`

**Interfaces:**
- Consumes: design sections 7.3, 21; shipped `quirks-tasks sync`, `syncBoundary`, outbox read models.
- Produces: skill text that refreshes canonical state, surfaces `pending_sync`/conflict, and fails closed on stale revisions.

- [ ] **Step 1: Write failing baseline test**

```ts
// test/skills/updating-tasks-baseline.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario } from "./harness.js";

test("baseline agent overwrites canonical status during conflict", async () => {
  const result = await evaluatePressureScenario("updating-tasks", "provider-conflict-overwrite");
  assert.equal(result.observedViolation, "canonical_status_overwrite");
});
```

- [ ] **Step 2: Run baseline test against stub skill**

Run: `node --test dist/test/skills/updating-tasks-baseline.test.js`

Expected: FAIL.

- [ ] **Step 3: Author updating-tasks skill**

`SKILL.md` must require:

- `quirks-tasks sync` or equivalent refresh before native mutation;
- expected native revision on every mutating call;
- honest `pending_sync` reporting;
- pause/block behavior when canonical source disagrees;
- no silent merge of provider metadata.

Pressure scenarios: `provider-conflict-overwrite`, `stale-revision-retry`, `pending-sync-reported-complete`, `duplicate-idempotency-bypass`.

- [ ] **Step 4: Run updating-tasks baseline and forward suites**

Run: `node --test dist/test/skills/updating-tasks-baseline.test.js dist/test/skills/updating-tasks-forward.test.js`

Expected: PASS.

- [ ] **Step 5: Commit updating-tasks skill**

```bash
git add skills/updating-tasks test/skills/updating-tasks-baseline.test.ts test/skills/updating-tasks-forward.test.ts test/skills/pressure/updating-tasks.jsonl
git commit -m "feat: add updating-tasks skill with sync conflict discipline"
```

---

### Task 5: `executing-tasks` skill (`QK-SKL-005C`)

**Owned paths:**
- `skills/executing-tasks/**`
- `test/skills/executing-tasks-*.test.ts`
- `test/skills/pressure/executing-tasks.jsonl`

**Exclusions:**
- Do not implement campaign supervisor or Git landing.
- Do not mark tasks reviewed/done without reproduced evidence and acknowledgement.
- Do not write provenance directly—only validated candidates via CLI.

**Files:**
- Modify: `skills/executing-tasks/SKILL.md`
- Create: `skills/executing-tasks/references/provenance-candidates.md`
- Create: `test/skills/pressure/executing-tasks.jsonl`
- Create: `test/skills/executing-tasks-baseline.test.ts`
- Create: `test/skills/executing-tasks-forward.test.ts`

**Interfaces:**
- Consumes: design sections 8.1, 14; shipped `validateProvenanceCandidate`, `quirks-tasks` `submit-review`/`attach-provenance`/`complete`.
- Produces: focused interactive execution skill with compact provenance discipline.

- [ ] **Step 1: Write failing baseline test**

```ts
// test/skills/executing-tasks-baseline.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePressureScenario } from "./harness.js";

test("baseline agent marks task done from executor summary alone", async () => {
  const result = await evaluatePressureScenario("executing-tasks", "summary-only-complete");
  assert.equal(result.observedViolation, "unverified_completion");
});
```

- [ ] **Step 2: Run baseline test against stub skill**

Run: `node --test dist/test/skills/executing-tasks-baseline.test.js`

Expected: FAIL.

- [ ] **Step 3: Author executing-tasks skill**

`SKILL.md` must require:

- claim only through task-source operations with durable intent;
- reproduced verification commands before `submit-review`;
- `attach-provenance` with validator-approved candidates only;
- `complete` only after acknowledgement and exact commit/artifact evidence;
- respect `completionBoundary` from normalized task metadata;
- live progress via `quirks-campaign progress set` when running inside a campaign job.

Pressure scenarios: `summary-only-complete`, `fabricated-commit-sha`, `path-outside-repository`, `complete-before-sync-ack`.

- [ ] **Step 4: Run executing-tasks baseline and forward suites**

Run: `node --test dist/test/skills/executing-tasks-baseline.test.js dist/test/skills/executing-tasks-forward.test.js`

Expected: PASS.

- [ ] **Step 5: Commit executing-tasks skill**

```bash
git add skills/executing-tasks test/skills/executing-tasks-baseline.test.ts test/skills/executing-tasks-forward.test.ts test/skills/pressure/executing-tasks.jsonl
git commit -m "feat: add executing-tasks skill with provenance validation"
```

---

### Task 6: Isolated worktrees and integration branches (`QK-GIT-001A`)

**Owned paths:**
- `src/git/types.ts`
- `src/git/argv.ts`
- `src/git/worktree.ts`
- `src/git/integration-branch.ts`
- `src/campaign/ports.ts` (extend `WorktreePort` only)
- `test/git/worktree.test.ts`
- `test/git/integration-branch.test.ts`
- `test/git/support/git-fixture.ts`

**Exclusions:**
- Do not implement review dispatch, merge, push, or provenance write-back.
- Do not modify UI routes or approval code.
- Do not place worktrees inside the target repository `.git` directory or working tree.
- Do not use shell `git` strings or allow workers to choose branch names.

**Files:**
- Create: `src/git/types.ts`
- Create: `src/git/argv.ts`
- Create: `src/git/worktree.ts`
- Create: `src/git/integration-branch.ts`
- Modify: `src/campaign/ports.ts`
- Create: `test/git/support/git-fixture.ts`
- Create: `test/git/worktree.test.ts`
- Create: `test/git/integration-branch.test.ts`

**Interfaces:**
- Consumes: `WorktreePort` stub, `inspectGit`, `resolveAppPaths`, campaign envelope `git` block.
- Produces:

```ts
export interface GitWorktreeRecord {
  schemaVersion: 1;
  campaignId: string;
  taskId: string;
  path: string;
  branch: string;
  baseCommit: string;
  createdAt: string;
}

export interface GitWorktreePort extends WorktreePort {
  ensureIntegrationBranch(input: {
    repositoryRoot: string;
    campaignId: string;
    baseCommit: string;
    campaignBranch: string;
  }): Promise<{ branch: string; commit: string }>;
  prepareTaskWorktree(taskId: string, baseCommit: string): Promise<{ path: string; branch: string }>;
}
```

- [ ] **Step 1: Write failing worktree isolation tests**

```ts
// test/git/worktree.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { GitWorktreeManager } from "../../src/git/worktree.js";
import { createGitFixture } from "./support/git-fixture.js";

test("creates one isolated worktree per task under app state", async () => {
  const fixture = await createGitFixture();
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-1",
    campaignBranch: "quirks/cmp-git-1",
    baseCommit: fixture.head,
  });
  const a = await manager.prepareTaskWorktree("QK-1", fixture.head);
  const b = await manager.prepareTaskWorktree("QK-2", fixture.head);
  assert.notEqual(a.path, b.path);
  assert.match(a.branch, /^quirks\/cmp-git-1\/task\/QK-1$/);
  assert.equal(a.path.startsWith(fixture.root), false);
});
```

- [ ] **Step 2: Build and verify git modules are missing**

Run: `pnpm build`

Expected: FAIL with missing `src/git/worktree.ts`.

- [ ] **Step 3: Implement argv-only worktree manager**

`src/git/argv.ts` wraps `execFile("git", ["-C", repo, ...])` with bounded stdout/stderr.

`GitWorktreeManager`:

1. stores records under `<appState>/repositories/<repoId>/campaigns/<campaignId>/worktrees.json`;
2. `ensureIntegrationBranch` creates or validates `campaignBranch` at `baseCommit` in the main clone only;
3. `prepareTaskWorktree` uses `git worktree add` with deterministic `quirks/<campaignId>/task/<taskId>` branch names;
4. rejects dirty unattended bases using `inspectGit`;
5. `listModifiedFiles` uses `git status --porcelain` inside the worktree path;
6. `readCommit` uses `git -C <worktree> rev-parse HEAD`.

- [ ] **Step 4: Run worktree and integration-branch tests**

Run: `node --test dist/test/git/worktree.test.js dist/test/git/integration-branch.test.js`

Expected: PASS for isolation, deterministic branch names, wrong-base rejection, and interruption recovery.

- [ ] **Step 5: Commit worktree control**

```bash
git add src/git src/campaign/ports.ts test/git
git commit -m "feat: add isolated campaign worktrees and integration branches"
```

---

### Task 7: Review lanes and cleanup (`QK-GIT-001B`)

**Owned paths:**
- `src/git/review-lane.ts`
- `src/git/cleanup.ts`
- `src/campaign/supervisor.ts` (wire `GitWorktreePort` for implementer/reviewer paths only)
- `test/git/review-lane.test.ts`
- `test/git/cleanup.test.ts`
- `test/integration/skills-git-wave3.test.ts`

**Exclusions:**
- Do not merge into target branch or push (Wave 4).
- Do not let reviewers share implementer worktrees/sessions.
- Do not delete worktrees with unjournaled modifications.

**Files:**
- Create: `src/git/review-lane.ts`
- Create: `src/git/cleanup.ts`
- Modify: `src/campaign/supervisor.ts`
- Create: `test/git/review-lane.test.ts`
- Create: `test/git/cleanup.test.ts`
- Create: `test/integration/skills-git-wave3.test.ts`

**Interfaces:**
- Consumes: `GitWorktreeManager`, `CampaignSupervisor`, `RunnerPort` fakes.
- Produces: `openReviewLane(input): Promise<ReviewLane>`, `cleanupWorktrees(campaignId, { force? })`, supervisor dispatch using distinct implementer/reviewer worktrees.

- [ ] **Step 1: Write failing review-lane tests**

```ts
// test/git/review-lane.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { openReviewLane } from "../../src/git/review-lane.js";
import { createGitFixture } from "./support/git-fixture.js";

test("review lane uses a fresh worktree and branch", async () => {
  const fixture = await createGitFixture();
  const lane = await openReviewLane({
    manager: fixture.manager,
    taskId: "QK-9",
    candidateCommit: fixture.commitWithChange,
    baseCommit: fixture.head,
  });
  assert.notEqual(lane.worktreePath, fixture.implementerWorktreePath);
  assert.match(lane.branch, /\/review\//);
});
```

- [ ] **Step 2: Run review-lane tests against missing module**

Run: `node --test dist/test/git/review-lane.test.js`

Expected: FAIL with missing `src/git/review-lane.ts`.

- [ ] **Step 3: Implement review lanes and idempotent cleanup**

`openReviewLane` checks out the candidate commit in a fresh worktree; reviewers never reuse implementer paths.

`cleanupWorktrees`:

- removes worktrees only after journal shows terminal job state or explicit operator cancel;
- `git worktree remove --force` argv only after backup record written;
- repeated cleanup is idempotent.

Wire `CampaignSupervisor` to call `GitWorktreePort` for implementer and reviewer dispatches; landing states remain unreachable in Wave 3 tests.

- [ ] **Step 4: Run Wave 3 integration suite**

Run: `pnpm check`

Expected: PASS including `dist/test/integration/skills-git-wave3.test.js` proving:

- skills validate under `pnpm validate:skills`;
- fake-runner dispatch still uses control plane parentage;
- supervisor creates distinct implementer/reviewer worktrees;
- cleanup succeeds after cancelled/finished jobs.

- [ ] **Step 5: Commit review lanes**

```bash
git add src/git/review-lane.ts src/git/cleanup.ts src/campaign/supervisor.ts test/git/review-lane.test.ts test/git/cleanup.test.ts test/integration/skills-git-wave3.test.ts
git commit -m "feat: add review lanes and idempotent worktree cleanup"
```

---

## Wave 4 Foreshadow (do not implement in Wave 3)

The tasks below are scoped, ownership-bounded placeholders for the next wave. They follow the same TDD rhythm but must not start until Wave 3 boundary verification passes and `QK-SKL-003`/`QK-GIT-001B` dependencies are satisfied.

### Foreshadow Task 8: `delegated-brainstorming` (`QK-SKL-003`)

**Owned paths:** `skills/delegated-brainstorming/**`, `test/skills/delegated-brainstorming-*.test.ts`

**Exclusions:** Do not weaken human-guided Superpowers brainstorming; do not allow architect self-review; do not expand decision envelopes at runtime.

**Steps (summary):** baseline pressure for self-review and envelope escape → author skill preserving spec sequence → forward tests for independent reviewer and principal author tiers → commit `feat: add delegated-brainstorming skill`.

**Depends on:** Task 2 (`QK-SKL-002`).

---

### Foreshadow Task 9: `running-agent-campaigns` (`QK-SKL-004`)

**Owned paths:** `skills/running-agent-campaigns/**`, `references/model-routing.md`, `test/skills/running-agent-campaigns-*.test.ts`

**Exclusions:** Do not bypass `quirks-campaign` approval; do not implement task scope; do not host-render HTML as state.

**Steps (summary):** baseline pressure for skipping approval and scope expansion → author parent skill calling `quirks-campaign preflight|ui open|start|status` → forward tests for external-routing prompt, recovery attach, exact envelope → commit `feat: add running-agent-campaigns skill`.

**Depends on:** Foreshadow Task 8, Tasks 3–5 (`QK-SKL-005A/B/C`), `QK-UI-004`.

**Dogfood terminus:** once forward tests pass, Quirks repo overnight work uses this skill instead of Superpowers dispatcher.

---

### Foreshadow Task 10: Merge and exact approved push (`QK-GIT-002A`)

**Owned paths:** `src/git/landing.ts`, `src/campaign/ports.ts` (`LandingPort`), `test/git/landing.test.ts`, `test/git/push-authorization.test.ts`

**Exclusions:** No force-push; no push without envelope `git.push.enabled` plus exact remote/branch; no worker push paths.

**Steps (summary):** failing tests for wrong remote/branch/dirty-target/pre-push-verification → implement serialized campaign-branch merge to target with target-freshness re-read → bare-remote fixtures → commit `feat: add envelope-bound merge and push`.

**Depends on:** Task 7 (`QK-GIT-001B`), Foreshadow Task 9.

---

### Foreshadow Task 11: Provenance write-back (`QK-GIT-002B`)

**Owned paths:** `src/git/provenance-writeback.ts`, `test/git/provenance-writeback.test.ts`, `test/integration/landing-provenance.test.ts`

**Exclusions:** Do not copy specs/plans/logs into task records; do not complete tasks before sync acknowledgement.

**Steps (summary):** failing tests for invalid candidates and premature complete → implement `attach-provenance` + `complete` sequencing after landing evidence → integration test with JSON driver → commit `feat: add landing provenance write-back`.

**Depends on:** Foreshadow Task 10.

---

## Wave 3 Plan Boundary Verification

- [ ] Run `pnpm check` and record exit code in task provenance.
- [ ] Run `pnpm validate:skills` and confirm all four Wave 3 skills pass structure validation.
- [ ] Run every `test/skills/*-baseline.test.js` and `*-forward.test.js` pair shipped in Tasks 2–5.
- [ ] Confirm `references/dogfood.md` still documents the Superpowers→Quirks transition and lists retirement criteria.
- [ ] Run `dist/test/git/worktree.test.js`, `review-lane.test.js`, `cleanup.test.js`, and `dist/test/integration/skills-git-wave3.test.js`.
- [ ] Confirm no Wave 3 diff touches `src/ui/*`, host install manifests, `landing.ts`, `provenance-writeback.ts`, or parent campaign skills.
- [ ] Search new files for credentials, absolute personal paths, shell command strings, `TODO`, `TBD`, and `FIXME`.
- [ ] Request independent review against design sections 5, 9.1, 10, 14, 15, 18, 20, and 23.1 before starting Wave 4 foreshadow tasks.

## Wave 4 Entry Checklist (foreshadow only)

- [ ] `QK-SKL-003` delegated design skill forward tests green.
- [ ] `QK-SKL-004` parent skill forward tests green with UI approval loop.
- [ ] `QK-GIT-002A` push authorization tests green against bare remote fixtures.
- [ ] `QK-GIT-002B` provenance write-back acknowledged before any `complete` transition.
- [ ] `QK-AUTONOMY-REV` autonomy boundary review recorded before `QK-HOST-001` plan work.
