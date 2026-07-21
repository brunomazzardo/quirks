# Claude runner reference

Dispatch Claude workers through `quirks-campaign` with argv arrays built by the shipped Claude profile.

- Parent: `quirks-campaign` + `quirks-watchdog`
- Capture Claude session UUID before accepting success
- Verify artifact paths on disk before journaling completion
- Never use host-native Claude subagents as the durable parent
