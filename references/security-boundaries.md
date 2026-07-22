# Security boundaries

Quirks skills and campaign workers operate under fail-closed security rules.

## Credential handling

- Never embed API keys, tokens, passwords, or personal home-directory paths in skill prose or references.
- Never copy skills into target repositories; install from the canonical plugin package only.

## Task source authority

- Skills never open `.quirks/tasks.json`, campaign journals, or runner profiles directly.
- All task mutations use `quirks-tasks` with expected native revisions and validated provenance candidates.

## Git safety

- Git commands use argv arrays via `execFile` only—no shell interpolation.
- No force-push, hard reset, or inferred remotes.
- Worktrees live under platform application state, not inside the target repository working tree.

## Worker limits

Workers cannot merge, push, broaden scope, change campaign budgets, or approve their own work.
