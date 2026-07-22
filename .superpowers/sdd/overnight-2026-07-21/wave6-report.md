# Wave 6 overnight report — portable acceptance

**Date:** 2026-07-22  
**Base:** `wave/w5-hosts` @ `47642242cc2973cc5898ce99e9781d517b80d730`  
**Integration branch:** `wave/w6-host-accept`  
**Integration tip:** `9002bc543d73cd873414802e02319f3065e7f8a0` (portable acceptance; smoke lanes continue on same branch)

## Lane results

| Lane | Task | Branch | Tip SHA |
|---|---|---|---|
| QK-HOST-003A | Portable JSON fixture | `wave/qk-host-003a` | `eae15f5bb05eea60c897bcf37d1de2ac77b01e93` |
| QK-HOST-003B | Portable external fixture | `wave/qk-host-003b` | `c775ce4e5e769c7df2e289e7c24014f4b03587cb` |
| QK-HOST-003C | Claude portable acceptance | `wave/qk-host-003c` | `3b8152996677304693e2cab666c54ba328070071` |
| QK-HOST-003D | Codex portable acceptance | `wave/qk-host-003d` | `7bbac81bac14a0d65e4c57bc4388a9e7ca33f08b` |
| QK-HOST-003E | Cursor portable acceptance | `wave/qk-host-003e` | `a13b04b402ff1cf0b102f460babc976c8be31319` |
| QK-HOST-003F | Full portable verification | `wave/qk-host-003f` | `9002bc543d73cd873414802e02319f3065e7f8a0` |

## Delivered

- `test/fixtures/portable/json-repo` — built-in JSON driver end-to-end fixture
- `test/fixtures/portable/external-repo` — external fake-adapter fixture with explicit workflow policy mappings
- Per-host portable acceptance tests (Claude, Codex, Cursor)
- `test/integration/portable-acceptance.test.ts` — nine-cell matrix declaration + package/discovery alignment

## Verification

| Check | Result |
|---|---|
| Portable JSON campaign boundaries | pass |
| Portable external campaign boundaries | pass |
| Per-host portable fixtures | pass |
| Unapproved push blocked; exact approved push succeeds | pass |
| Full `node --test` on dist | pass (432 pass, 4 skipped smoke gates) |

## Boundary verification

- JSON and external adapters share identical preflight/approval/start boundaries
- Portable fixtures prove unapproved remote push does not update bare remote HEAD
- Approved push targets only exact fixture remote/branch
