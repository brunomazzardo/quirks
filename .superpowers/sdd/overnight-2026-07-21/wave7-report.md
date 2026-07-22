# Wave 7 overnight report — external release gate

**Date:** 2026-07-22  
**Base:** `wave/w6-host-accept` @ `9002bc543d73cd873414802e02319f3065e7f8a0`  
**Final merge tip (pre-provenance):** `2642ab5ccea99807d5f01ad5212a760e5d5076d2`

## Lane results

| Lane | Task | Branch | Tip SHA | Outcome |
|---|---|---|---|---|
| QK-HOST-004A | Claude smoke cells | `wave/qk-host-004a` | `eb745e16a03a9f1f5efaedef3cd88dbfa15f4f1a` | blocked |
| QK-HOST-004B | Codex smoke cells | `wave/qk-host-004b` | `2c2d1d6ad0915a1a9ed8b63282272a9457b850c1` | blocked |
| QK-HOST-004C | Cursor smoke cells | `wave/qk-host-004c` | `4ac83b75c31318ccf92ffce6df15ea74d6c19fb4` | blocked |
| QK-HOST-005A | Marketplace install | `wave/qk-host-005a` | `d4ce34564c982048abfa571fb1f0c74b57da7f6f` | blocked |
| QK-HOST-005B | Bounded real campaign | `wave/qk-host-005b` | `2642ab5ccea99807d5f01ad5212a760e5d5076d2` | blocked |
| QK-RELEASE-REV | Release readiness review | — | see `wave7/qk-release-rev-report.md` | approve-with-nits |

## Blocked items

All nine real host/runner matrix cells blocked: missing local host credentials and `QUIRKS_SMOKE_APPROVED=approve-paid-runner-probes`. Evidence recorded in `docs/smoke/2026-host-matrix.md`.

Marketplace install verification blocked: `QUIRKS_SMOKE_APPROVED=approve-marketplace-install` not set. Gated test skips cleanly in CI.

Bounded real campaign blocked: `QUIRKS_SMOKE_APPROVED=approve-exact-campaign` not set. Report at `docs/smoke/bounded-campaign-report.md`.

## Delivered despite blocks

- Gated smoke test harnesses under `test/smoke/` (skip without approval env)
- Dated matrix template with blocked rows for all nine cells
- Bounded campaign blocked-status report
- Portable fake-runner acceptance from Wave 6 covers control-plane boundaries until real smoke runs

## Verification

| Check | Result |
|---|---|
| Gated smoke tests (default CI) | 4 skipped, 8 pass (blocked-path assertions) |
| No credentials in artifacts | pass |
| `pnpm check` on merged `main` | pass |
