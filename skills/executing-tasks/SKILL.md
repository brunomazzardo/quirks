---
name: executing-tasks
description: Execute focused tasks with reproduced verification, validated provenance candidates, and sync acknowledgement.
---

# Executing tasks

Use this skill for focused interactive execution of a single approved task.

## Required workflow

1. Claim only through task-source operations with durable intent.
2. Run reproduced verification commands before `quirks-tasks submit-review`.
3. Attach provenance with `quirks-tasks attach-provenance` using validator-approved candidates only.
4. Use repository-relative POSIX paths only and reject absolute paths outside the repository.
5. Call `quirks-tasks complete` only after acknowledgement, sync acknowledgement, and exact commit or artifact evidence—never while `pending_sync` remains.
6. Respect `completionBoundary` from normalized task metadata.
7. When running inside a campaign job, publish live progress via `quirks-campaign progress set`.

## Reference

See `references/provenance-candidates.md` for compact provenance rules.

## Prohibited patterns

- Marking done from executor summary alone (`unverified_completion`)
- Fabricated commit SHAs without `git rev-parse` evidence (`fabricated_commit_sha`)
- Provenance paths outside the repository (`path_outside_repository`)
- Completing before sync acknowledgement (`complete_before_sync_ack`)

## CLI authority

Mechanical completion flows through `quirks-tasks` with `--json`. Skills never write provenance directly.
