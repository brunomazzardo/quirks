# Claude runner (shared)

Versioned Claude argv guidance for Quirks dispatch. Parent authority remains `quirks-campaign` and `quirks-watchdog`.

## Effort mapping (verified, claude CLI 2.1.218)

`claude --help` for 2.1.218 documents `--effort <level>` as accepting `low, medium, high, xhigh, max`. Quirks profile effort tiers are judgment tiers, not claude effort values, so `buildClaudeArgv` and `buildClaudeResumeArgv` both map the profile effort through `claudeEffort` (`src/runner/claude.ts`) before emitting `--effort` — passing `mechanical`/`standard`/`principal` verbatim is the same bug class as the fixed codex `codexReasoningEffort` mapping.

| Profile effort tier | claude `--effort` |
|---|---|
| `mechanical` | `low` |
| `standard` | `medium` |
| `high` | `high` |
| `principal` | `xhigh` |
| any other value | passed through verbatim (supports claude-native `low`/`medium`/`high`/`xhigh`/`max`) |

The mapping is applied in the shared argv builder, so fresh runs and `--resume` runs always agree on the emitted effort value.
