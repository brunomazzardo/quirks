# FINAL CAMPAIGN REPORT — Overnight 2026-07-21 (Waves 0–7) + QK-DGF-002 repair

**Date:** 2026-07-22
**Campaign:** Quirks v1 overnight self-build + dogfood release repair (`QK-DGF-002`)
**Starting `main`:** `82819493021397fbe8aa640e6577a836ca9e32e5`
**Repair branch:** `codex/qk-dgf-002`
**Release candidate commit:** `a22568306fca7ea3d7886e010050fe4206094809` (pre–Task 7 reconciliation; see task ledger for post-reconciliation RC)
**Pushed `origin/main`:** **not pushed** (local repair branch ahead of `origin/main`; reviewed push gate deferred to Task 7 Step 6)

## Implementation gates vs external gates

| Gate class | Scope | Result |
|---|---|---|
| Implementation (`pnpm check`, unit/integration) | Repo CI-safe | pass on repair branch |
| Playwright loopback UI | Local control plane | pass (23/23 pre-repair; re-run at Task 7) |
| Nine-cell host/runner matrix | Real installed CLIs | **4 passed / 5 blocked** (honest; see `docs/smoke/2026-host-matrix.md`) |
| Marketplace install/discovery | Sandbox + one approved real install | pass |
| Bounded campaign harness | Fake runners + bare remote | pass (4/4) |
| Bounded campaign operator | Real Claude implementer | **blocked** at Codex reviewer (account/models) |
| Overnight Wave 7 release children | Smoke/marketplace/campaign claims | **blocked** — falsely marked completed; corrected in Task 7 |
| `origin/main` push | Reviewed landing | **deferred** — independent review + exact SHA push only |

## Wave summary

| Wave | Focus | Integration branch | Tip SHA | Report |
|---|---|---|---|---|
| 0 | Bootstrap | — | `8281949…` (base) | `wave0-report.md` |
| 1 | Foundation task sources | `wave/w1-foundation` | see `wave1-report.md` | `wave1-report.md` |
| 2 | Campaign control plane | — | see `wave2/` | `wave2/` |
| 3 | Skills + Git isolation | `wave/w3-skills-git` | `8281949…` ancestry | `wave3-report.md` |
| 4 | Parent skills + landing | — | `8281949…` ancestry | `wave4/` |
| 5 | Host packaging | `wave/w5-hosts` | `47642242cc2973cc5898ce99e9781d517b80d730` | `wave5-report.md` |
| 6 | Portable acceptance | `wave/w6-host-accept` | `9002bc543d73cd873414802e02319f3065e7f8a0` | `wave6-report.md` |
| 7 | Release gate | merged to local `main` (stale claim) | `2642ab5ccea99807d5f01ad5212a760e5d5076d2` | `wave7-report.md` |
| Repair | `QK-DGF-002` dogfood truth | `codex/qk-dgf-002` | see release candidate above | `.superpowers/sdd/task-*-report.md` |

## Waves 5–7 lane tips (40-char SHAs)

### Wave 5
- `QK-HOST-002A` `e1183162379c58000d55363c9c7f24a86dbaf95a`
- `QK-HOST-002B` `d37cdd9474a53c6efbbd5c493745b05963499c7c`
- `QK-HOST-002C` `1c989030076b1ea72428f438c6421c07eb0d9140`
- `QK-HOST-002D` `e9dd36ae15b48cb3bbc7c923492c631368d2f791`
- `QK-HOST-002E` `edb60ac6f494f1c18ba33ea5b927be3a0807c1da`
- `QK-HOST-002F` `47642242cc2973cc5898ce99e9781d517b80d730`

### Wave 6
- `QK-HOST-003A` `eae15f5bb05eea60c897bcf37d1de2ac77b01e93`
- `QK-HOST-003B` `c775ce4e5e769c7df2e289e7c24014f4b03587cb`
- `QK-HOST-003C` `3b8152996677304693e2cab666c54ba328070071`
- `QK-HOST-003D` `7bbac81bac14a0d65e4c57bc4388a9e7ca33f08b`
- `QK-HOST-003E` `a13b04b402ff1cf0b102f460babc976c8be31319`
- `QK-HOST-003F` `9002bc543d73cd873414802e02319f3065e7f8a0`

### Wave 7 (corrected — blocked, not completed)
- `QK-HOST-004A` — blocked (stub smoke gate)
- `QK-HOST-004B` — blocked (stub smoke gate)
- `QK-HOST-004C` — blocked (stub smoke gate)
- `QK-HOST-005A` — blocked (marketplace gate stub)
- `QK-HOST-005B` — blocked (bounded campaign gate stub)
- `QK-RELEASE-REV` — blocked (release review without real gates)

## Verification (repair branch)

| Check | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm validate:skills` | pass |
| `node --test` (dist) | pass (post-repair count; 4 smoke skipped unapproved) |
| `pnpm exec playwright test` | pass at Task 7 gate |
| `auditTaskTruth` integration | pass after Task 7 reconciliation |

## Blocked / deferred (post-repair honesty)

| Item | Reason |
|---|---|
| 5/9 host/runner matrix cells | Credential/host timeout/Codex-as-host model cache (see matrix) |
| Bounded campaign operator | Codex reviewer models unsupported on ChatGPT-linked account |
| Overnight Wave 7 child completions | Superseded by corrective provenance in Task 7 |
| `origin/main` push | Awaiting independent release review (Task 7 Step 6) |
| Post-v1 external issue adapters | Out of scope for `QK-DGF-002` |

## Dogfood findings

1. **External portable fixtures** require explicit `nativeStatusMap`, `evidenceMap`, and `allowedCompletionBoundaries` in `.agents/quirks.json` — JSON-driver defaults do not apply.
2. **Landing push validation** runs after merge; unapproved push tests must verify remote HEAD unchanged, not assume pre-merge rejection.
3. **Real smoke** remains gated behind env approval; portable fake-runner suites are the CI-safe substitute until a credential-equipped workstation runs the matrix.
4. **Task truth drift** from Wave 7 overnight orchestrator false completions required CLI-only corrective provenance (Task 7).
5. **Release candidate semantics** — reports must name RC SHAs, not `main` tips that go stale when the report itself is committed.
6. **Codex-as-host** matrix cells blocked on local ChatGPT-linked accounts without Codex API model access.

## Task provenance

`.quirks/tasks.json` reconciled through `quirks-tasks` mutations only: Wave 7 false completions blocked with appended corrective iterations; `QK-DGF-002A`–`002G` and umbrella completed with review-bound provenance on the repair branch. Plan `sourceRefs` for repair: `docs/superpowers/plans/2026-07-22-quirks-dogfood-release-repair.md`.

## Artifacts

- Wave reports: `.superpowers/sdd/overnight-2026-07-21/wave{5,6,7}-report.md`
- Repair reports: `.superpowers/sdd/task-{1..7}-report.md`
- Independent review checklist: `.superpowers/sdd/qk-dgf-002/final-review.md`
- Smoke matrix: `docs/smoke/2026-host-matrix.md`
- Bounded campaign: `docs/smoke/bounded-campaign-report.md`
