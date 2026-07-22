---
name: updating-tasks
description: Refresh canonical task state through quirks-tasks sync with conflict discipline and stale revision guards.
---

# Updating tasks

Use this skill when syncing or mutating task status through the selected task source.

## Required workflow

1. Refresh first: run `quirks-tasks sync --json` before any native mutation and branch on its JSON—re-run until it reports `pending: 0`, and stop to resolve conflicts whenever `conflicts` is nonzero.
2. Fetch the expected native revision with `quirks-tasks show TASK_ID --json` and pass it as `expectedNativeRevision` in a repository-relative `--request-file .quirks/requests/MUTATION-TASK_ID.json` on every mutating CLI call.
3. To pick new work, run `quirks-tasks claim-candidate --json` and branch on `available`: when true, claim `task.id`; when false, act on `reason` (`"pending_sync"` → run `quirks-tasks sync --json` and retry; `"no_ready_tasks"` → report that nothing is eligible). Never infer candidates from prose.
4. Report honest `pending_sync` state—never claim completion while sync is outstanding.
5. Pause or block when the canonical source disagrees with local projections.
6. Never silently merge provider metadata over canonical status.
7. Reuse idempotency keys for duplicate-safe retries—never mint fresh keys to bypass prior mutations.

## Reference

See `references/sync-conflicts.md` for conflict handling, and `../../references/task-mutation-requests.md` for request schema, matching operations, idempotency keys, and cleanup after acknowledgement.

Examples: `quirks-tasks claim --request-file .quirks/requests/claim-QK-123.json --json`; `quirks-tasks block --request-file .quirks/requests/block-QK-123.json --json`; `quirks-tasks release --request-file .quirks/requests/release-QK-123.json --json`.

## Prohibited patterns

- Overwriting canonical status during provider conflict (`canonical_status_overwrite`)
- Retrying mutations without refreshed revision (`stale_revision_retry`)
- Reporting complete while `pending_sync` remains (`pending_sync_reported_complete`)
- Bypassing idempotency keys on duplicate mutations (`duplicate_idempotency_bypass`)

## CLI authority

All refresh and mutation flows through `quirks-tasks` with `--json`. Decision points run `quirks-tasks claim-candidate --json` and branch on `available` / `reason`—never on prose inference.
