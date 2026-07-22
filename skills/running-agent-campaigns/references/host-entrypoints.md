# Host entrypoints

All three supported hosts invoke the same Quirks control plane.

| Host | Install reference | Durable parent | Reattach |
|---|---|---|---|
| Claude Code | `references/hosts/claude.md` | `quirks-campaign` + `quirks-watchdog` | `quirks-campaign status --campaign <id>` |
| Codex | `references/hosts/codex.md` | `quirks-campaign` + `quirks-watchdog` | `quirks-campaign status --campaign <id>` |
| Cursor | `references/hosts/cursor.md` | `quirks-campaign` + `quirks-watchdog` | `quirks-campaign status --campaign <id>` |

## Required flow

1. `quirks-campaign preflight`
2. `quirks-campaign ui open` and digest-bound loopback approval
3. `quirks-campaign start`
4. `quirks-campaign status` / `quirks-watchdog` for durable attach

Host harnesses may translate natural-language requests into argv, but they never own worker processes, campaign journals, or approval state.

## Runner matrix

Each host must be able to dispatch Claude, Codex, and Cursor CLI workers through `dispatching-external-agents`. Runner flag tables live only under `references/runners/*`.
