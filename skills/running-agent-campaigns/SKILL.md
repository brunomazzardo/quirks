---
name: running-agent-campaigns
description: Run bounded multi-task campaigns through quirks-campaign preflight, loopback UI approval, and durable supervisor recovery.
---

# Running agent campaigns

Use this skill for "run these tasks," "continue the queue," or unattended overnight Quirks self-campaigns.

## Campaign lifecycle (required)

1. `quirks-campaign preflight` — resolve the exact task set, routes, budgets, and landing/push choices.
2. `quirks-campaign ui open` — present the digest-bound proposal in the loopback UI while the campaign is `awaiting_approval`.
3. Wait for digest-specific approval recorded by the control plane before execution.
4. `quirks-campaign start` — begin supervised execution only after approval.
5. `quirks-campaign status` — observe lanes, jobs, and campaign state during execution.
6. Reattach with `quirks-campaign status` and `quirks-watchdog` by campaign ID after host loss—never rely on conversational memory.

## Parent authority

- `quirks-campaign` and `quirks-watchdog` are the durable parent processes.
- Compose task-lifecycle skills (`writing-tasks`, `updating-tasks`, `executing-tasks`) and `dispatching-external-agents` for bounded work.
- Never expand tasks, routes, budgets, or envelope fields after approval without re-preflight.
- Treat the approved envelope as frozen; cannot expand tasks after approval.

## Model routing

Follow `../../references/model-routing.md` for principal supervision, high-tier review, and external routing across approved runner pools.

## Landing and provenance

- Git merge, exact approved push, and provenance write-back remain supervisor authority.
- Workers cannot merge, push, approve their own work, or mark tasks complete from summary alone.

## Prohibited patterns

- Starting before digest-specific loopback UI approval (`approval_bypass`, `ui_approval_bypass`)
- Expanding campaign scope after approval (`scope_expansion`)
- Dispatching before preflight completes (`preflight_bypass`)
- Recovery without durable campaign attach (`recovery_without_attach`)

## CLI authority

Mechanical campaign orchestration uses `quirks-campaign` and `quirks-watchdog` with `--json`. Skills never open campaign journals, task files, or runner profiles directly.
