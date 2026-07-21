# Cursor runner reference

Dispatch Cursor workers through `quirks-campaign` with argv arrays built by the shipped Cursor profile.

- Parent: `quirks-campaign` + `quirks-watchdog`
- Capture Cursor thread or agent id before accepting success
- Verify artifact paths on disk before journaling completion
- Never use host-native Cursor subagents as the durable parent
