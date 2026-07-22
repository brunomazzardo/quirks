---
name: dispatching-external-agents
description: Dispatch external runners through quirks-campaign parentage with argv-only runner profiles and artifact verification.
---

# Dispatching external agents

Use this skill when spawning Claude, Codex, or Cursor workers for Quirks campaign jobs.

## Durable parent (required)

- `quirks-campaign` owns campaign state, claims, and dispatch authorization.
- `quirks-watchdog` owns session reattachment and liveness evidence.

Never treat a host-native subagent, IDE task runner, or detached child process as the durable parent. Workers return artifacts; the supervisor journals outcomes.

## Dispatch rules

1. Build argv arrays only—never interpolate shell briefs or `git -c` strings.
2. Capture session UUID or thread handle before accepting runner success.
3. Classify permission-denied exits as non-success even when the runner exits zero.
4. Record usage-limit events without silently downgrading model tiers.
5. Verify on-disk artifacts exist at declared paths before reporting success.
6. Prefer cross-vendor reviewers for judgment-heavy review work.
7. Delegate runner-specific flags to versioned references under `references/`—do not duplicate vendor flags in this skill body.

## Runner references

- Claude: `references/claude.md` and shared `references/runners/claude.md`
- Codex: `references/codex.md` and shared `references/runners/codex.md`
- Cursor: `references/cursor.md` and shared `references/runners/cursor.md`

## Prohibited patterns

- Host-native subagent as parent (`host-native subagent` ownership)
- Prose-only completion without artifact verification
- Trusting permission-denied exit-zero results
- Silent usage-limit tier downgrade
- Shell-brief interpolation for runner argv
- Unjournaled detached children outside `quirks-campaign` dispatch

## CLI authority

Mechanical dispatch uses shipped `src/runner/*` argv builders invoked by `quirks-campaign`. Skills never open runner profiles or campaign journals directly.
