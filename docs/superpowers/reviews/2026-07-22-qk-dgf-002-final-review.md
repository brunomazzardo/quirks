# QK-DGF-002 final release review checklist

Independent reviewer: verify the complete `codex/qk-dgf-002` branch against design sections **16.1**, **23.5**, **23.6**, and **24** before any `origin/main` push.

## Git and release candidate

- [ ] Review branch is `codex/qk-dgf-002`; base `ab054155a99bbc89750fb324e4f354d6261a9b18`
- [ ] Release candidate commit recorded in reconciliation notes matches the reviewed tip (not a self-referential `main` tip)
- [ ] `git merge-base --is-ancestor <base> <RC>` holds for every accepted task commit
- [ ] No force-push, history rewrite, or unrelated worktree contamination
- [ ] Push gate: push **only** the exact reviewed RC SHA to `origin/main` after all items below pass

## Credential and secret hygiene

- [ ] `git diff` / reports contain no tokens, API keys, or raw provider transcripts
- [ ] Smoke evidence JSON and matrix rows are redacted (no home paths, no credential-shaped strings)
- [ ] Bounded campaign report uses harness/operator tables without secrets

## Implementation gates (must pass on RC)

- [ ] `pnpm check` — lint, typecheck, validate:skills, full test suite
- [ ] `pnpm exec playwright test` — 23/23 loopback UI tests
- [ ] `node --test dist/test/integration/task-truth-reconciliation.test.js` — canonical truth audit green
- [ ] `node --test dist/test/smoke/*.test.js` unapproved — fail-closed (blocked paths)
- [ ] Approved smoke subsets pass with documented env gates (`approve-paid-runner-probes`, `approve-marketplace-install`, `approve-exact-campaign`)

## External / honest gates (blocked items must stay blocked in task ledger)

- [ ] Host matrix: 4 passed / 5 blocked per `docs/smoke/2026-host-matrix.md` — no task claiming full 9/9 pass
- [ ] Marketplace: sandbox cycle + one approved real install/uninstall evidence (see repair plan Task 5 slice)
- [ ] Bounded campaign: harness 4/4 green; operator honestly blocked at Codex reviewer — no full operator pass claim (`docs/smoke/bounded-campaign-report.md`)
- [ ] Overnight Wave 7 children (`QK-HOST-004A`–`005B`, `QK-RELEASE-REV`): status `blocked` with corrective provenance superseding false completions

## TaskSource parity

- [ ] `./scripts/quirks-tasks sync --json` → `pending: 0`
- [ ] `QK-DGF-002A`–`002G` and umbrella `QK-DGF-002` completed with provenance-bound reviews
- [ ] No direct `.quirks/tasks.json` hand-edits; mutations acknowledged through CLI
- [ ] Aggregate parents not left `proposed` when all slice children legitimately `completed`
- [ ] Commit-bound review artifact: `docs/superpowers/reviews/2026-07-22-qk-dgf-002-final-review.md` (this file)

## Architecture boundary (plan verification)

- [ ] No production path constructs `FakeCliRunnerPort` / `LocalWorktreePort` without explicit test injection
- [ ] All nine matrix cells originate from installed host integrations (honest blocked outcomes allowed)
- [ ] Shipped skill references resolve inside the package (`pnpm validate:skills`)
- [ ] `quirks-tasks` exposes full mutation surface used during repair

## Landing procedure (reviewer only)

1. Merge reviewed `codex/qk-dgf-002` to local `main`
2. Rerun `pnpm check` on merged `main`
3. Push exact approved `main` SHA to `origin` (human approval required)
4. Append provenance if RC advances during review fixes — never rewrite prior iterations

## Known concerns (non-blocking if honestly recorded)

- Codex-as-host matrix cells blocked on ChatGPT-linked accounts without API model access
- Bounded campaign operator requires Codex-capable reviewer account or alternate routing
- `origin/main` not pushed in implementer pass — this checklist is the push gate
- Implementer reconciliation summary: `docs/superpowers/reviews/2026-07-22-qk-dgf-002-reconciliation.md`
