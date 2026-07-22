---
name: updating-tasks
description: Refresh canonical task state through quirks-tasks sync with conflict discipline and stale revision guards.
---

# Updating tasks

Use this skill when syncing or mutating task status through the selected task source.

## Required workflow

1. Run `quirks-tasks sync` (or equivalent refresh) before any native mutation.
2. Pass expected native revision and a repository-relative `--request-file .quirks/requests/MUTATION-TASK_ID.json` on every mutating CLI call.
3. Report honest `pending_sync` state—never claim completion while sync is outstanding.
4. Pause or block when the canonical source disagrees with local projections.
5. Never silently merge provider metadata over canonical status.
6. Reuse idempotency keys for duplicate-safe retries—never mint fresh keys to bypass prior mutations.

## Reference

See `references/sync-conflicts.md` for conflict handling, and `references/task-mutation-requests.md` for request schema, matching operations, idempotency keys, and cleanup after acknowledgement.

Examples: `quirks-tasks claim --request-file .quirks/requests/claim-QK-123.json --json`; `quirks-tasks block --request-file .quirks/requests/block-QK-123.json --json`; `quirks-tasks release --request-file .quirks/requests/release-QK-123.json --json`.

## Prohibited patterns

- Overwriting canonical status during provider conflict (`canonical_status_overwrite`)
- Retrying mutations without refreshed revision (`stale_revision_retry`)
- Reporting complete while `pending_sync` remains (`pending_sync_reported_complete`)
- Bypassing idempotency keys on duplicate mutations (`duplicate_idempotency_bypass`)

## CLI authority

All refresh and mutation flows through `quirks-tasks` with `--json`.
