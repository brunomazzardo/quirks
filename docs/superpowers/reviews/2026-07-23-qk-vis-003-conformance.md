# QK-VIS-003 — Quirks UI visual-conformance record

- **Reviewer:** Claude Fable 5 (`claude-fable-5`), QK-VIS-003 verification worker — independent of the QK-VIS-002 implementation sessions
- **Reviewer role:** visual-conformance reviewer (bounded manual comparison per plan Task 5 Step 4)
- **Review timestamp:** 2026-07-23T19:19:48Z
- **Comparison performed against commit:** `a73308095fcf482f54f7f1ad66b7c10c375a00b7` (branch `feat/qk-vis-003`, based on local `main` `23dd20fc` which contains the QK-VIS-002 alignment merge `4ec5860` and the QK-UI-006 handoff-delta merge `dfffb1d`)
- **Reproduction rules:** `test/ui/fixtures/visual-conformance-rules.json` (`quirks-ui-visual-conformance-v1`)
- **Tracked references (manifest `docs/visual-references/quirks-ui/manifest.json`):**
  - `docs/visual-references/quirks-ui/approval-workspace-v3.html`
  - `docs/visual-references/quirks-ui/tasks-and-campaign-history-v4.html`
  - `docs/visual-references/quirks-ui/task-provenance-history-v5.html`
- **Viewports:** 1280x800 (desktop) and 390x844 (compact), light theme, animations disabled

## Method

Each tracked reference was rendered in Chromium at both governed viewports via
the opt-in capture spec (`QUIRKS_CAPTURE_REFERENCES=1 pnpm exec playwright test
test/browser/ui-visual-reference-capture.spec.ts`, feedback chooser rows hidden
as brainstorm apparatus per handoff §1). The shipped UI was rendered against
deterministic fixtures (frozen clock `2026-07-21T12:00:00.000Z`, committed
`test/ui/fixtures/visual-project` ledger, constant synthetic commits) and
captured as the ten committed baselines under `test/visual-references/baselines/`.
Reference captures and implementation baselines were then viewed side by side,
decision by decision against each manifest entry's `governs` list. Structural
assertions covering the same decisions run in
`test/browser/ui-visual-conformance.spec.ts` *before* any screenshot comparison,
so baseline regeneration cannot hide missing composition. Comparison follows the
plan's rule: governed decisions, not identical copy or invented data; ink-token
drift `#172033`→`#182230` in v3 is tolerated per handoff §6.G.

## Accepted divergences (explicit list)

These are recorded decisions, not failures. Each is also pinned in the rules
fixture (`acceptedDivergences`) and, where assertable, as an explicit absence
assertion in the conformance spec.

1. **Preflight topbar identity** — v3 draws the identity block (eyebrow, title, health badges) in a dark topbar; the shipped UI renders it in the light `WorkspaceHeader` under the shared five-view shell, and the runner-health badges are not rendered because no projection provides runner health. Decision: `docs/superpowers/design/2026-07-23-preflight-topbar-divergence.md`.
2. **Compact navigation strategy** — the mocks hide the nav below 900px (mock shortcut); the shipped shell keeps a wrapping nav row. Implementation deliberately exceeds the reference. Handoff §3.1.
3. **"Runner health" / "New campaign" nav items absent** — outside the founding five-view contract; no server capability. Nav is `Existing tasks / Campaigns`; Task history stays breadcrumb-only per v5's crumb. Handoff §6.C.
4. **No dead controls** — v3's "Edit routing" / "Use current agent only" buttons and tab row, and v4's selection checkboxes, selection footer, and "Build campaign proposal" CTA require server capabilities that do not exist and are deliberately absent (asserted as absences). Handoff §6.D; §3.5 for the tab row.
5. **Map cards defer titles to the table** — v3's map cards repeat task titles; the shipped map renders id/owner/score only and the complete task list stays the single title authority. Pinned in `test/ui/client/visual-composition.test.ts`.
6. **"Recorded" stat instead of "30-day spend"** — the campaign summary projection has no aggregate spend window; spend renders in the inspector only when the projection carries it. Handoff §3.3.
7. **Ink token drift tolerance** — v3 `--ink:#172033` vs canonical `#182230`. Handoff §6.G.
8. **History header stats are projection-backed (4, not 6)** — v5's duration/usage/landed stats have no projection source; the shipped header renders iterations, artifact refs, availability, latest outcome. Handoff §3.6.
9. **Prompt/copy surfaces are context-only** (§6.A amendment) — they appear in captures (header action areas, inspector aside) but are not governed by any manifest entry and are not fidelity-gated; the rules fixture records `promptSurfaces: "context-only"`.

## Verdicts — `approval-workspace-v3` (Preflight)

| Governed decision | Verdict | Evidence and notes |
|---|---|---|
| application shell | accepted-divergence | Shell *pattern* conforms: dark `#111827` bar over `#f3f6fa` canvas, 1280px centered content (baselines `preflight-desktop-darwin.png` vs reference capture). The v3 single-purpose dark-topbar identity is replaced by the shared five-view shell per divergences 1–3. |
| preflight hierarchy | conforms | Identity → "Nothing has started." notice → metrics → map+inspector → complete list → fixed footer, in v3's order (side-by-side desktop captures). Health badges and the three-tab row are covered by divergences 1 and 4. |
| summary metrics | conforms | Five-up micro-label strip: SCOPE / EXECUTION / ESTIMATE / BUDGET / LANDING with label-over-bold-value-over-detail density. Budget renders the projection's wall-clock/concurrency facts, not v3's illustrative dollars (plan rule: do not require identical copy or invented data). |
| approval composition | conforms — after in-task repair (see Gaps) | Fixed footer with "APPROVAL BINDS THIS EXACT CAMPAIGN ENVELOPE" micro-label, digest code, and the single irreversible action plus acknowledgment; digest associated to the control; map panel + inspector aside + full-width table composition matches. Routing buttons absent per divergence 4. |
| responsive workspace | conforms — after in-task repair (see Gaps) | Compact capture: 2-up summary, stacked workspace (inspector below map), map and table scroll in-panel (asserted `scrollWidth > clientWidth`), footer stacks with a full-width approve action, no page-level horizontal overflow. |

## Verdicts — `tasks-and-campaign-history-v4` (Existing Tasks + Campaigns)

| Governed decision | Verdict | Evidence and notes |
|---|---|---|
| task workspace | accepted-divergence | Stat strip (OPEN/READY/BLOCKED/DESIGN GATE/IN CAMPAIGN with one-line meanings), toolbar, frontier map (FOUNDATIONS → NEXT WAVE → LATER with ready/claimed/design tints), two-line task rows, and selected-task inspector all conform (`tasks-desktop-darwin.png` vs reference capture). The selection→"Build campaign proposal" flow is deliberately absent (divergence 4). Inspector's "Planned proof" block is not rendered because the existing-tasks projection carries no proof data (no-invention rule). |
| campaign workspace | accepted-divergence | Stats row, promoted active-campaign card above the history rows ("Open live campaign"), two-line campaign rows, inspector with result triplet and the verbatim v4 immutability safety note all conform (`campaigns-desktop-darwin.png`). Divergence 6 (Recorded stat); v4's wave-progress line/progress bar and per-wave timeline rail are not rendered because the summary projection has no wave facts — handoff §3.3 explicitly allows state + task count and a slimmer aside. |
| toolbar density | conforms | Single-row search + readiness chips (including the amber-backed "Needs design" filter) + right-aligned view note; note hidden ≤900px; search goes full-width at 620px — matching v4's toolbar wrap. |
| table and inspector composition | conforms | `minmax(0,2fr)/minmax(280px,.8fr)` two-panel grid collapsing to one column ≤900px (computed-style asserted); tables scroll inside panels with muted uppercase headers on `#f8fafc`; row selection populates the aside with WHY THIS ROUTE reason box, score triplet, and the "no task state changes from viewing or selecting" caveat. |

## Verdicts — `task-provenance-history-v5` (Task History)

| Governed decision | Verdict | Evidence and notes |
|---|---|---|
| task history header | accepted-divergence | Breadcrumb "Existing tasks / QK-1 / History and provenance", outcome-first header with badges, subtitle authority disclaimer, and the amber "Local coordination only. … No shared lease" notice all conform (`task-history-desktop-darwin.png`). Divergence 8: four projection-backed stats instead of v5's six; badges reduced to projection facts (iterations, artifact refs). |
| artifact cards | conforms | Typed file cards with blue uppercase kind chips (SUPERPOWERS SPEC / IMPLEMENTATION PLAN / INDEPENDENT REVIEW from real provenance kinds), monospace paths, "Executed at" revision, availability pill, and "Open as executed / Open current / Compare" actions with the primary-blue first action; `other`/untyped refs stay generic cards outside the governing panel; three-up grid to one-up ≤900px. |
| iteration timeline | accepted-divergence | Append-only iteration cards with ordinal eyebrow, outcome, and per-iteration artifact cards conform. v5's 4-step IMPLEMENT/REVIEW/VERIFY/LAND strip, ref chips, and prose summaries are not rendered because `ui-task-history-v1` projects only `id`/`outcome`/`artifactRefs` (handoff §3.6 no-invention rule; QK-VIS-002 acceptance). **Recommended follow-up:** an additive projection enrichment (participants, commit/PR/verification refs already exist in the provenance read model) would make the v5 strip implementable with real data — a ledger proposal outside this verification task. |
| identity and provenance panels | conforms | Provenance rail with ATTRIBUTION identity list spanning verified (Authenticated host, Git signature) and self-asserted evidence, the verbatim "self-asserted unless a valid signature…" caveat, and a commit-derived reference-coverage panel. v5's PULL REQUEST / VERIFICATION / DEVIATIONS panels render only where the projection supplies data (handoff §3.6) — the current projection supplies none, so they are absent, not faked. |

## Campaign Detail (no governing reference — handoff §6.B)

Context only, no fidelity verdict: the view reuses the shared shell, summary
grid, panels, wave-step grammar, and the v4 immutability framing around "Run
again" (`campaign-detail-*.png`); asserted structurally so drift into ad-hoc
composition fails, but never screenshot-judged against a wireframe it does not
have.

## Verdict summary

| Reference | conforms | accepted-divergence | gap (open) |
|---|---|---|---|
| approval-workspace-v3 | 4 | 1 | 0 |
| tasks-and-campaign-history-v4 | 2 | 2 | 0 |
| task-provenance-history-v5 | 2 | 2 | 0 |
| **Total (13 governed decisions)** | **8** | **5** | **0** |

## Gaps found — and repaired in this task

Two genuine conformance defects were exposed by the new structural gates
(commit `a5d55c0`, "test: verify quirks ui visual conformance structurally and
by screenshot") and fixed in `src/ui/styles.ts` within the same commit:

1. **Approval-footer padding reservation was inert.** v3 reserves body padding so the fixed footer never occludes content; the shipped `.preflight-view { padding-bottom: 110px; }` lost specificity to `.ui-shell > :not(nav)` (computed 30px desktop / 24px compact against a 74px / 434px footer). The rule now carries the shell scope and the invariant *reservation ≥ footer height* is asserted at both viewports.
2. **Compact footer inherited a 320px vertical flex basis.** In the stacked ≤620px footer the digest block's `flex: 1 1 320px` became 320px of height (433px total footer). It now collapses to content size (177px measured) and the compact reservation is 200px.

No other gaps remain open against the governed decisions.

## Baseline determinism and update policy

Baselines are darwin-rasterized (recorded in the rules fixture and the
`-darwin` filename suffix) and compared with `maxDiffPixelRatio: 0.01`;
animations and caret disabled; full-page capture (note: the fixed approval
footer appears at its capture-time viewport position in full-page stitches — a
deterministic artifact, not a layout overlap). All rendered text derives from
the frozen clock and committed fixtures. Regenerating a baseline
(`--update-snapshots`) is only legitimate after the structural assertions for
that surface pass and the change is reviewed against the reference; the node
suite (`test/visual-references/conformance-rules.test.ts`) fails `pnpm check`
if any baseline disappears.

## Independent gates (separate evidence — cannot substitute for visual verdicts)

Run at commit `a73308095fcf482f54f7f1ad66b7c10c375a00b7`, 2026-07-23:

- `pnpm check` — 775 tests: 770 pass, 0 fail, 5 known skips (lint, typecheck, validate:skills included).
- `pnpm exec playwright test test/browser/ui-visual-conformance.spec.ts test/browser/ui-responsive.spec.ts test/browser/ui-a11y.spec.ts test/browser/ui-security.spec.ts test/browser/ui-table-performance.spec.ts` — 31 passed.
- Full `pnpm exec playwright test` — 44 passed, 6 skipped (the opt-in reference-capture spec), 0 failed.
- `git diff --check` — clean.
- Conformance-suite determinism: three consecutive comparison runs against the committed baselines, 11/11 passed each.

Security, accessibility, responsive-fit, and performance results above are
independent gates; per the plan's global constraints they do not prove visual
fidelity, and the visual verdicts in this record do not prove them.
