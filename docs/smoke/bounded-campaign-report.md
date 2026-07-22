# Bounded real campaign report

**Date:** 2026-07-22  
**Status:** harness-only (operator blocked)  
**Gate:** `approve-exact-campaign`

## Summary

Harness validates full bounded-campaign orchestration with fake runners, disposable bare remote wiring, digest approval, cross-vendor routing, single-file landing, provenance acknowledgement, and exact push equality. One operator attempt with real Claude implementer reached the reviewer phase but blocked when Codex models are unsupported on the local ChatGPT-linked account.

## Evidence (redacted)

| Field | Harness (fake runners) | Operator (real implementer) |
|---|---|---|
| Campaign ID | cmp-63eb39e86955 | not completed |
| Task ID | QK-BOUNDED-001 | QK-BOUNDED-001 |
| Task status | completed | blocked at reviewer |
| Changed path | src/message.txt | implementer phase reached |
| Accepted commit | 7f022d8b9294fa50f6bca1cbfb3e791b8223f762 | not completed |
| Remote HEAD | 7f022d8b9294fa50f6bca1cbfb3e791b8223f762 | not completed |
| Remote HEAD equals accepted commit | yes | n/a |
| Review outcome | approved | not reached |
| Pending sync intents | 0 | n/a |
| Approval | headless consumeApprovalToken (createApprovalChallenge) | same gate |
| Profile classes | claude implementer / codex reviewer (fake) | claude implementer (real) / codex reviewer (blocked) |
| Model classes | bounded-claude / bounded-codex | sonnet / o3 |
| Provenance acknowledgement | yes (task completed) | not reached |
| Wall clock | ~2.3s | ~55s (reviewer failure) |

## Verification

- `node --test dist/test/smoke/bounded-real-campaign.test.js` — 4/4 pass (~4.3s), including bare-remote wiring without pre-setup
- Operator: `QUIRKS_SMOKE_APPROVED=approve-exact-campaign node scripts/quirks-bounded-campaign.mjs --profile bounded-implementer-claude --remote <disposable-bare> --branch quirks-smoke --json` — blocked at reviewer (`Codex model unsupported on ChatGPT account`)

## Notes

- `runBoundedCampaign` now wires `bareRemote` via `wireFixtureToBareRemote` (remote add + initial push when needed).
- Default unapproved path rejects immediately (`QUIRKS_SMOKE_APPROVED` gate).
- Human operators may use `quirks-campaign ui open` for digest approval; harness uses headless `createApprovalChallenge` + `consumeApprovalToken`.
