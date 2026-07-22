# Bounded real campaign report

**Date:** 2026-07-22  
**Status:** passed
**Gate:** `approve-exact-campaign`

## Summary

One bounded private campaign executed with headless digest approval (`createApprovalChallenge` + `consumeApprovalToken`), cross-vendor fake-runner dispatch in the acceptance harness, single-file landing (`src/message.txt`), provenance acknowledgement, and exact push to a disposable bare test remote.

## Evidence (redacted)

| Field | Value |
|---|---|
| Task ID | QK-BOUNDED-001 |
| Changed path | src/message.txt |
| Review outcome | approved |
| Task status | completed |
| Pending sync intents | 0 |
| Approval | headless consumeApprovalToken (createApprovalChallenge) |
| Acceptance harness wall clock | ~1.7s |
| Remote target | origin/quirks-smoke (disposable bare remote) |
| Profile classes | claude implementer / codex reviewer (fake harness) |

## Verification

- `node --test dist/test/smoke/bounded-real-campaign.test.js` — 3/3 pass (~2.0s)
- `pnpm check` — 486 pass, 4 skipped (~95s)

## Notes

- Default unapproved path rejects immediately (`QUIRKS_SMOKE_APPROVED` gate).
- Approved operator script: `QUIRKS_SMOKE_APPROVED=approve-exact-campaign node scripts/quirks-bounded-campaign.mjs --profile PROFILE_ID --remote BARE_REMOTE --branch quirks-smoke --json`
- Ephemeral `profiles.json` is created when `~/.config/quirks/profiles.json` is absent.
