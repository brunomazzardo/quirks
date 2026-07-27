# 2026 host/runner smoke matrix

| Date | OS | Host | Host version | Runner | Runner version | Model/effort | Profile (redacted) | Outcome | Artifact digest |
|---|---|---|---|---|---|---|---|---|---|
| 2026-07-22 | darwin | claude | 2.1.217 (Claude Code) | claude | 2.1.217 (Claude Code) | smoke-claude/standard | smoke-impl…-claude | passed | f1ec5b80d480175305ba7e058fd73cc102ac4101cd0319ca7ffeaaaa72dda273 |
| 2026-07-22 | darwin | claude | 2.1.217 (Claude Code) | codex | codex-cli 0.144.1 | smoke-codex/standard | smoke-impl…-codex | passed | bec86a4e7baee52bd07528f74700f6e0d05d2cc5a649382edd58b055a64865ff |
| 2026-07-22 | darwin | claude | 2.1.217 (Claude Code) | cursor | 2026.07.20-8cc9c0b | smoke-cursor/standard | smoke-impl…-cursor | passed | 3fdfdb850a3a6120f958276b2407c9efe4bb3285efda89c2dcfdac12f7497542 |
| 2026-07-22 | darwin | codex | codex-cli 0.144.1 | claude | 2.1.217 (Claude Code) | n/a | smoke-impl…-claude | blocked:missing-evidence | n/a |
| 2026-07-22 | darwin | codex | codex-cli 0.144.1 | codex | codex-cli 0.144.1 | n/a | smoke-impl…-codex | blocked:missing-evidence | n/a |
| 2026-07-22 | darwin | codex | codex-cli 0.144.1 | cursor | 2026.07.20-8cc9c0b | n/a | smoke-impl…-cursor | blocked:missing-evidence | n/a |
| 2026-07-22 | darwin | cursor | 2026.07.20-8cc9c0b | claude | 2.1.217 (Claude Code) | n/a | smoke-impl…-claude | blocked:host-timeout | n/a |
| 2026-07-22 | darwin | cursor | 2026.07.20-8cc9c0b | codex | codex-cli 0.144.1 | smoke-codex/standard | smoke-impl…-codex | passed | a2c73e8bbbfaa5a2369665674ee3c9c0cb3470b07507212e53084f9ca31db03f |
| 2026-07-22 | darwin | cursor | 2026.07.20-8cc9c0b | cursor | 2026.07.20-8cc9c0b | smoke-cursor/standard | smoke-impl…-cursor | passed | a4f37cfc9435b2fc44b9398857a5ae647238936249d2e22a89e4b7f96db13ed0 |


## Contextual prompt discovery assumptions (2026-07-22, QK-PRM-001)

- Prompt briefs and UI copy actions are rendered by the deterministic prompt kernel (`src/prompt/`); no runtime AI call generates, rewrites, or ranks prompts on any host. This is verified by `test/prompt/security.test.ts`, the golden fixtures under `test/prompt/golden/`, and the no-network default of `test/prompt/evaluation-harness.ts`.
- Claude, Codex, and Cursor hosts receive role briefs as plain files under `.quirks/briefs/`; the same host-portable text is exposed to the loopback UI, so copied prompts match dispatched briefs byte-for-byte (`test/integration/contextual-prompt-flow.test.ts`).
- Host skill discovery is unchanged: prompts reference canonical skill names (`executing-tasks`, `running-agent-campaigns`) and instruct the recipient to read them before acting; no host-specific prompt syntax is emitted.
- Fresh-agent prompt evaluations run only in development via `QUIRKS_PROMPT_EVAL_RUNNER`; default `pnpm test` scores stored JSONL results with no network or model call.
