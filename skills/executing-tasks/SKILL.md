---
name: executing-tasks
description: Execute focused tasks with reproduced verification, validated provenance candidates, and sync acknowledgement.
---

# Executing tasks

Use this skill for focused interactive execution of a single approved task.

## Required workflow

1. Select the task mechanically: run `quirks-tasks claim-candidate --json` and branch on its JSON. If `available` is false with `reason: "pending_sync"`, run `quirks-tasks sync --json` until it reports `pending: 0`, then re-run the query. If `reason` is `"no_ready_tasks"`, stop and report that no task is eligible. Never infer eligibility from prose, memory, or ledger files. When `available` is true, use `task.id` as TASK_ID below.
2. Fetch the current revision with `quirks-tasks show TASK_ID --json` and build the claim request from its `nativeRevision`.
3. Claim only through `quirks-tasks claim --request-file .quirks/requests/claim-TASK_ID.json --json` with durable intent.
4. Run reproduced verification commands, then submit with `quirks-tasks submit-review --request-file .quirks/requests/review-TASK_ID.json --json`.
5. Attach provenance with `quirks-tasks attach-provenance --request-file .quirks/requests/provenance-TASK_ID.json --json` using validator-approved candidates only.
6. Use repository-relative POSIX paths only and reject absolute paths outside the repository.
7. Call `quirks-tasks complete --request-file .quirks/requests/complete-TASK_ID.json --json` only after acknowledgement, sync acknowledgement, and exact commit or artifact evidence (a real SHA taken from `git rev-parse`)—never while `pending_sync` remains. Branch on the response JSON: completion stands only when it reports `ok: true` and `pending: 0`.
8. Respect `completionBoundary` from normalized task metadata.
9. When running inside a campaign job, publish live progress by updating the `progress.json` mailbox in the job's artifact directory declared by the job brief; the supervisor observes that mailbox—there is no separate progress CLI subcommand.

## Reference

See `references/provenance-candidates.md` for compact provenance rules, and `../../references/task-mutation-requests.md` for repository-relative request files, schema/operation matching, and cleanup only after acknowledgement.

## Prohibited patterns

- Marking done from executor summary alone (`unverified_completion`)
- Fabricated commit SHAs without `git rev-parse` evidence (`fabricated_commit_sha`)
- Provenance paths outside the repository (`path_outside_repository`)
- Completing before sync acknowledgement (`complete_before_sync_ack`)

## CLI authority

Mechanical completion flows through `quirks-tasks` with `--json`. Decision points run `quirks-tasks claim-candidate --json` and branch on `available` / `reason`—never on prose inference. Skills never write provenance directly.
