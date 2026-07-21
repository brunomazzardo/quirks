# Codex runner reference

Dispatch Codex workers through `quirks-campaign` with argv arrays built by the shipped Codex profile.

- Parent: `quirks-campaign` + `quirks-watchdog`
- Record usage-limit events without silent tier downgrade
- Verify artifact paths on disk before journaling completion
- Never use host-native Codex tasks as the durable parent
