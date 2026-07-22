# 2026 host/runner smoke matrix

| Date | OS | Host | Host version | Runner | Runner version | Model/effort | Profile (redacted) | Outcome | Artifact digest |
|---|---|---|---|---|---|---|---|---|---|
| 2026-07-22 | darwin | claude | 2.1.217 (Claude Code) | claude | 2.1.217 (Claude Code) | smoke-claude/standard | smoke-impl…-claude | passed | c7212aaa3a7ea5d4984f392d06c30530d0a981710201b2d7c11a5f8a59d2f46b |
| 2026-07-22 | darwin | claude | 2.1.217 (Claude Code) | codex | codex-cli 0.144.1 | n/a | smoke-impl…-codex | blocked:missing-evidence | n/a |
| 2026-07-22 | darwin | claude | 2.1.217 (Claude Code) | cursor | 2026.07.20-8cc9c0b | n/a | smoke-impl…-cursor | blocked:host-timeout | n/a |
| 2026-07-22 | darwin | codex | codex-cli 0.144.1 | claude | 2.1.217 (Claude Code) | n/a | smoke-impl…-claude | blocked:missing-evidence,codex-models-cache-error,host-stdout-error | n/a |
| 2026-07-22 | darwin | codex | codex-cli 0.144.1 | codex | codex-cli 0.144.1 | n/a | smoke-impl…-codex | blocked:missing-evidence,codex-models-cache-error,host-stdout-error | n/a |
| 2026-07-22 | darwin | codex | codex-cli 0.144.1 | cursor | 2026.07.20-8cc9c0b | n/a | smoke-impl…-cursor | blocked:missing-evidence,codex-models-cache-error,host-stdout-error | n/a |
| 2026-07-22 | darwin | cursor | 2026.07.20-8cc9c0b | claude | 2.1.217 (Claude Code) | smoke-claude/standard | smoke-impl…-claude | passed | fdb95336fe0e598f737535b023e61aaad2dd1ef4ff12e2a18a3a7b101d3826fb |
| 2026-07-22 | darwin | cursor | 2026.07.20-8cc9c0b | codex | codex-cli 0.144.1 | smoke-codex/standard | smoke-impl…-codex | passed | c5fb526d3bf2179a9551debeb280f0925a5570f8eab1ced44c6448603629dfb8 |
| 2026-07-22 | darwin | cursor | 2026.07.20-8cc9c0b | cursor | 2026.07.20-8cc9c0b | smoke-cursor/standard | smoke-impl…-cursor | passed | 0afda76b805069a859f79d7f952dcbbb31620e6ba16507e780fa9e90ba4e0302 |

