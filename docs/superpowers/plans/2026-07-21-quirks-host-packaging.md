# Quirks Host Packaging and Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the canonical Quirks plugin for Codex, Claude Code, and Cursor hosts; prove portable acceptance with fake runners and fixtures; record dated real host/runner smoke evidence; and complete one bounded real campaign—without weakening loopback UI security, approval binding, task-source authority, or argv-only Git landing from plans 3–4.

**Architecture:** Plan 5 of the Quirks v1 suite. Host harnesses translate natural-language requests into `quirks-campaign` argv operations; they never own worker processes or campaign truth. Installation exposes canonical `skills/` through documented plugin or managed-link mechanisms—never copies into target repositories. Wave 5 packages and wires hosts; Wave 6 proves portable acceptance with deterministic fixtures; Wave 7 records real smoke evidence and one bounded production campaign.

**Tech Stack:** Node.js 24 LTS (`>=24.18.0`), TypeScript 7.0.2, ESM, pnpm 10.30.3, Node `node:test`, Playwright 1.54.2 (dev-only browser tests), Oxlint 1.74.0, fake host/runner fixtures from plans 2–4.

## Ordered Plan Suite

| Order | Planned document | Starts after |
|---|---|---|
| 1 | `2026-07-21-quirks-foundation-task-sources.md` | approved design |
| 2 | `2026-07-21-quirks-campaign-control-plane.md` | foundation review |
| 3 | `2026-07-21-quirks-local-control-ui.md` | foundation review |
| 4 | `2026-07-21-quirks-skills-git-integration.md` | control-plane and UI boundaries |
| 5 | `2026-07-21-quirks-host-packaging.md` (this plan) | Wave 4 skills, Git landing, autonomy review |

### Inventory mapping

| Task inventory ID | Plan tasks | Wave |
|---|---|---|
| `QK-HOST-001` | Plan authoring | 4 |
| `QK-HOST-002A` | Task 1 | 5 |
| `QK-HOST-002B` | Task 2 | 5 |
| `QK-HOST-002C` | Task 3 | 5 |
| `QK-HOST-002D` | Task 4 | 5 |
| `QK-HOST-002E` | Task 5 | 5 |
| `QK-HOST-002F` | Task 6 | 5 |
| `QK-HOST-003A` | Task 7 | 6 |
| `QK-HOST-003B` | Task 8 | 6 |
| `QK-HOST-003C` | Task 9 | 6 |
| `QK-HOST-003D` | Task 10 | 6 |
| `QK-HOST-003E` | Task 11 | 6 |
| `QK-HOST-003F` | Task 12 | 6 |
| `QK-HOST-004A` | Task 13 | 7 |
| `QK-HOST-004B` | Task 14 | 7 |
| `QK-HOST-004C` | Task 15 | 7 |
| `QK-HOST-005A` | Task 16 | 7 |
| `QK-HOST-005B` | Task 17 | 7 |

## Global Constraints

- One canonical Quirks repository; hosts install via plugin/marketplace or managed links—never copy skills into target repositories.
- Host harnesses invoke `quirks-campaign` and `quirks-watchdog`; they do not own worker lifecycle or campaign journals.
- Loopback UI approval, CSP, viewer/approval token separation, and digest binding remain unchanged from plan 3.
- Git landing, merge, and exact approved push remain supervisor authority from plan 4.
- Real smoke tests use disposable scratch repositories only; no destructive permission bypass, production access, or unapproved remote push.
- Smoke records include date, OS, host version, runner CLI version, resolved model/effort, redacted profile ID, outcome, and artifact digest.
- Every task follows red → green → refactor and ends with a focused commit.

---

## Wave 5 — Host packaging and installation (`QK-HOST-002A`–`F`)

### Task 1: Codex plugin manifest and packaging (`QK-HOST-002A`)

**Owned paths:**
- `.codex-plugin/plugin.json`
- `scripts/package-plugin.mjs`
- `test/host/package-validation.test.ts`

**Exclusions:** Do not add marketplace publish credentials; do not bundle personal paths or account identifiers.

**Steps (summary):** failing package validation test → implement manifest validation and deterministic plugin tarball layout → commit `feat: add codex plugin packaging validation`.

---

### Task 2: Claude Code host integration (`QK-HOST-002B`)

**Owned paths:**
- `hosts/claude/**`
- `test/host/claude-install.test.ts`

**Exclusions:** Do not hard-code personal config paths; do not bypass loopback approval.

**Steps (summary):** failing install/discovery test → implement documented Claude plugin/symlink installer with destination validation → commit `feat: add claude code host integration`.

---

### Task 3: Cursor host integration (`QK-HOST-002C`)

**Owned paths:**
- `hosts/cursor/**`
- `test/host/cursor-install.test.ts`

**Exclusions:** Same as Task 2.

**Steps (summary):** failing install/discovery test → implement Cursor managed-link installer → commit `feat: add cursor host integration`.

---

### Task 4: Personal marketplace metadata (`QK-HOST-002D`)

**Owned paths:**
- `marketplace/**`
- `test/host/marketplace-metadata.test.ts`

**Exclusions:** No credential-shaped strings; no auto-overwrite of user files.

**Steps (summary):** failing metadata scan test → author personal marketplace manifest with bounded fields → commit `feat: add personal marketplace metadata`.

---

### Task 5: Canonical host installation references (`QK-HOST-002E`)

**Owned paths:**
- `references/hosts/claude.md`
- `references/hosts/codex.md`
- `references/hosts/cursor.md`
- `skills/running-agent-campaigns/references/host-entrypoints.md`

**Exclusions:** Do not duplicate runner flag tables from `references/runners/*`.

**Steps (summary):** document install/uninstall and host entrypoints for all three hosts → commit `docs: add canonical host installation references`.

---

### Task 6: Cross-host skill discovery verification (`QK-HOST-002F`)

**Owned paths:**
- `test/host/skill-discovery.test.ts`
- `test/integration/host-skill-discovery.test.ts`

**Exclusions:** Do not require live network for CI.

**Steps (summary):** prove all canonical skills discoverable from each packaged host layout in a sandbox → commit `test: add cross-host skill discovery verification`.

---

## Wave 6 — Portable acceptance fixtures (`QK-HOST-003A`–`F`)

### Task 7: Portable JSON task-source end-to-end fixture (`QK-HOST-003A`)

**Owned paths:**
- `test/fixtures/portable/json-repo/**`
- `test/integration/portable-json-campaign.test.ts`

**Depends on:** `QK-HOST-002F`

---

### Task 8: Portable external task-source end-to-end fixture (`QK-HOST-003B`)

**Owned paths:**
- `test/fixtures/portable/external-repo/**`
- `test/fixtures/external-adapter/**` (extend only)
- `test/integration/portable-external-campaign.test.ts`

---

### Task 9: Claude host portable acceptance fixture (`QK-HOST-003C`)

**Owned paths:**
- `test/host/portable/claude/**`
- `test/integration/portable-claude-host.test.ts`

---

### Task 10: Codex host portable acceptance fixture (`QK-HOST-003D`)

**Owned paths:**
- `test/host/portable/codex/**`
- `test/integration/portable-codex-host.test.ts`

---

### Task 11: Cursor host portable acceptance fixture (`QK-HOST-003E`)

**Owned paths:**
- `test/host/portable/cursor/**`
- `test/integration/portable-cursor-host.test.ts`

---

### Task 12: Full portable acceptance verification (`QK-HOST-003F`)

**Owned paths:**
- `test/integration/portable-acceptance.test.ts`

**Verification:** Both fixture repositories complete fake-runner campaigns with identical control-plane boundaries; unapproved push fails; approved push targets only exact fixture remote/branch.

---

## Wave 7 — Real smoke and bounded campaign (`QK-HOST-004`/`005`)

### Task 13: Claude real host and runner smoke cells (`QK-HOST-004A`)

**Owned paths:**
- `docs/smoke/2026-host-matrix.md` (append rows)
- `test/smoke/claude-host-runner.test.ts` (gated; manual approval)

**Human gates:** `approve-paid-runner-probes`

**Exclusions:** No destructive permission bypass; no production access.

---

### Task 14: Codex real host and runner smoke cells (`QK-HOST-004B`)

**Owned paths:**
- `docs/smoke/2026-host-matrix.md` (append rows)
- `test/smoke/codex-host-runner.test.ts`

---

### Task 15: Cursor real host and runner smoke cells (`QK-HOST-004C`)

**Owned paths:**
- `docs/smoke/2026-host-matrix.md` (append rows)
- `test/smoke/cursor-host-runner.test.ts`

**Verification:** All nine cells in design section 16.1 matrix exercised through actual host integrations.

---

### Task 16: Personal marketplace install verification (`QK-HOST-005A`)

**Owned paths:**
- `test/smoke/marketplace-install.test.ts`

**Human gates:** `approve-marketplace-install`

---

### Task 17: One bounded real campaign (`QK-HOST-005B`)

**Owned paths:**
- `docs/smoke/bounded-campaign-report.md`

**Human gates:** `approve-exact-campaign`

**Verification:** Campaign uses `running-agent-campaigns` skill path, loopback approval, fake or approved runners per envelope, and landing provenance write-back from plan 4.

---

## Wave 5–7 Boundary Verification

- [ ] `pnpm validate:skills` passes for all canonical skills including Wave 4 parent skills.
- [ ] Package validation finds no credentials, personal paths, or project-specific task commands in shipped artifacts.
- [ ] Link/install/uninstall tests never overwrite user files silently.
- [ ] Portable fixtures prove JSON and external adapters share identical campaign flow boundaries.
- [ ] Real smoke matrix rows are dated with host and runner versions.
- [ ] `QK-RELEASE-REV` can proceed only after `QK-HOST-005B`.
