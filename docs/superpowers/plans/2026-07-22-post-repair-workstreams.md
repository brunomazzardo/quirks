# Post-Repair Workstreams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four implementation gaps between Quirks today and its founding vision: a correct Codex runner, an autonomous multi-wave overnight campaign loop with enforced budgets, a standalone clarity UI entry point, and a script-backed skill surface.

**Architecture:** Each workstream is an independent branch cut from `main` after the hygiene merge, developed TDD-first in an isolated worktree, verified with `pnpm check`, and landed sequentially (WS2 → WS3 → WS4 → WS5) so CLI-surface conflicts resolve in one direction. WS5 depends on WS3's final CLI shape.

**Tech Stack:** TypeScript (tsc 7, ESM, Node ≥24), `node --test`, Ajv-generated validators (`scripts/generate-validators.mjs`), Playwright for browser gates, no new production dependencies.

## Global Constraints

- Never edit `.quirks/tasks.json` or provider files directly; ledger mutations only through `quirks-tasks` request files (`references/task-mutation-requests.md`).
- TDD for every behavior change; `pnpm check` and `git diff --check` green before a workstream is accepted.
- No real host CLI invocations in ungated tests; real probes stay behind `QUIRKS_SMOKE_APPROVED`.
- No new production dependencies; pinned browser stack in `AGENTS.md` is frozen.
- No pushes to any remote; local merges only, `--no-ff`, matching `a16a108` style.
- Findings that reference codex CLI behavior were verified against codex-cli 0.144.1.

---

### Task WS2: Codex runner correctness (ledger: QK-RUN-003)

**Files:**
- Modify: `src/runner/codex.ts` (argv builders, env)
- Modify: `src/runner/dispatcher.ts` (resume result-path handling)
- Modify: `src/runner/liveness.ts` (resume argv call site)
- Modify: `src/runner/cli-runner-port.ts` (sandbox/artifact-dir mapping if argv shape needs job context)
- Create: `schemas/codex-result.schema.json` (mirror of the result envelope contract)
- Modify: `scripts/generate-validators.mjs` only if the new schema must join generated validators
- Modify: `references/runners/codex.md` (currently a 2-line stub — full flag table)
- Modify: `hosts/codex/install.mjs` + `hosts/shared/link-install.mjs` call site (default dir `~/.codex/skills`, keep `QUIRKS_CODEX_PLUGINS_DIR` override)
- Tests: `test/runner/codex-argv.test.ts`, `test/runner/dispatcher.test.ts`, `test/runner/liveness.test.ts`, `test/host/codex-install.test.ts`

**Interfaces:**
- Produces: `buildCodexArgv(job)` emitting, for a fresh run: `exec -m <model> -C <workspace> -s <read-only|workspace-write> --add-dir <artifactDir> -c model_reasoning_effort=<effort> --output-schema <schemaPath> --color never --json -o <resultPath> <promptText>`; sandbox value derived from `capabilities` containing `repository-write` → `workspace-write`, else `read-only`.
- Produces: `buildCodexResumeArgv(job, handle)` emitting `exec -s <sandbox> -c model_reasoning_effort=<effort> --color never --json -o <resultPath> resume <handle> <continuePrompt>` where `continuePrompt` defaults to the exported `CODEX_CONTINUE_PROMPT` constant ("Continue from the current thread state. Re-read the brief at <briefPath>, pick the next highest-value step, and write the result envelope to the declared result path before exiting.").
- Produces: prompt delivery — fresh runs pass the brief **contents** (read at dispatch) or an explicit instruction to read the brief path; pick reading contents at build time in `cli-runner-port.ts` and keep argv under OS limits by truncating over 100 KB briefs to a pointer instruction.
- Produces: session handle captured mechanically from `--json` JSONL events (thread/session id event) into `RunnerJobResult.sessionHandle`, overriding agent self-report; `usage_limit`/interruption classification keyed off JSONL events when present.

**Steps (repeat the TDD cycle per bullet):**

- [ ] Failing tests in `test/runner/codex-argv.test.ts`: fresh argv includes `-s workspace-write` when capabilities include `repository-write`, `-s read-only` otherwise; includes `--add-dir <artifactDir>`, `-c model_reasoning_effort=<effort>`, `--output-schema`, `--color never`, `--json`; prompt positional is brief contents not the brief path. Run `node --test dist/test/runner/codex-argv.test.js` → fails. Implement in `src/runner/codex.ts`. Pass. Commit `fix(runner): map capabilities and effort into codex exec argv`.
- [ ] Failing tests: resume argv retains `-o <resultPath>` and passes `CODEX_CONTINUE_PROMPT` positional; dispatcher no longer classifies codex resume as `missing_result_path`; liveness `resumeJob` uses the new builder. Implement across `codex.ts`, `dispatcher.ts:183-194`, `liveness.ts:162`. Commit `fix(runner): make codex resume executable with result contract`.
- [ ] Failing tests: JSONL session-id event populates `sessionHandle` even when the result envelope omits it; envelope/JSONL disagreement prefers JSONL and records a `session_handle_mismatch` note on the result. Implement parser in `codex.ts` (async parse path). Commit `feat(runner): capture codex session handle from --json events`.
- [ ] Add `schemas/codex-result.schema.json` matching the existing result envelope (`status`, `sessionHandle`, `artifactPaths`, `failure`) and pass its path via `--output-schema`; test asserts the flag references an existing file at dispatch time. Commit `feat(runner): enforce codex result envelope via --output-schema`.
- [ ] Failing test in `test/host/codex-install.test.ts`: default codex install root resolves to `~/.codex/skills` (override env unchanged). Implement in `hosts/codex/install.mjs`. Update `references/runners/codex.md` with the full verified flag table (0.144.1). Commit `fix(hosts): install codex skills where codex discovers them`.
- [ ] `pnpm check` green; `git diff --check` clean.

### Task WS3: Autonomous campaign progression (ledger: QK-CTL-005)

**Files:**
- Modify: `src/campaign/supervisor.ts` (multi-wave loop; budget/breaker wiring)
- Modify: `src/campaign/preflight.ts:281` (envelope budgets: configurable `maxConcurrency`, keep defaults)
- Modify: `src/cli/campaign-args.ts` + `src/cli/campaign-commands.ts` (`preflight --max-concurrency <n>`, `start --to-completion` default true / `--single-wave` escape hatch)
- Modify: `src/campaign/budgets.ts` / `src/campaign/circuit-breakers.ts` only if signatures need job-result adapters (prefer adapters in supervisor)
- Tests: `test/campaign/supervisor.test.ts`, `test/campaign/preflight.test.ts`, `test/cli/quirks-campaign.test.ts`, extend `test/integration/campaign-control-plane.test.ts`

**Interfaces:**
- Consumes: `buildExecutionPlan` / `selectRunnableTasks` from `src/campaign/scheduler.ts` (already support concurrency > 1 and lanes — do not modify).
- Produces: `CampaignSupervisor.runToCompletion()` — loop: select runnable → dispatch up to `envelope.budgets.maxConcurrency` concurrently (`Promise.allSettled`) → per result: record into a `BudgetTracker` seeded from envelope budgets → `evaluateCircuitBreakers` with current counters → on `continue` advance to next selection; on `pause_lane` mark lane paused and continue others; on `pause_campaign`/`stop`/`hold` write the matching campaign event + state and return a structured outcome `{ status, completedJobs, pausedLanes, breaker }`. Every dispatched wave journals `wave.started` / `wave.completed` events with the selected task ids.
- Produces: `startApproved()` behavior unchanged for the first wave; `quirks-campaign start` calls `runToCompletion()` unless `--single-wave`.

**Steps:**

- [ ] Failing supervisor test: two-wave DAG fixture (B dependsOn A) with fake runner port completes both tasks in one `runToCompletion()` call; events include two `wave.started`. Implement minimal loop. Commit `feat(campaign): drive multi-wave progression to completion`.
- [ ] Failing test: three independent tasks, `maxConcurrency: 2` → first wave dispatches exactly 2 concurrently (fake runner records overlapping in-flight windows), second wave 1. Implement concurrent dispatch. Commit `feat(campaign): dispatch waves concurrently within envelope budget`.
- [ ] Failing test: budget ceiling (`maxTasks: 1` or wall-clock exhausted via injected clock) stops the loop with `breaker: budget_exceeded` and a `campaign.paused` event; no further dispatch occurs. Wire `BudgetTracker` + `evaluateCircuitBreakers`. Commit `feat(campaign): enforce budgets and breakers during live runs`.
- [ ] Failing test: lane failure threshold pauses only that lane (`pause_lane`), other lanes proceed. Commit `feat(campaign): isolate lane pauses during progression`.
- [ ] Failing preflight + CLI tests: `--max-concurrency 3` lands in the envelope (digest changes), rejected when < 1; `start --single-wave` preserves old behavior. Commit `feat(cli): expose campaign concurrency and single-wave controls`.
- [ ] Integration test extension: end-to-end preflight→approve→start on a fixture repo with fake runners completes a 3-task DAG unattended and writes provenance. Commit. `pnpm check` green.

### Task WS4: Front door — brainstorm materialization + standalone UI (ledger: QK-PRM-001 slice + QK-UI-005)

Part A executes the **existing** approved plan `docs/superpowers/plans/2026-07-22-contextual-copy-prompts.md` (QK-PRM-001) — follow that plan's own task list; do not duplicate it here.

Part B (QK-UI-005) makes the clarity views reachable without a campaign:

**Files:**
- Modify: `src/ui/open-workspace.ts` (allow opening without `--campaign`: read-only mode, no approval token issuance)
- Modify: `src/cli/campaign-args.ts` / `campaign-commands.ts` (`ui open` with optional `--campaign`; `--read-only` implied when absent)
- Modify: `src/ui/router.ts` (approval POST returns 409 `read_only_workspace` when no campaign bound)
- Tests: `test/cli/quirks-campaign-ui.test.ts`, `test/ui/authority.test.ts`, new `test/browser/ui-standalone.spec.ts`

**Interfaces:**
- Produces: `quirks-campaign ui open` (no `--campaign`) serving Existing Tasks / Task History / Plan Progress views against the repository's task source, with Campaigns/Preflight views listing historical campaigns read-only; viewer session auth unchanged; approval endpoints disabled (409) — the security boundary tests must still pass unchanged.

**Steps:**

- [ ] Failing CLI test: `ui open` without `--campaign` succeeds, prints the loopback URL, and marks the workspace `readOnly: true`. Implement arg relaxation + workspace flag. Commit `feat(ui): open the control workspace without a campaign`.
- [ ] Failing router test: approval POST on a read-only workspace → 409 `read_only_workspace`; all GET read-model routes serve. Commit `feat(ui): serve read-only projections without approval surface`.
- [ ] Playwright `ui-standalone.spec.ts`: standalone workspace renders Existing Tasks with the fixture ledger and Plan Progress for a fixture task; no approval affordance visible. Commit `test(browser): cover standalone read-only workspace`.
- [ ] `pnpm check` green + `npx playwright test` green.

### Task WS5: Script-backed skill surface (ledger: QK-SKL-006, dependsOn QK-CTL-005)

**Files:**
- Modify: `src/cli/quirks-tasks.ts` + `src/cli/args.ts` (`claim-candidate --json`)
- Modify: `src/cli/campaign-commands.ts` + `campaign-args.ts` (`resume-candidate --json`)
- Modify: `skills/executing-tasks/SKILL.md`, `skills/running-agent-campaigns/SKILL.md`, `skills/updating-tasks/SKILL.md` (exact command lines; branch on helper output)
- Modify: `scripts/validate-skills.mjs` (assert every backticked `quirks-tasks`/`quirks-campaign` subcommand named in skills exists in the CLI parser tables)
- Tests: `test/cli/quirks-tasks.test.ts`, `test/cli/quirks-campaign.test.ts`, `test/skills/structure.test.ts`

**Interfaces:**
- Produces: `quirks-tasks claim-candidate --json` → `{ ok, available: boolean, task?: { id, title, status, dependsOnSatisfied: true }, reason?: "no_ready_tasks" | "pending_sync" }` choosing the highest-priority `ready` task whose dependencies are all `completed`.
- Produces: `quirks-campaign resume-candidate --json` → `{ ok, available: boolean, campaign?: { id, status, lastEvent }, reason?: "no_resumable_campaign" }` scanning the campaign store for non-terminal campaigns.
- Skills reference these with one exact command line per decision point and instruct: run, branch on `available`, never infer from prose.

**Steps:**

- [ ] Failing CLI test: fixture with two ready tasks (one dependency-blocked) → `claim-candidate` returns the eligible one; empty ledger → `available: false, reason: "no_ready_tasks"`. Implement read-only selection (no mutation, no request file). Commit `feat(cli): expose deterministic claim candidate query`.
- [ ] Failing CLI test: store with a `paused` campaign → `resume-candidate` returns it; only terminal campaigns → `available: false`. Commit `feat(cli): expose deterministic resume candidate query`.
- [ ] Update the three skills: every mechanical step carries its exact command line; decision points consume helper JSON. Extend `validate-skills.mjs` cross-check; failing first via a deliberately wrong subcommand fixture in `test/skills/structure.test.ts`. Commit `feat(skills): bind skill steps to exact CLI queries`.
- [ ] `pnpm check` green.

---

## Landing order and review

1. WS2 → merge `--no-ff` to `main` after independent review of the full branch range.
2. WS3 → rebase on updated `main`, review, merge.
3. WS4 → same; Playwright suite must run.
4. WS5 → written against WS3's landed CLI; review, merge.
5. Ledger: claim/complete each QK task through `quirks-tasks` request files with provenance referencing the merge commits; aggregate parents stay untouched.

Self-review notes: interfaces above name exact subcommands/flags consumed by later workstreams; WS5 is the only cross-dependency. No placeholder steps remain — each step names its failing test, implementation site, and commit message.
