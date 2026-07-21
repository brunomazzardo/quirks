# Parent protocol

Quirks campaigns require a durable parent process that owns orchestration authority.

## Durable parent

- `quirks-campaign` supervises task claims, runner dispatch, and campaign state transitions.
- `quirks-watchdog` reattaches to in-flight runner sessions and records liveness evidence.

Workers and host-native subagents are never the durable parent. They execute bounded jobs inside campaign envelopes and return artifacts to the supervisor.

## Authority boundaries

- Skills express judgment and workflow policy only.
- Mechanical state changes flow through `quirks-tasks` and `quirks-campaign` CLIs with `--json`.
- Git landing, merge, and push remain supervisor authority in Wave 3.
