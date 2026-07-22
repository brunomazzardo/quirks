# Quirks — agent guidance

## Repository purpose and authority

Quirks is a project-agnostic local control plane for planning, dispatching, observing, reviewing, and auditing agent work across repositories. It is a standalone plugin/CLI/loopback UI, not project-specific infrastructure code.

- `TaskSource` is the task authority boundary. JSON is the first implementation; external issue providers are adapters. Never edit `.quirks/tasks.json` or a provider file directly.
- Git and the selected task provider remain authoritative for source, commits, PRs, and canonical status. Quirks performs semantic mutations and durable sync; UI/client state is only a projection.
- Specs, plans, commits, PRs, and reports are referenced by path/commit/URL. Do not copy their full bodies into task JSON.
- Real external execution must be bound to an approved campaign envelope, configured runner profile, budget, worktree, and independent review.

## Active dogfood release repair

The current repair is `QK-DGF-002` on branch `codex/qk-dgf-002`. On a machine with an existing repair worktree, locate it with `git worktree list` and continue there rather than restarting from `main`.

Before continuing it, read:

1. `docs/handoffs/2026-07-22-qk-dgf-002.md`
2. `docs/superpowers/plans/2026-07-22-quirks-dogfood-release-repair.md`
3. `.superpowers/sdd/progress.md`
4. `references/dogfood.md`

Do not trust the old Wave 7 release summary as proof: the real host/runner, marketplace, and bounded-campaign gates were stubbed or blocked. Finish the seven repair slices and reconcile task truth before making a release claim.

Until the transition criteria in `references/dogfood.md` pass, use the documented Superpowers bootstrap for parent orchestration. Quirks CLIs remain the only mechanical task/campaign authority.

## Required development discipline

- Preserve unrelated user changes and use an isolated worktree for repair work.
- Use TDD for behavior changes and require a fresh independent review of the complete per-task commit range.
- Resolve every Critical/Important finding before accepting a task. A worker summary is not completion evidence.
- Run `pnpm check` and `git diff --check` before accepting code. Run relevant Playwright and real smoke gates at their owning layer.
- Never substitute fake adapters, skipped tests, stubs, or documents for an authorized real release gate.
- Do not expose credentials or raw provider output in logs/artifacts. No production/destructive action, force push, or campaign expansion without explicit authority.
- Do not push `QK-DGF-002` before the plan's final exact reviewed push gate.

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
