# FINAL CAMPAIGN REPORT — Overnight 2026-07-21 (Waves 0–7)

**Date:** 2026-07-22  
**Campaign:** Quirks v1 overnight self-build  
**Starting `main`:** `82819493021397fbe8aa640e6577a836ca9e32e5`  
**Final `main` tip:** `753a6f700248cbc97b655396d9863cde08ca8c4e`  
**Push status:** **not pushed** (local `main` ahead of `origin/main`)

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
| 7 | Release gate | merged to `main` | `2642ab5ccea99807d5f01ad5212a760e5d5076d2` | `wave7-report.md` |

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

### Wave 7
- `QK-HOST-004A` `eb745e16a03a9f1f5efaedef3cd88dbfa15f4f1a` (blocked)
- `QK-HOST-004B` `2c2d1d6ad0915a1a9ed8b63282272a9457b850c1` (blocked)
- `QK-HOST-004C` `4ac83b75c31318ccf92ffce6df15ea74d6c19fb4` (blocked)
- `QK-HOST-005A` `d4ce34564c982048abfa571fb1f0c74b57da7f6f` (blocked)
- `QK-HOST-005B` `2642ab5ccea99807d5f01ad5212a760e5d5076d2` (blocked)
- `QK-RELEASE-REV` approve-with-nits — `.superpowers/sdd/overnight-2026-07-21/wave7/qk-release-rev-report.md`

## Verification (final `main`)

| Check | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm validate:skills` | pass |
| `node --test --test-concurrency=2` (dist) | 432 pass, 4 skipped (gated smoke) |

## Blocked / deferred

| Item | Reason |
|---|---|
| 9× real host/runner smoke cells | Missing credentials; `QUIRKS_SMOKE_APPROVED` not set |
| Marketplace install verification | `approve-marketplace-install` gate |
| Bounded real campaign | `approve-exact-campaign` gate |
| Remote push | Not requested; local only |

## Dogfood findings

1. **External portable fixtures** require explicit `nativeStatusMap`, `evidenceMap`, and `allowedCompletionBoundaries` in `.agents/quirks.json` — JSON-driver defaults do not apply.
2. **Landing push validation** runs after merge; unapproved push tests must verify remote HEAD unchanged, not assume pre-merge rejection.
3. **Real smoke** remains gated behind env approval; portable fake-runner suites are the CI-safe substitute until a credential-equipped workstation runs the matrix.

## Task provenance

`.quirks/tasks.json` updated with full 40-character commit SHAs for `QK-HOST-002A`–`005B` and `QK-RELEASE-REV`. Plan `sourceRefs` corrected to `docs/superpowers/plans/2026-07-21-quirks-host-packaging.md` @ `3958acba50e9a12f7389cede8fa150a349151cdb`.

## Artifacts

- Wave reports: `.superpowers/sdd/overnight-2026-07-21/wave{5,6,7}-report.md`
- Release review: `.superpowers/sdd/overnight-2026-07-21/wave7/qk-release-rev-report.md`
- Smoke matrix: `docs/smoke/2026-host-matrix.md`
- Bounded campaign: `docs/smoke/bounded-campaign-report.md`
