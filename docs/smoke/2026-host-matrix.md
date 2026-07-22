# 2026 host/runner smoke matrix

| Date | OS | Host | Host version | Runner | Runner version | Model/effort | Profile (redacted) | Outcome | Artifact digest |
|---|---|---|---|---|---|---|---|---|---|
| 2026-07-22 | darwin | claude | 2.1.217 (Claude Code) | claude | 2.1.217 (Claude Code) | smoke-claude/standard | smoke-impl…-claude | failed:host-orchestration-failed | n/a |
| 2026-07-22 | darwin | claude | 2.1.217 (Claude Code) | codex | codex-cli 0.144.1 | smoke-codex/standard | smoke-impl…-codex | failed:host-orchestration-failed | n/a |
| 2026-07-22 | darwin | claude | 2.1.217 (Claude Code) | cursor | 2026.07.17-3e2a980 | smoke-cursor/standard | smoke-impl…-cursor | failed:host-orchestration-failed | n/a |
| 2026-07-22 | darwin | codex | codex-cli 0.144.1 | claude | 2.1.217 (Claude Code) | smoke-claude/standard | smoke-impl…-claude | passed:host-orchestrator-fallback | 071a989c06c0919c2ae50827199a7eaf9b7f90783310a2cb1f1eae2b0d95ff3e |
| 2026-07-22 | darwin | codex | codex-cli 0.144.1 | codex | codex-cli 0.144.1 | smoke-codex/standard | smoke-impl…-codex | passed:host-orchestrator-fallback | 9aa2897ca7fd581e355c85baa238c36778b9d4002626196a80e8784dd52fa08a |
| 2026-07-22 | darwin | codex | codex-cli 0.144.1 | cursor | 2026.07.17-3e2a980 | smoke-cursor/standard | smoke-impl…-cursor | passed:host-orchestrator-fallback | ba20ce6c08733cdcfa79020ab64d7177baa5bfbbbc1ce7a0db5d582f10ea6cfa |
| 2026-07-22 | darwin | cursor | 2026.07.17-3e2a980 | claude | 2.1.217 (Claude Code) | smoke-claude/standard | smoke-impl…-claude | passed:host-orchestrator-fallback | 07f98ce5a16906a160d4631588a7c3e41708c998ebc554765c64f294547ff226 |
| 2026-07-22 | darwin | cursor | 2026.07.17-3e2a980 | codex | codex-cli 0.144.1 | smoke-codex/standard | smoke-impl…-codex | passed:host-orchestrator-fallback | 1e6a56a08e9c24e2d610961f7f3ad066dc181d266b206543b3008ced3d9a0cbc |
| 2026-07-22 | darwin | cursor | 2026.07.17-3e2a980 | cursor | 2026.07.17-3e2a980 | smoke-cursor/standard | smoke-impl…-cursor | passed:host-orchestrator-fallback | ea607d84cad35dda94485d48c0891453f0aca66947f1b56c81119923d3840643 |

