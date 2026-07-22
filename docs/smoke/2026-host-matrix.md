# 2026 host/runner smoke matrix

| Date | OS | Host | Host version | Runner | Runner version | Model/effort | Profile (redacted) | Outcome | Artifact digest |
|---|---|---|---|---|---|---|---|---|---|
| 2026-07-22 | darwin | claude | blocked | claude | blocked | n/a | n/a | blocked:missing-credentials | n/a |
| 2026-07-22 | darwin | claude | blocked | codex | blocked | n/a | n/a | blocked:missing-credentials | n/a |
| 2026-07-22 | darwin | claude | blocked | cursor | blocked | n/a | n/a | blocked:missing-credentials | n/a |
| 2026-07-22 | darwin | codex | blocked | claude | blocked | n/a | n/a | blocked:missing-credentials | n/a |
| 2026-07-22 | darwin | codex | blocked | codex | blocked | n/a | n/a | blocked:missing-credentials | n/a |
| 2026-07-22 | darwin | codex | blocked | cursor | blocked | n/a | n/a | blocked:missing-credentials | n/a |
| 2026-07-22 | darwin | cursor | blocked | claude | blocked | n/a | n/a | blocked:missing-credentials | n/a |
| 2026-07-22 | darwin | cursor | blocked | codex | blocked | n/a | n/a | blocked:missing-credentials | n/a |
| 2026-07-22 | darwin | cursor | blocked | cursor | blocked | n/a | n/a | blocked:missing-credentials | n/a |

All nine matrix cells are blocked pending local host credentials and `QUIRKS_SMOKE_APPROVED=approve-paid-runner-probes`. Portable fake-runner acceptance in Wave 6 covers control-plane boundaries until real smoke can run.
