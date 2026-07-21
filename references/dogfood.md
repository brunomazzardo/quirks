# Quirks dogfood orchestration

Interactive Quirks development uses an interim dispatcher until canonical skills fully land.

## Interim path (before Wave 3 Task 2)

Until `skills/dispatching-external-agents` merges, interactive work dogfoods installed **Superpowers** orchestration:

- `dispatching-external-agents` for runner dispatch judgment
- `subagent-driven-development` or `executing-plans` for bounded task execution

Mechanical authority remains **`quirks-tasks`** and **`quirks-campaign`** regardless of which dispatcher skill is active.

## Transition to canonical Quirks skills

Retire the Superpowers dispatcher for Quirks repo work only when **all** criteria pass:

1. `pnpm check` passes with skill structure validation and Task 2 forward suite green.
2. `skills/dispatching-external-agents` names `quirks-campaign` / `quirks-watchdog` as the durable parent and forbids host-native subagent ownership.
3. `AGENTS.md` lists the canonical skill allow-list; no project copies skills into target repositories.
4. Wave 4 `running-agent-campaigns` forward tests pass before unattended overnight Quirks self-campaigns.

## Interactive dark boot

Wave 3 Task 1 bootstraps the canonical `skills/` tree, Codex plugin manifest, structure validator, and pressure-scenario harness while this document records the interim Superpowers path and explicit transition checks.

## Prohibitions

- Do not copy Superpowers or Quirks skills into target repositories.
- Do not treat TanStack UI caches, router state, or form values as canonical campaign state.
