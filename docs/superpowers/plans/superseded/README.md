# Superseded plans

These plans described layers Quirks is removing. They are kept, not deleted: they are the
reasoning behind decisions someone will eventually want to reread when asking "why was it ever
built that way?" — and the answer is usually in here.

**Superseded is not wrong.** Each of these was correct when written and shipped real work. What
changed is the product around them.

| Plan | What replaced it |
|---|---|
| `2026-07-21-quirks-campaign-control-plane.md` | `2026-07-27-runs-not-campaigns-design.md`. The campaign ceremony — envelopes, digests, approval tokens, capabilities, leases, budgets — is deleted rather than repaired. A campaign becomes a run, approved once over a plan you can read. |
| `2026-07-21-quirks-local-control-ui.md` | `2026-07-27-native-app-and-service-split-design.md`. The React + TanStack browser client is replaced by a native-rendered app over a TypeScript app core. |
| `2026-07-24-qk-srv-003.md` | D7 of the native app spec. The pairing cookie was designed for a browser; a native client has no cookie jar, so it becomes a mode-0600 token file. |

## Tasks still cite these paths

53 `sourceRefs` across the ledger point here, all but two on `completed` tasks. Those refs are
**commit-pinned**, so they still resolve — `git show <commit>:<original-path>` reads the file at
the path it had when the task was written. Only reads against HEAD's path break, which for
finished work costs nothing.

The two open exceptions are `QK-UI-004D` and `QK-SRV-003`, both of which the reboot retires.

## What is not here

Plans for work that completed and still stands — the task-source foundation, the dogfood repair,
visual references, contextual prompts, the managing-agent runner — stay in the parent directory.
They are history, not supersession, and history keeps its address.
