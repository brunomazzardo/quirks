# Quirks — agent guidance

## Repository purpose and authority

Quirks is a project-agnostic local control plane for planning, dispatching, observing, reviewing, and auditing agent work across repositories. It is a standalone plugin/CLI/loopback UI, not project-specific infrastructure code.

- `TaskSource` is the task authority boundary. JSON is the first implementation; external issue providers are adapters. Never edit `.quirks/tasks.json` or a provider file directly.
- Git and the selected task provider remain authoritative for source, commits, PRs, and canonical status. Quirks performs semantic mutations and durable sync; UI/client state is only a projection.
- Specs, plans, commits, PRs, and reports are referenced by path/commit/URL. Do not copy their full bodies into task JSON.
- Real external execution must be bound to an approved campaign envelope, configured runner profile, budget, worktree, and independent review.

## Current state (2026-07-25, post managing-agent runner layer)

The managing-agent runner layer `QK-RUN-009` is merged to `main` (merge
`667a3a8`) and unpushed. The runner now
splits in two: a launcher that only knows how to start codex, cursor, and claude
correctly, and a managing agent — one sonnet subprocess per job — that reads the
retained transcript and produces the structured `RunnerJobResult`. No CLI is
asked for an envelope any more, and `--output-schema` is gone rather than
optional. Evidence: `docs/smoke/2026-07-25-managing-agent-probe.md`.

The honesty properties this rests on, in the order they matter:

- The agent reports what a runner said. It never judges the work and cannot accept.
- A verdict must quote the runner's own words, and Quirks verifies the quote
  against the retained transcript: only the runner's own messages count (not the
  brief it read), a quote must begin where a statement begins, and an `accept`
  may not rest on words a refusal was leading up to.
- Absence fails closed to `indeterminate`. Nothing maps absence to `accept`.
- The transcript is always retained, including when a run times out or floods.
- The agent launches with `--tools ""`, no MCP, no settings, and no skills, so
  read-only is mechanical rather than promised — and costs $0.0049 instead of
  $0.145 a call.

The real-CLI runner repair `QK-RUN-007`/`QK-RUN-008` is merged to `main` (merge `e65be67`). Its defects are worth knowing, because they set the standard for what counts as evidence here: cursor was sent a `--file` flag that does not exist; claude's brief was swallowed by a variadic `--add-dir`; claude depended on a machine-local `verbose` setting; claude had no result contract and a shared result path; a reviewer's verdict had no channel, so `revise` was retried as a crash until the budget drained; no runner was bound to its worktree; a stale envelope could make a failed run succeed. **Every one was invisible to a fully green test suite.**

Honest remaining gaps — do not claim a release until these clear:

- The `QK-RUN-009` real-CLI gate covers **6 of 9 profiles** (9 of 14 cells, since reviewers are probed on both verdicts). codex is usage-limited until Jul 28 2026 2:02 PM, so its five cells are owed, never passing. The strict-path deletion has also not been reviewed by codex, which found the most across the five rounds that informed the runner repair — and four review rounds on this change each found something the previous round missed.
- Real host×runner smoke matrix best recorded run is 4/9 cells passed (`docs/smoke/2026-host-matrix.md`); ledger tasks `QK-HOST-004A/B/C` stay `blocked`. This predates the runner repair and is worth re-running.
- The bounded real campaign is harness-only (`docs/smoke/bounded-campaign-report.md`); `QK-HOST-005A/B` and `QK-RELEASE-REV` stay `blocked`.
- Campaign completion is memory-only: a run reports `completed` while the durable campaign stays `running` and its tasks stay `claimed`, and budgets reset every invocation (`QK-CTL-012`, P0). Do not trust a reported completion as durable state.
- `QK-RUN-007`/`QK-RUN-008` are merged but still sit at `proposed` in the ledger; there is no clean CLI path to close a task done outside a campaign.
- The capability model is not an enforcement boundary: `repository-write` maps to claude's `--dangerously-skip-permissions` and cursor's bare `--force` (`QK-RUN-011`).

Nothing has been pushed to any remote. The push gate remains the owner's.

Until the transition criteria in `references/dogfood.md` pass, use the documented Superpowers bootstrap for parent orchestration. Quirks CLIs remain the only mechanical task/campaign authority.

Active workstreams are planned in `docs/superpowers/plans/2026-07-22-post-repair-workstreams.md`. The managing-agent runner layer is specified in `docs/superpowers/specs/2026-07-24-managing-agent-runner-design.md` and planned in `docs/superpowers/plans/2026-07-24-qk-run-009-managing-agent-runner.md`; its design gate is closed with the owner's three decisions.

## Evidence standard for runner work

Fake-runner tests cannot observe CLI flag validity, sandbox behaviour, or output shape. Five independent cross-vendor review rounds informed the runner repair and **each one found something the previous round missed**, including two defects introduced while fixing earlier findings.

- Never accept runner work on fake-runner evidence alone. Probe the real binaries by building argv with the production `buildRunnerArgv` and executing it.
- A green exit code is not a green result: inspect the envelope body, not just the status.
- `--output-schema` suppresses codex's reasoning entirely. Measured: 0 prose messages with it, 8 without. It is now **dropped from the launcher and must stay dropped** — do not constrain a reviewer's final message and then wonder where its findings went.
- Interpretation is a model reading a transcript, so it varies. Measure it rather than assuming: the same codex usage-limit transcript was classified `failure` in one run and `usage_limit` in the next until the brief named the specific values, after which 5/5 runs agreed.
- Runner transcripts are retained as redacted job evidence; read them when a verdict looks unexplained.

## Required development discipline

- Preserve unrelated user changes and use an isolated worktree for repair work.
- Use TDD for behavior changes and require a fresh independent review of the complete per-task commit range.
- Resolve every Critical/Important finding before accepting a task. A worker summary is not completion evidence.
- Run `pnpm check` and `git diff --check` before accepting code. Run relevant Playwright and real smoke gates at their owning layer.
- Never substitute fake adapters, skipped tests, stubs, or documents for an authorized real release gate.
- Do not expose credentials or raw provider output in logs/artifacts. No production/destructive action, force push, or campaign expansion without explicit authority.
- Do not push to any remote before the owning plan's reviewed push gate.

## Local control UI guidance

## Pinned browser stack (production dependencies only)

| Package | Version |
|---|---|
| `react` | 19.2.8 |
| `react-dom` | 19.2.8 |
| `@tanstack/react-router` | 1.170.18 |
| `@tanstack/react-query` | 5.101.4 |
| `@tanstack/react-table` | 8.21.3 |
| `@tanstack/react-form` | 1.33.2 |

Dev-only tooling (not runtime): `esbuild@0.25.9`, `@types/react@19.2.17`, `@types/react-dom@19.2.3`. Playwright (`@playwright/test@1.54.2`) and TanStack CLI/Intent are one-shot development tools invoked at exact recorded versions — they are not production dependencies.

**Explicitly absent:** TanStack Start, Store, Pacer, Virtual, router devtools, Query devtools.

## Disposable TanStack CLI reference (do not copy into Quirks)

```bash
tanstack_reference_dir="$(mktemp -d)/quirks-ui-reference"
pnpm dlx @tanstack/cli@0.69.6 create quirks-ui-reference \
  --router-only --framework React --package-manager pnpm --toolchain biome \
  --no-examples --no-git --intent --target-dir "$tanstack_reference_dir" -y
```

Inspect the scratch `package.json`, bootstrap, route registration, and generated agent guidance. **Do not copy** the scratch directory or `.cta.json` into Quirks.

### Deliberate divergences from the CLI reference

- Quirks keeps its existing **Oxlint + esbuild** toolchain (not Biome/Vite).
- **Code-based five-route tree** registered in TypeScript (not file-based route generation / `tsr generate`).
- **Framework-independent Node `http` server** serves a nonce-injected single IIFE bundle (no TanStack Start, no Vite dev server, no framework-owned API routes).
- No Tailwind, devtools, or remote assets in the client bundle.

**Stack decision (ratified 2026-07-23, owner):** stay on this framework-independent stack — no migration to TanStack Start, Next, or Bun. The daemon/dashboard needs no SSR, server functions, or file routing; a framework would expand surface, not consolidate it. Dev speed comes from esbuild watch + the standing-server bundle reload, not a framework dev server. Do not re-propose a framework migration unless one of these becomes true: the app needs to ship beyond the local machine (hosted/multi-user/real auth), it needs true server-side rendering, or the route tree outgrows code-based wiring. See `docs/superpowers/specs/2026-07-24-always-on-workspace-server-design.md`.

## TanStack Intent (development tooling only)

```bash
pnpm dlx @tanstack/intent@0.3.6 install --map
pnpm dlx @tanstack/intent@0.3.6 list --json
```

`package.json#intent.skills` is an explicit four-package allow-list — no `"*"` or `"@tanstack/*"` wildcards; transitive packages do not gain instruction authority.

### Shipped skills at pinned versions

`install --map` produced no `load` commands for the allow-listed packages:

- `@tanstack/react-router@1.170.18` — **no shipped skill discovered**
- `@tanstack/react-query@5.101.4` — **no shipped skill discovered**
- `@tanstack/react-table@8.21.3` — **no shipped skill discovered**
- `@tanstack/react-form@1.33.2` — **no shipped skill discovered**

Do not broaden the allow-list to find skills. Newly discovered skill sources require a reviewed allow-list change.

<!-- intent-skills:start -->
<!-- intent-skills:end -->

## Architecture constraints for UI work

### Code-based routing

TanStack Router owns five fixed local views with typed URL/search state. Routes are declared in code (not filesystem conventions) to match the exact loopback Host, token, nonce-CSP, and approval rules. TanStack Start, SSR, streaming, and framework server functions are intentionally absent.

### Loopback-only / no deployment

The UI server binds only to `127.0.0.1`. No environment variables or secrets are required by the UI client. There is no deployment adapter, CDN, or remote asset loading.

### CSP / no remote assets

The initial HTML shell contains no projection data. The server injects a fresh nonce into script and style elements. The client is one locally built IIFE bundle with zero external/runtime imports. No remote scripts, styles, fonts, or images.

### No client canonical state

TanStack Query cache, Router state, React state, and Form state are disposable projections. Viewer and approval credentials live only in closure-backed vault slots — never in React state/props, Router context/search, Query keys/data/meta, Form values, cookies, `sessionStorage`, or `localStorage`. No TanStack cache or form state becomes canonical campaign or task state.

### Virtual performance gate (Task 18)

TanStack Virtual is **not** a v1 dependency. Add it only if the bounded 1,000-row history/table browser fixture cannot meet the approved responsive interaction budget without it. A reproducible Task 18 failure is a plan-amendment trigger, not permission to add Virtual ad hoc.
