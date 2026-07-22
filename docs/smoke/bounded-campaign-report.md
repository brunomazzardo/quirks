# Bounded real campaign report

**Date:** 2026-07-22  
**Status:** blocked  
**Gate:** `approve-exact-campaign`

## Summary

The bounded real campaign (`QK-HOST-005B`) did not run in this overnight session. Local host credentials and paid-runner approval gates were unavailable in the orchestrator environment.

## Planned envelope

- Skill path: `skills/running-agent-campaigns`
- Control plane: `quirks-campaign preflight` → loopback UI approval → `quirks-campaign start`
- Runners: fake or approved profiles per campaign envelope
- Landing: merge + exact approved push + provenance write-back (plan 4)

## Dogfood gap

Continue using portable JSON/external fixtures and gated smoke tests until a human-approved bounded campaign can execute on a credential-equipped workstation.

## Follow-up task

Record one bounded campaign with dated evidence after `QUIRKS_SMOKE_APPROVED=approve-exact-campaign` and local runner profiles are configured.
