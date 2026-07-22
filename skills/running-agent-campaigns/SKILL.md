---
name: running-agent-campaigns
description: Run bounded multi-task campaigns through quirks-campaign preflight, loopback UI approval, and durable supervisor recovery.
---

# Running agent campaigns

Use this skill for "run these tasks," "continue the queue," or unattended overnight Quirks self-campaigns.

## Campaign lifecycle (required)

1. Check for resumable work first: run `quirks-campaign resume-candidate --json` and branch on its JSON. If `available` is true, recover that campaign with `quirks-campaign resume --campaign CAMPAIGN_ID --json` (CAMPAIGN_ID is the returned `campaign.id`) and reattach instead of preflighting a new one. If `available` is false with `reason: "no_resumable_campaign"`, continue to preflight. Never infer resumability from prose or memory.
2. `quirks-campaign preflight --task TASK_ID --json` (repeat `--task` per task) — resolve the exact task set, routes, budgets, and landing/push choices before execution.
3. `quirks-campaign ui open --campaign CAMPAIGN_ID` — present the digest-bound proposal in the loopback UI while the campaign is `awaiting_approval`.
4. Wait for digest-specific approval recorded by the control plane before execution.
5. `quirks-campaign start --campaign CAMPAIGN_ID --json` — begin supervised execution only after approval; by default it drives waves to completion (pass `--single-wave` only for a deliberately bounded single dispatch).
6. `quirks-campaign status --campaign CAMPAIGN_ID --json` — observe lanes, jobs, and campaign state during execution.
7. After host loss, reattach by campaign ID: run `quirks-campaign resume-candidate --json` to find the durable campaign, then `quirks-campaign attach --campaign CAMPAIGN_ID --json`, `quirks-campaign status --campaign CAMPAIGN_ID --json`, and `quirks-watchdog`—never rely on conversational memory.

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

Mechanical campaign orchestration uses `quirks-campaign` and `quirks-watchdog` with `--json`. Decision points run `quirks-campaign resume-candidate --json` and branch on `available` / `reason`—never on prose inference. Skills never open campaign journals, task files, or runner profiles directly.
