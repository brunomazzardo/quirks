# Quirks UI Design Handoff

**Date:** 2026-07-23
**Status:** Design handoff — no code changes accompany this document
**Audience:** the designer or implementing agent executing QK-VIS-001 → QK-VIS-003 (plan: `docs/superpowers/plans/2026-07-22-visual-reference-materialization.md`)
**Register:** product UI (design serves the tool; the bar is earned familiarity, density, and consistency — not decoration)

This document consolidates what the five approved wireframes establish, measures the shipped React UI against them view by view, places the copy-prompt surfaces (which post-date the wireframes) into the approved layout, and states the future vision beyond the wireframes. Everything below either quotes the wireframes/specs directly or is explicitly labeled **proposal**.

---

## 1. The approved visual system at a glance

Synthesized from the three fidelity-bearing wireframes (v3, v4, v5 — see §2). This is the system QK-VIS-002 must ship.

**Shell.** A dark `#111827` top bar (brand "Quirks" + repository context on the left, primary nav on the right) over a light `#f3f6fa` canvas. Page content is centered at `max-width: 1280px` with `18px 22–24px` padding. This inverts the current UI: the approved system is a light workspace with a dark nav, not a dark page.

**Palette (exact tokens from the wireframes).** `--ink:#182230` (v3 uses `#172033`; the VIS plan resolves the drift to `#182230`), `--muted:#667085`, `--line:#dfe5ee`, `--canvas:#f3f6fa`, `--panel:#fff`, `--nav:#111827`, link/selection blue `#2563eb`, success `#166534`, warning `#b45309`/`#92400e`, danger `#b42318`, and three agent identity colors: Claude `#d97706`, Codex `#0284c7`, Cursor `#7c3aed` (each with a matching pale background: `#fffbeb`, `#f0f9ff`, `#faf5ff`). Color strategy is restrained: neutrals plus semantic status tones; the agent colors are the only sustained chromatic identity and always appear as coded borders/dots/pills, never as decoration.

**Typography.** One family: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (no remote fonts — Inter renders only if locally installed; the system stack is the real baseline). Hierarchy is carried by weight (700–800 on headings, labels at 750–800 weight) and by a micro-label system: small uppercase muted labels (`SCOPE`, `PROPOSED OWNER`, `ACCEPTANCE PROOF`) above bold values. This label-over-value pattern is the approved density language and appears in every panel.

> **Proposal — production type floor.** The mocks were drawn at 7–11px to fit a small canvas. Treat the *ratios and hierarchy* as governing, not the absolute pixel sizes: in production, map supporting text to ≥11px, body/table text to 12–13px, panel headings to 13–15px, page titles to ~21–22px. The VIS plan's manual-comparison rule already supports this ("do not require identical copy"; compare governed decisions, not pixels). Muted `#667085` on white passes 4.5:1; do not lighten it further.

**Panels.** White cards with `1px solid var(--line)` borders, `9–11px` radius, and a `panel-head` row (bold title left, muted meta right, bottom border). Panels compose into asymmetric two-column workspaces: primary content `minmax(0, ~2fr)`, secondary inspector `minmax(270–300px, ~0.8fr)`. Tables and maps always scroll inside their own `overflow-x: auto` container with an explicit `min-width` (650–900px), never the page.

**Status vocabulary.** Rounded pill badges with tinted backgrounds: green `#dcfce7/#166534` (Ready/Completed/Running-healthy), amber `#fef3c7/#92400e` (Design gate/Paused/Partial), blue `#dbeafe/#1d4ed8` (Running), gray `#f2f4f7/#475467` (Blocked/neutral). Dark-nav badges use `#253047` (neutral) and `#14532d` (good).

**Responsive model.** Structural, breakpoint-driven (matching the product register): stat grids go 5–6 columns → 2–3 at ~900–920px → 2 at 620px; two-column workspaces collapse to one column at ~900px; page padding tightens at 620px; wide inner content keeps its min-width and scrolls. v4/v5 hide the top nav below 900px (a mock shortcut — production needs a real compact nav, see §6).

**What to ignore in the mocks.** The `.feedback` / `.choice` rows ("This structure is clear", "Both views fit", "This history view fits"), the `onclick="toggleSelect(this)"` handlers, and the v1/v2 option-card chrome are brainstorm apparatus, not product UI. Do not reproduce them.

---

## 2. Existing idea — what each wireframe establishes

Five wireframes exist across two brainstorm sessions. Three are **fidelity-bearing** (v3, v4, v5 — the ones the VIS plan preserves and the manifest catalogs); two are **decision provenance** (v1, v2 — superseded option boards that record *why* the chosen structure won); v6 is a stub.

### 2.1 `approval-layout-options.html` (v1) — decision provenance

A three-option comparison board for one question, quoted: **"How should the campaign approval page explain the work?"** Each option renders the same digest-bound proposal:

- **"A · Hybrid map + execution list"** — marked "Recommended. The graph explains order and parallelism; the list provides complete task, agent, scoring, fallback, and test details."
- **"B · Wave board"** — three parallel wave lanes ("WAVE 1 · PARALLEL", "WAVE 2 · SERIAL", "WAVE 3 · GATES").
- **"C · Detailed task ledger"** — a single dense table with an "Approval digest" footer card.

It closes with a **"Shared behavior"** section, quoted: "All layouts allow task-by-task route changes before approval, explain why each model was chosen, show fallbacks and unavailable agents, and bind the Approve button to the exact envelope digest."

**Governs:** the *choice* of the hybrid map+list family and the shared approval invariants (route editing before approval, routing rationale, fallbacks, digest-bound approve). Not a fidelity reference; superseded by v2 → v3.

### 2.2 `approval-layout-refined-v2.html` (v2) — decision provenance

Two full-screen information architectures, framed: "These are full-screen information architectures. Both are proposals only: no task is claimed and no agent starts until the digest-bound approval succeeds."

- **"A · Multi-view approval workspace"** — marked "**Recommended.** One immutable proposal with three synchronized views: task dependency map, agent lanes, and complete list. Selecting a task opens its routing rationale and verification details without cluttering the map." Introduces the structure v3 finalizes: dark topbar with eyebrow "PREFLIGHT · PROPOSAL" + campaign title + health badges; a 5-metric summary strip (SCOPE / EXECUTION / ESTIMATE / BUDGET CAP / LANDING); a tab row ("Task map", "Agent lanes", "Task list" — "Same immutable plan · three views"); a two-column map + selected-task-inspector workspace; and a bottom bar: "APPROVAL BINDS EXACTLY … sha256:…" with actions "Edit routing", "Use current agent only", "Approve exact plan".
- **"B · Agent-lane timeline"** — agent rows × wave columns showing reserved/idle capacity ("Reserved for review", "Waiting on QK-101", "No compatible task"). Closing question, quoted: "Should the default approval screen be A, the task-centered workspace with switchable views, or B, the agent-centered timeline? Both can expose the other view as a tab."

**Governs:** the decision that the approval screen is *task-centered* (A) with the agent-lane view demoted to a tab; the summary-metric vocabulary; the fixed digest-bound action bar. Superseded by v3 for all measurements. (Note: option B's agent rows use 4px left-stripe borders — a pattern the chosen direction does *not* use; v3 task cards use full 2px borders. Do not resurrect the side-stripe.)

### 2.3 `approval-workspace-responsive-v3.html` (v3) — fidelity-bearing

The finished, self-contained responsive approval workspace (`<title>Quirks campaign approval</title>`). This is the governing reference for the Preflight view.

- **Layout structure:** dark topbar (eyebrow "PREFLIGHT · PROPOSAL ONLY", h1 "Campaign QK-2026-071", badges "External agents ON / Claude healthy / Codex healthy / Cursor healthy") → blue notice ("**Nothing has started.** This page is generated from the immutable candidate envelope. Change anything and Quirks creates a new digest." + "Current host: Codex") → 5-metric summary grid (SCOPE "6 exact tasks / No inferred backlog work", EXECUTION "4 waves / 2 parallel lanes", ESTIMATE "42–67 min / 78% planning confidence", HARD BUDGET "$8.00 / Pause before exceeding", LANDING "Local merge / Remote push disabled") → tab nav ("Task map" active, "Agent lanes", "Complete task list", note "Three views of the same immutable proposal") → workspace grid `minmax(0,2.15fr) / minmax(270px,.85fr)`: left panel **"Dependency and execution map"** ("Left → right is execution order"; wave columns WAVE 0 DESIGN GATE → WAVE 1 PARALLEL LANES → WAVE 2 INTEGRATE → WAVE 3 INDEPENDENT GATES; agent-colored task cards with id/title/owner/score; legend row), right aside **selected-task inspector** ("SELECTED TASK · QK-104", h2, "PROPOSED OWNER" box with routing rationale, RISK/EFFORT/CONFIDENCE score triplet, "ACCEPTANCE PROOF" checklist, "FALLBACK" with "Switching before launch produces a new proposal digest.") → full-width panel **"Complete task list"** ("Nothing hidden by the visual map"; columns Order / Task / Requires / Proposed agent / Risk / effort / confidence / Acceptance proof; agent color dots in cells) → **fixed footer** ("APPROVAL BINDS THIS EXACT CAMPAIGN ENVELOPE" + digest code + buttons "Edit routing", "Use current agent only", "Approve exact plan"; body reserves `padding-bottom: 96px`).
- **Navigation model:** single-purpose screen; internal navigation is the three-view tab row only.
- **Information hierarchy:** identity and health first (topbar), safety statement second (notice), quantified scope third (metrics), structure fourth (map), detail on demand (inspector), completeness guarantee fifth (full table), the one irreversible action pinned last (footer).
- **Density decisions:** micro-label + bold value everywhere; task cards carry five data points in ~85px height; the map min-width is 700px and the table min-width 850px inside `overflow-x:auto` wrappers.
- **Panel composition:** map panel + inspector aside + full-width table panel; inspector is an `<aside>` peer of the map, not a modal.
- **Responsive behavior:** at 900px the summary goes 2-up and the workspace stacks (inspector below map); at 620px padding tightens, topbar/notice/footer stack vertically, tabs scroll horizontally, footer buttons go full-width equal-flex. The map and table never reflow — they scroll.
- **Governs (manifest):** `application shell`, `preflight hierarchy`, `summary metrics`, `approval composition`, `responsive workspace`.

### 2.4 `tasks-and-campaign-history-v4.html` (v4) — fidelity-bearing

The two read-model workspaces on one page (`<title>Quirks tasks and campaigns</title>`), framed by the intro: kicker "LOCAL CONTROL UI · DESIGN PREVIEW", h1 "Tasks and campaign history", subtitle "The approval workspace becomes the third view alongside these two read models.", and a source note "Tasks: live project adapter / Campaigns: local Quirks journal".

- **Layout structure — section "Existing tasks"** ("Repository-scoped · refreshed 12 seconds ago"): 5 stat cards (OPEN 14, READY 6, BLOCKED 4, DESIGN GATE 2, IN CAMPAIGN 2, each with a one-line meaning) → a single-row toolbar (search input "Search task ID, title, file, or label…", filter chips Ready / Blocked / Needs design / All states, right note "View: Dependency map + list") → two-panel workspace `minmax(0,2fr) / minmax(280px,.8fr)`: left panel **"Live dependency frontier"** ("Select only eligible work or include blockers for planning"; a mini flow map FOUNDATIONS → NEXT WAVE → LATER with ready/blocked/design-tinted cards) above a checkbox-selection table (columns: ☑ / Task / State / Dependencies / Risk / effort / Suggested route) and a selection footer ("**3 selected** · dependency closure adds QK-101 automatically · estimated 28–44 min" + primary button "Build campaign proposal"); right aside: **selected-task detail** ("SELECTED TASK · QK-103", title, status pill, description, RISK/EFFORT/CONFIDENCE triplet, "WHY THIS ROUTE" reason box, "PLANNED PROOF", "SOURCE OF TRUTH" — "no task state changes from viewing or selecting").
- **Layout structure — section "Campaigns"** ("Current repository ▾ · switch to All projects"): 5 stat cards (ACTIVE 1, PAUSED 1, COMPLETED 8, HELD 1, 30-DAY SPEND $31.42) → campaign grid `minmax(0,1.7fr) / minmax(300px,1fr)`: left panel with an **active-campaign card** on a green tint ("Running" pill, "QK-2026-071 · Multi-harness dispatcher", "5 of 8 tasks accepted · Wave 3 of 4 · Codex worker active", button "Open live campaign", a progress bar) above a compact history list (columns Campaign / Status / Tasks / Agents used (color dots) / Time / spend / Landing); right aside: **selected-campaign timeline** ("SELECTED CAMPAIGN … Completed 18 Jul · envelope sha256:…"; wave steps with dots, per-step agent + duration; TASKS / SPEND / COMMITS result triplet; buttons "Final report", "Evidence", "Commits"; safety note "A past campaign is immutable. 'Run again' creates a fresh preflight against current task revisions, runner health, target branch, and a new approval digest.").
- **Navigation model:** the first appearance of the app shell nav: "Existing tasks" (active) / "Campaigns" / "Runner health" / "New campaign" (green primary). See §6.C — "Runner health" is outside the founding five-view contract.
- **Information hierarchy:** counts before lists; the toolbar mediates the list; selection state and its consequence (dependency closure, estimate) live in a persistent footer next to the one primary action; the inspector answers "why this route" without leaving the page.
- **Density decisions:** stat cards are three lines (label/value/meaning); table rows are two-line (id bold over title); campaign rows compress six columns; everything scrolls in-panel (table min-width 760px, map min-width 650px).
- **Panel composition:** map + table fused into a single primary panel with a selection footer; inspector aside; active-campaign card visually promoted above the history list inside the same panel.
- **Responsive behavior:** at 900px both workspaces stack and the nav hides; at 620px the toolbar wraps (search goes full-width), the intro stacks, and campaign rows drop to two columns hiding cells `n+5`.
- **Governs (manifest):** `task workspace`, `campaign workspace`, `toolbar density`, `table and inspector composition`.

### 2.5 `task-provenance-history-v5.html` (v5) — fidelity-bearing

The task history / provenance screen (`<title>Quirks task history</title>`), from the second brainstorm session.

- **Layout structure:** breadcrumb "Existing tasks / QK-103 / History and provenance" → header (h1 "QK-103 · Claude process adapter", subtitle "Reference-only provenance. Files, Git, GitHub, and the campaign journal remain authoritative.", badges "Completed / 2 iterations / 3 commits / PR #18 merged") → amber notice ("**Local coordination only.** Attribution is recorded, but version one does not prevent another user on a different machine from attempting the same task." + "No shared lease") → 6 stat cards (FINAL OUTCOME, CAMPAIGN, DURATION, VERIFICATION 9/9, USAGE $3.42 · 184k tokens, LANDED a4ff381) → layout `minmax(0,2fr) / minmax(300px,.8fr)`:
  - **Main stack:** panel **"Governing files"** ("References only · exact historical revision preserved"; three cards typed SUPERPOWERS SPEC / IMPLEMENTATION PLAN / INDEPENDENT REVIEW, each with monospace path, revision note like "Executed at 61a0806 · current file has 2 newer commits", and actions "Open as executed" / "Open current" / "Compare") → panel **"Iteration history"** ("Append-only summaries · detailed events remain in campaign journals"; per-iteration card: eyebrow "ITERATION 2 · CAMPAIGN QK-2026-068", outcome heading, date/revision line, status pill, a 4-step IMPLEMENT → REVIEW → VERIFY → LAND strip, prose summary, and ref chips "3 commit refs / PR #18 / 9 checks / …") → panel **"Accepted commits"** ("Commit count is derived from these references"; columns Commit / Summary / Produced by / Git author / Git committer / Identity evidence, with avatar chips and verdicts "✓ Signed committer" vs "Local Git identity / No verified signature").
  - **Aside stack:** **ATTRIBUTION "Who did what"** (operator / implementer / reviewer / PR merger rows with the caveat "Git author and committer names are self-asserted unless a valid signature or authenticated provider identity verifies them.") → **PULL REQUEST** card → **VERIFICATION** checklist → **DEVIATIONS** ("One quota reroute in iteration 1") + **FOLLOW-UP TASKS**.
- **Navigation model:** shell nav now reads "Existing tasks / Task history (active) / Campaigns / Runner health"; the breadcrumb establishes history as a child of a task, reached from Existing tasks.
- **Information hierarchy:** outcome first (badges + stats), authority disclaimers second (subtitle + notice), evidence third (files → iterations → commits), context/actors in the rail.
- **Density decisions:** 6-column stat row; three-up file cards; iteration timelines as compact 4-cell strips; commits table min-width 900px.
- **Panel composition:** two independent vertical stacks of small single-purpose panels — the only screen composed of many small panels rather than one dominant panel.
- **Responsive behavior:** at 920px stats go 3-up, layout stacks, file cards go 1-up, nav hides; at 620px stats and timeline strips go 2-up, header and notice stack.
- **Governs (manifest):** `task history header`, `artifact cards`, `iteration timeline`, `identity and provenance panels`.

### 2.6 `continuing-in-terminal-v6.html` (v6) — stub / open thread

The file contains only, quoted: *"History view approved. Continuing the design in the terminal…"* No screen was captured. Whatever surface v6 was meant to define (the session context suggests the hand-back from UI to terminal continuation) is **undesigned**. Any implementation touching that surface needs a new brainstorm/reference first — see §5.4 and §6.E.

---

## 3. Current-state gap analysis

Ground truth: the shipped client under `src/ui/client/` renders a dark, near-unstyled single column. `src/ui/styles.ts` is 38 lines: dark background `#0b0c10`, one nav border, one table style, focus outlines, and prompt-action containment — no canvas/panel split, no tokens, no grid compositions, no status-tone colors (`.status-badge` has a `data-tone` attribute but no per-tone CSS at all, so every badge renders identical). `src/ui/client/routes/root.tsx` renders a two-link nav ("Existing tasks", "Campaigns") with no brand, no repository context, no Task history entry, and no shell chrome. The owner's description — "far off from what we had envisioned" — is accurate: the content contract of the founding spec §22 is substantially present in the DOM; the visual system of §1 is entirely absent.

What follows is per-view. "Reference" names the governing wireframe; every gap names the file to change. The shared work (shell, tokens, `WorkspaceHeader` / `SummaryStat` / `Panel` primitives, `DataTable` wrapper) is specified in plan Task 4 and not repeated per view.

### 3.1 Shell — `src/ui/client/routes/root.tsx`, `src/ui/styles.ts`

- Missing entirely: dark `--nav` topbar with brand "Quirks" + repository line; light `--canvas` body; 1280px centered `main`; nav active-state treatment (`background:#273449`); the "New campaign" primary affordance (v4). Reference: v4/v5 `.top`, v3 `.topbar`.
- Missing: a compact-nav strategy below 900px. The mocks hide the nav (`.nav{display:none}`) — a mock shortcut. **Proposal:** collapse to a wrapping row or a disclosure button; never remove navigation. This is a place the implementation must exceed the reference, and the VIS-003 manual review should accept it as such.
- Route tree has no `/tasks/$taskId/history` nav entry even though `campaign-detail-view.tsx` links into it; v5 shows "Task history" in the shell nav. Add the entry (or keep history breadcrumb-only per v5's crumb — either way, decide deliberately).

### 3.2 Existing Tasks — `src/ui/client/views/existing-tasks-view.tsx` (reference: v4 "Existing tasks" section)

Current: `h1` → `SyncBanner` → optional prompt heading + `PromptActions` → one six-column `DataTable` (Task / Readiness / Dependencies / Suggested route / Source revision / Coordination). Gaps:

- **No stat row.** v4 leads with OPEN/READY/BLOCKED/DESIGN GATE/IN CAMPAIGN counts. These are derivable client-side from `projection.tasks[].readiness` — no projection change needed for a first pass.
- **No toolbar.** v4's search + filter chips row does not exist; there is no filtering at all. Add the toolbar panel (search over id/title, readiness chips).
- **No two-panel composition.** v4 places the table in a primary panel with a selected-task inspector aside (risk/effort/confidence, "WHY THIS ROUTE", "PLANNED PROOF", "SOURCE OF TRUTH"). The current table crams route and source into columns instead. Move detail into the aside on row selection; plan Task 4 hedges this correctly: "selection/inspection content in the secondary panel when projection data permits it".
- **No dependency-frontier map.** v4's mini flow (FOUNDATIONS → NEXT WAVE → LATER) has no counterpart; the data (dependsOn/blockers/readiness) exists in the projection. In-scope for VIS-002 as a simple three-column grouping; a full graph is not required by the reference.
- **No selection → "Build campaign proposal" flow.** v4's checkboxes, selection summary footer, and primary CTA are a *functional* gap (spec §22: "A user selects an exact set and starts preflight"), not purely visual — see §6.D.
- `SyncBanner` (`components/sync-banner.tsx`) should restyle as the v4 section-title meta ("refreshed 12 seconds ago") plus status pills rather than a bordered box, but its content contract (pending/conflicts/coordination/lease/freshness) already matches §22 and must not shrink.

### 3.3 Campaigns — `src/ui/client/views/campaigns-view.tsx` (reference: v4 "Campaigns" section)

Current: `h1` → "Show all projects" checkbox → one six-column table. Gaps:

- **No stat row** (ACTIVE/PAUSED/COMPLETED/HELD/spend). Counts derivable from `items[].state`; `UiCampaignSummaryItem.spend?: Record<string, number>` is optional, so an aggregate spend stat renders only when the data is present — never invent it (per QK-VIS-002 acceptance: "does not invent … evidence absent from canonical projections"). The v4 mock's fixed "30-DAY" window is illustrative; label whatever window the projection actually represents.
- **No active-campaign promotion.** v4's green active card ("Wave 3 of 4 · Codex worker active", progress bar, "Open live campaign") is the section's anchor. Promote any `running`/`paused`/`awaiting_approval` campaign above the history rows; wave progress needs the detail projection or a summary field — first pass can show state + task count only.
- **No selected-campaign timeline aside.** v4's right rail (wave steps, result triplet, report/evidence/commit links, immutability safety note) has no counterpart; the data lives in `UiCampaignDetail` (waves, commits, verification, reportPath), so the aside implies fetching detail on selection — acceptable within the existing query layer, or defer the rail to campaign-detail and keep a slimmer aside.
- The "Show all projects" checkbox should become the v4 scope control styling ("Current repository ▾ · switch to All projects") in the section title.
- Two-line campaign rows (bold id over title) — current rows have no title line because the summary projection has no campaign title; render id + repository and do not invent titles.

### 3.4 Campaign Detail — `src/ui/client/views/campaign-detail-view.tsx` (reference: **none** — see §6.B)

Current: `h1` → metadata paragraph → `SyncBanner` → `PromptActions` → "Run again" link → six stacked full-width sections (Tasks table, plan progress, Waves as a `<ul>` of labels, Runners / Commits / Pull requests / Verification tables). No wireframe governs this screen; plan Task 4 instructs only: "reuse the same shell, summary, panel, table, and progress-ledger primitives." Concrete restyle within that instruction:

- Header → `WorkspaceHeader` (campaign id, state badge, repository), stat row from taskCount/state/outcome/sync.
- Each table into a `Panel`; "Waves" should adopt v4's timeline-step visual language (dots + per-wave labels) rather than a bare list — the journal now emits real `wave.started` / `wave.completed` events (§5.2).
- `PlanProgressLedger` (`components/plan-progress-ledger.tsx`) is currently unstyled paragraphs + `<ol>`; the founding spec §22 calls it "a vertical execution ledger" that "highlights the current job, stage and TDD phase, distinguishes worker-reported from controller-observed/reviewed states". Style it as a panel with v4's `.step` grammar and distinct treatment for `reported_complete` vs `reviewed` (currently text-only via `data-status`).
- "Run again" must adopt v4's safety framing: it sits with the immutability note ("A past campaign is immutable. 'Run again' creates a fresh preflight…"), not as a bare link under the title.

### 3.5 Preflight — `src/ui/client/views/preflight-view.tsx` (reference: v3)

Current: a single-column `article.preflight-view` of ten uniform `Section` blocks ("What will run", "Delegated judgment", "Where work lands", "Push", "Authority", "Models and spend", "Verification", "Stop conditions and residuals", "Approval digest binding", "Approve") of plain `<p>`/`<ul>` content, plus a filterable task table. The §22 content contract is essentially complete; the v3 structure is entirely missing:

- **No topbar identity/health block** (eyebrow "PREFLIGHT · PROPOSAL ONLY", campaign title, health badges). Current header is `h1 "Preflight proposal"` + a sentence.
- **No "Nothing has started" notice.** v3's immutable-envelope statement exists only as scattered sentences; give it the notice treatment.
- **No summary metric grid.** Tasks/Waves/Duration render as labeled paragraphs inside "What will run"; v3 makes them the 5-up strip (SCOPE / EXECUTION / ESTIMATE / HARD BUDGET / LANDING). All five values exist in `proposal.summary` (budget is wall-clock ms + concurrency, not dollars — render what the projection provides).
- **No execution map.** The wave structure renders as `<ul>` of "wave: taskIds". Build the left-to-right wave-column map with agent-tinted task cards and the legend; data exists (`proposal.waves`, `proposal.lanes`, per-task route/confidence). Horizontal scroll container per v3.
- **No workspace composition / inspector aside.** `InspectorPanel` content is duplicated into two stacked sections ("Delegated judgment" and "Verification"); v3 shows it once, as the aside (owner box with routing rationale, score triplet, acceptance proof, fallback). Deduplicate into the aside.
- **No tab row.** v3's "Task map / Agent lanes / Complete task list" tabs: the map and complete list both exist in v3 simultaneously (tabs switch the *primary* panel), and the current code already has the complete table — compose map panel + inspector + full-width table first; the "Agent lanes" tab is optional follow-on (v2 option B demoted to a tab).
- **No fixed approval footer.** The digest and `ApprovalForm` (`components/approval-form.tsx` — checkbox acknowledgment + submit) sit at the bottom of the scroll. v3 pins digest + actions in a fixed footer with body padding reserved. Keep the existing acknowledgment checkbox inside the footer composition; "Edit routing" / "Use current agent only" have no server capability yet — do not render dead buttons (see §6.D).
- Remaining §22 sections (Push, Authority, Landing, Stops/residuals) become compact `Panel`s in the flow between summary and table — v3 folds landing/push into the LANDING metric plus the task list; keep the fuller sections, styled, since the spec requires them.

### 3.6 Task History — `src/ui/client/views/task-history-view.tsx` (reference: v5)

Current: `h1 "Task history: {id}"` → `PromptActions` → **one flattened table** of iteration×artifact rows (Iteration / Outcome / Path / Commit / Availability & actions / Identities). This is the furthest view from its reference:

- **No breadcrumb, no header badges, no stat row.** v5's outcome-first header (badges: Completed / n iterations / n commits / PR merged; six stats) must be derived from `projection.iterations` — outcome/duration/usage fields render only if the projection carries them; do not invent (QK-VIS-002 acceptance criterion).
- **No "Local coordination only" notice.** Spec §22 and §17 *require* this statement ("The UI must say `Local coordination only`"). It exists in `SyncBanner` on other views via `leaseNotice` but is absent here. Add the v5 amber notice.
- **No governing-files cards.** Artifact refs of kind spec/plan/review should surface as v5's typed cards with "Open as executed / Open current / Compare" (the actions and `internalRoute()` already exist in the current code — they render as bare `<a>` lists in table cells today).
- **No iteration cards.** Iterations must become v5's append-only cards (eyebrow, outcome, status pill, step strip, summary, ref chips) instead of being exploded into per-artifact table rows.
- **No commits table with identity columns, no aside rail.** The identity evidence code exists (`IdentityList`, `EVIDENCE_LABEL` — matching v5's "self-asserted unless a valid signature…" caveat) but is buried in a table column. Compose the aside: Attribution, Pull request, Verification, Deviations/Follow-ups — each only where the projection supplies the data.

### 3.7 Shared components

- `components/data-table.tsx` — needs the plan Task 4 wrapper (`.data-table-wrapper` scroll container) and v3/v4 table styling (muted uppercase `th` on `#f8fafc`, row top-borders `--line`); semantic structure and caption stay.
- `components/status-badge.tsx` — the tone→color mapping must actually exist in CSS (pill radius, tinted backgrounds per §1). Today all tones look identical.
- `components/approval-form.tsx` — visually joins the fixed footer; logic unchanged.
- `visual-states.ts` (`confidenceBadge`, `routeTierLabel`) — keep; it is the right seam for tone mapping.

---

## 4. Placing the prompt/copy-action surface (post-wireframe)

`components/prompt-actions.tsx` and `components/prompt-preview.tsx` implement the contextual-copy-prompts design (`docs/superpowers/specs/2026-07-22-contextual-copy-prompts-design.md`): one recommended copy action + a "More prompts" menu of state-valid alternatives + preview dialog + selectable fallback when the clipboard fails. The wireframes predate them; nothing in v1–v5 shows them. The following placements are **proposal**, consistent with the spec's context matrix ("Preflight awaiting approval → Review campaign plan …", "Running campaign → Continue or attach…", etc.) and with the approved layouts:

- **Preflight (v3 frame):** the primary copy action ("Review campaign plan") belongs in the topbar/header action area or immediately beside the tab row — *not* inside the fixed approval footer, which must stay reserved for the single digest-bound action. It is a "before you approve" affordance; keep it visually secondary to Approve.
- **Existing Tasks (v4 frame):** prompt actions are task-scoped (`promptSet.context.taskId`); they belong inside the selected-task inspector aside, under the "WHY THIS ROUTE" / "PLANNED PROOF" blocks — not above the table as today (the current floating "Prompts for QK-…" `h2` disappears once the inspector exists).
- **Campaign Detail:** in the header action area of the `WorkspaceHeader` (continue/recover/inspect recipes are campaign-scoped), mirroring v4's "Open live campaign" button position.
- **Task History (v5 frame):** in the header badge/action row, and/or beside the relevant iteration card for review-scoped recipes; the aside rail is already dense.
- **PromptPreview** currently renders as an inline `<dialog open>` block (`position: static` in styles.ts). **Proposal:** keep `<dialog>` but present it modally (`showModal()`-equivalent styling) or as a full-width panel directly under the actions — either way styled as a `--panel` card with the micro-label system for Authority/Target/Bindings. The warnings list keeps the amber tone.
- The clipboard-fallback textarea and "Copied" status already meet the spec's failure contract; they only need token styling.

Because these surfaces are not governed by any manifest entry, VIS-003 must not screenshot-gate them — record them as context-only for v1 of conformance (see amendment trigger §6.A).

---

## 5. Future vision — beyond the wireframes

Grounding: the founding spec's view contract — §22 "Run-start user experience" (Existing Tasks, Preflight Proposal, Campaigns, Task History, with Plan Progress inside active campaigns; §22.1 "the five fixed local views") and §17's read-model definitions. The wireframes cover Preflight (v3), Existing Tasks + Campaigns (v4), and Task History (v5) at rest. What they do not cover is *live* and *degraded* state. All of §5 is **proposal** except where a spec section is quoted.

### 5.1 Plan Progress as a first-class live surface

Spec §22: the plan-at-commit outline renders as "a vertical execution ledger", highlights current job/stage/TDD phase, "distinguishes worker-reported from controller-observed/reviewed states, shows runner heartbeat and progress-update age separately", polled every two seconds while active and visible. The shipped `PlanProgressLedger` has the data contract but no visual language. Vision: it adopts v4's timeline-step grammar inside a panel on Campaign Detail, with the current step highlighted, a visible freshness/heartbeat pair (v4's "refreshed 12 seconds ago" idiom), and an explicit two-state step treatment — "Worker reported" (hollow/amber) vs "Controller reviewed" (solid/green). This distinction is a trust boundary, not decoration; it deserves the strongest visual differentiation on the screen.

### 5.2 Live campaign waves (runToCompletion)

`src/campaign/supervisor.ts` `runToCompletion()` now journals `wave.started` / `wave.completed` events per wave with `completedTaskIds`, looping until done. v4's *selected-campaign timeline* (wave steps with agent + duration) was drawn for a **completed** campaign; the natural evolution is the same timeline rendering **in flight** on Campaign Detail: completed waves solid, the active wave carrying the v4 progress-bar treatment and "Wave 3 of 4" phrasing from the active-campaign card, future waves dashed (v2 option B's "Waiting on…" placeholder idiom). The event stream is already durable journal data, so this stays a projection — no client state becomes canonical.

### 5.3 Standalone read-only mode

`src/ui/open-workspace.ts` opens a standalone workspace when no campaign id is given (`readOnly = input.campaignId === undefined`) with read-model-only ports. The wireframes never show a read-only state. Vision: the shell topbar carries a persistent neutral badge ("Read-only viewer" — same badge vocabulary as v3's "External agents ON"), the Preflight approval footer is suppressed entirely (not disabled — spec §20's split viewer/approval credentials mean the affordance should not exist without the approval vault), and copy-prompt actions remain available since they are read-only projections. Per spec §20, after approval-token consumption "the viewer session may continue read-only live tracking until expiry" — the same badge state serves both.

### 5.4 The v6 open thread — continuing in the terminal

v6 was meant to design the hand-back from browser to terminal and was never captured (§2.6). The copy-prompt surfaces have since shipped part of that story (a prompt is copied, the human continues in a terminal agent). Open questions a dedicated design must answer: does the UI show "continuation handed off" state after a copy (spec §22's freshness indicators could carry it)? Does the standalone workspace advertise the CLI commands that own each mutation (per AGENTS.md, "Quirks CLIs remain the only mechanical task/campaign authority")? Until designed, ship nothing speculative here.

### 5.5 What a v7 wireframe iteration should explore

1. **Campaign Detail / live campaign** — the one shipped view with no governing reference (§6.B): shell + wave timeline (§5.2) + Plan Progress ledger (§5.1) + prompt actions (§4) on one screen, in both running and terminal states.
2. **Read-only / degraded states** — standalone viewer badge, expired session, sync `stale`/`unavailable`, and the "operator hold" state v4 only shows as a table row.
3. **Empty, loading, and error states** — the mocks show only rich data. Product-register rule: skeleton panels (not spinners) matching the summary-grid/panel geometry, and empty states that teach ("No campaigns yet — select tasks in Existing tasks and build a proposal"), not "nothing here".
4. **Prompt preview presentation** — modal vs inline panel decision (§4), plus the "More prompts" menu as a proper popover that escapes panel overflow clipping.
5. **Compact navigation** — the real sub-900px nav the mocks elide (§3.1).
6. **Runner health** — only if the five-view contract is deliberately amended (§6.C); v4/v5 nav mentions it but no screen exists.
7. Deliberately out of scope: a dark theme. The approved system committed to a light canvas; the current dark UI is the accident, not the alternative.

---

## 6. Plan-amendment triggers and open decisions

- **A. Prompt surfaces are ungoverned.** Plan Task 4's file list omits `prompt-actions.tsx` / `prompt-preview.tsx`, and no manifest entry governs them. Styling can land through `src/ui/styles.ts` (which Task 4 does modify) without a plan amendment, but QK-VIS-002's reviewers need §4 of this handoff as the placement authority, and QK-VIS-003's rules fixture must record prompt surfaces as **context-only** (excluded from screenshot gates) or the baselines will churn. Recommend: a one-line amendment to plan Task 5's `visual-conformance-rules.json` scope note.
- **B. Campaign Detail has no reference.** Plan Task 4 covers it primitives-only ("reuse the same shell, summary, panel, table, and progress-ledger primitives") and Task 5 defines no campaign-detail surface. That boundary is coherent for VIS; a v7 wireframe (§5.5.1) plus a manifest addition would be a future amendment, not part of this chain.
- **C. "Runner health" nav item.** v4/v5 show it, but the founding spec §22.1 fixes "five fixed local views" and §22 defines four workspaces + Plan Progress — no runner-health view. v4's manifest `governs` list does not include navigation, and v3's "application shell" governs the shell *pattern*, not the mock's nav labels. QK-VIS-002 should ship the shell with the real route set (Existing tasks / Campaigns / Task history) and no dead "Runner health" item — document the divergence in the VIS-003 manual-comparison record. Adding the view later = founding-spec-level change, not a VIS amendment.
- **D. Functional gaps that look visual but are not.** v4's selection footer + "Build campaign proposal" CTA, and v3's "Edit routing" / "Use current agent only" buttons, require server capabilities that do not exist in the shipped API. QK-VIS-002 must not render dead controls; plan Task 4's hedge ("when projection data permits it") covers the inspector, but the selection→preflight flow needs its own follow-up task outside the VIS chain. Flag in the VIS-003 review that these reference elements are intentionally absent.
- **E. v1/v2/v6 stay local.** The spec (§4) excludes "superseded alternatives" from the manifest, and plan Task 1 preserves only v3/v4/v5 — correct. v1/v2 remain reachable via the brainstorm tree and the claude.ai project (§7); if they are ever needed durably, that is a manifest amendment. v6 is a stub and must not be preserved as if it were a reference.
- **F. Sanitization note for QK-VIS-001.** The mocks contain example personal data the plan's Task 1 grep will catch: `bruno@example.com`, "Bruno M."/"Ana M." avatars, and `github.com/example/quirks/pull/18` (v5). Replace with neutral placeholders while "preserving layout and design intent" per plan Task 1 Step 3.
- **G. Token drift.** v3 `--ink:#172033` vs v4/v5 `--ink:#182230`; the plan's Task 4 tokens resolve to `#182230`. Record `#182230` as canonical in the implementation; VIS-003 comparisons of v3 must tolerate this 1-step drift.

---

## 7. Linked references

**Wireframes — current local paths (ignored brainstorm tree; local evidence only until QK-VIS-001 preserves them):**

- `.superpowers/brainstorm/66657-1784583568/content/approval-layout-options.html` (v1, decision provenance)
- `.superpowers/brainstorm/66657-1784583568/content/approval-layout-refined-v2.html` (v2, decision provenance)
- `.superpowers/brainstorm/66657-1784583568/content/approval-workspace-responsive-v3.html` (v3, fidelity-bearing)
- `.superpowers/brainstorm/66657-1784583568/content/tasks-and-campaign-history-v4.html` (v4, fidelity-bearing)
- `.superpowers/brainstorm/78851-1784637579/content/task-provenance-history-v5.html` (v5, fidelity-bearing)
- `.superpowers/brainstorm/78851-1784637579/content/continuing-in-terminal-v6.html` (v6, stub — open thread)

**Future canonical tracked paths (created by QK-VIS-001 / plan Task 1, cataloged in `docs/visual-references/quirks-ui/manifest.json`, verified at viewports 1280x800 and 390x844):**

- `docs/visual-references/quirks-ui/approval-workspace-v3.html`
- `docs/visual-references/quirks-ui/tasks-and-campaign-history-v4.html`
- `docs/visual-references/quirks-ui/task-provenance-history-v5.html`
- `docs/visual-references/quirks-ui/manifest.json`

v1, v2, and v6 intentionally receive no canonical path (§6.E).

**claude.ai design project:** "quirks · control plane screens" (id `79a2acf2-3d54-416d-b87a-6b54bd1e29bc`), files under `wireframes/`: `approval-layout-options-v1.html`, `approval-layout-refined-v2.html`, `approval-workspace-v3.html`, `tasks-and-campaign-history-v4.html`, `task-provenance-history-v5.html`, `continuing-in-terminal-v6.html`.

**Governing documents:**

- `docs/superpowers/specs/2026-07-22-visual-reference-materialization-design.md` (the reference contract; §10 mandates this recovery)
- `docs/superpowers/plans/2026-07-22-visual-reference-materialization.md` (Tasks 1–5 → QK-VIS-001/002/003)
- `docs/superpowers/specs/2026-07-20-portable-agent-campaigns-plugin-design.md` (§17 read models, §20 security boundaries, §22 run-start UX and §22.1 stack)
- `docs/superpowers/specs/2026-07-22-contextual-copy-prompts-design.md` (prompt surface contract, §4)

---

## 8. Constraints box (verbatim)

From `AGENTS.md`:

> The UI server binds only to `127.0.0.1`. No environment variables or secrets are required by the UI client. There is no deployment adapter, CDN, or remote asset loading.

> The initial HTML shell contains no projection data. The server injects a fresh nonce into script and style elements. The client is one locally built IIFE bundle with zero external/runtime imports. No remote scripts, styles, fonts, or images.

> TanStack Query cache, Router state, React state, and Form state are disposable projections. Viewer and approval credentials live only in closure-backed vault slots — never in React state/props, Router context/search, Query keys/data/meta, Form values, cookies, `sessionStorage`, or `localStorage`. No TanStack cache or form state becomes canonical campaign or task state.

> No Tailwind, devtools, or remote assets in the client bundle.

> **Explicitly absent:** TanStack Start, Store, Pacer, Virtual, router devtools, Query devtools.

> TanStack Virtual is **not** a v1 dependency. Add it only if the bounded 1,000-row history/table browser fixture cannot meet the approved responsive interaction budget without it. A reproducible Task 18 failure is a plan-amendment trigger, not permission to add Virtual ad hoc.

Pinned browser stack (production dependencies only): `react` 19.2.8, `react-dom` 19.2.8, `@tanstack/react-router` 1.170.18, `@tanstack/react-query` 5.101.4, `@tanstack/react-table` 8.21.3, `@tanstack/react-form` 1.33.2.

From the VIS plan's Global Constraints (`docs/superpowers/plans/2026-07-22-visual-reference-materialization.md`):

> - Visual references are optional; brainstorms without relevant visual artifacts remain valid.
> - An included artifact must name the concrete navigation, hierarchy, density, composition, responsive, or interaction decisions it governs.
> - Tracked visual artifacts use full 40-character commit-pinned references; local artifacts are named honestly in the plan and preserved before durable fidelity evidence is claimed.
> - No task searches `.superpowers/brainstorm/**` heuristically at runtime.
> - `quirks-tasks` and the configured TaskSource remain the only task mutation authority; never edit `.quirks/tasks.json` directly.
> - Visual fidelity remains separate from security, accessibility, responsive fit, interaction correctness, and performance gates.
> - The UI remains loopback-only with split viewer/approval credentials, exact Host/Origin checks, nonce CSP, no remote assets, and no client-owned canonical state.
> - Existing production dependency versions remain pinned; add no visual-regression dependency.
> - Implementation uses red → green → refactor, preserves unrelated changes, and ends each task with focused verification and a focused commit.

---

## 9. Suggested execution order

The task queue already holds the chain (all `proposed`): **QK-VIS-001** "Propagate optional visual references through brainstorm task materialization" (depends on QK-PRM-001; bundles plan Tasks 1–3: preservation + manifest, skill contracts, materialization propagation) → **QK-VIS-002** "Align the shipped Quirks UI with approved visual references" (plan Task 4) → **QK-VIS-003** "Verify Quirks UI visual conformance" (plan Task 5).

1. **QK-VIS-001** consumes §2 and §6.F of this handoff: it is the review pass that copies v3/v4/v5 to `docs/visual-references/quirks-ui/`, sanitizes example identities, and writes the manifest whose `governs` lists match §2.3–§2.5 exactly.
2. **QK-VIS-002** consumes §1, §3, and §4 as its work order: shell + tokens + primitives first (plan Task 4 Steps 3–4), then per-view composition in gap-size order — Preflight (§3.5) and Task History (§3.6) are the largest deltas; Existing Tasks/Campaigns (§3.2–§3.3) next; Campaign Detail (§3.4) last via primitives. Respect §6.D: no dead controls.
3. **QK-VIS-003** consumes §6.A/C/D/G: its manual-comparison record should explicitly note prompt surfaces as context-only, the compact-nav and "Runner health" divergences as accepted, the intentionally absent selection/edit-routing controls, and the ink-token drift tolerance.
4. File the small plan amendment from §6.A before VIS-003 baselines are generated; everything else in §6 is documentation-of-divergence, not amendment.

The future-vision items (§5) are outside the VIS chain: §5.1/§5.2 styling lands with QK-VIS-002 only insofar as the primitives allow; the v7 exploration (§5.5) is a new brainstorm producing new references under the now-durable manifest contract.
