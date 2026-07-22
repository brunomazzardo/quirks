# QK-RELEASE-REV — Release Readiness Review (Waves 5–7)

**Date:** 2026-07-22  
**Reviewer:** Waves 5–7 overnight orchestrator  
**Scope:** `QK-HOST-002A`–`005B`, integration on `main`  
**Decision:** **approve-with-nits**

## Summary

Host packaging, portable acceptance, and gated release infrastructure land without weakening loopback UI security, approval binding, task-source authority, or argv-only Git landing from plans 3–4. Real smoke and bounded campaign cells are explicitly blocked pending credentials and human approval gates.

## Host packaging (Wave 5)

| Check | Result |
|---|---|
| Codex plugin manifest validates canonical `skills/` path | Pass |
| Package scans reject credential-shaped and home-path content | Pass |
| Claude/Cursor installers refuse non-link overwrites | Pass |
| Marketplace manifest has bounded fields, no secrets | Pass |
| Cross-host skill discovery matches `pnpm validate:skills` inventory | Pass |

## Portable acceptance (Wave 6)

| Check | Result |
|---|---|
| JSON fixture completes preflight → approval → start boundaries | Pass |
| External fixture shares identical campaign boundaries | Pass |
| Unapproved push does not update remote HEAD | Pass |
| Approved push targets exact remote/branch only | Pass |
| Per-host portable fixtures reach preflight without network | Pass |

## Release gate (Wave 7)

| Check | Result |
|---|---|
| Nine-cell smoke matrix documented with dated blocked rows | Pass (blocked) |
| Gated smoke tests skip without approval env | Pass |
| No credentials committed or logged | Pass |
| Bounded campaign report records blocked status | Pass (blocked) |

## Blocking issues

None for merge. Real smoke and bounded campaign remain **deferred** until credential-equipped workstation and approval env vars are available.

## Required follow-ups (non-blocking)

1. Run nine-cell real smoke matrix with `QUIRKS_SMOKE_APPROVED=approve-paid-runner-probes` and update `docs/smoke/2026-host-matrix.md` with host/runner versions.
2. Execute marketplace install verification with `QUIRKS_SMOKE_APPROVED=approve-marketplace-install`.
3. Complete one bounded real campaign with `QUIRKS_SMOKE_APPROVED=approve-exact-campaign` and update `docs/smoke/bounded-campaign-report.md`.
4. Wire `LandingPort` into `CampaignSupervisor` landing transition (Wave 4 nit, still open).
