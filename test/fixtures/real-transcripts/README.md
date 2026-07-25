# Real CLI transcripts

Transcripts captured from the **real** agent CLIs with the production
`buildRunnerArgv`, for testing the managing-agent interpretation contract
(`QK-RUN-009`).

These are not fakes and must never be replaced by hand-written imitations. An
imitation encodes what we believe a CLI says; these record what it actually
said. `QK-RUN-003` and `QK-RUN-005` were both accepted on fake-runner evidence
that could not observe real output, and every defect that cost the
`cmp-uimotion-1` campaign was invisible to that evidence.

Regenerate any of them with:

```bash
node scripts/capture-runner-transcript.mjs --profile <id> --role <role> --scenario <scenario> --out <path>
```

Each was captured against a scratch git repository containing `sum.js`, with a
brief that states **no result-envelope contract** — the whole point of this
task is that the CLI is left to speak naturally.

Secret-shaped text is redacted by the production `redactTranscript`; home paths
are additionally redacted because these files are committed.

| Fixture | Profile / model | Scenario | Exit | What it proves |
|---|---|---|---|---|
| `claude-reviewer-revise.jsonl` | `personal-claude-opus-review` / opus | `defective` | 0 | A revise verdict in prose. **Also the adversarial case:** the reviewer wrote "I don't think this should be accepted as it stands", so any keyword scan for "accepted" flips the verdict. |
| `claude-reviewer-accept.jsonl` | `personal-claude-opus-review` / opus | `sound` | 0 | A genuine accept: "**Accept as it stands.** I found nothing that must be fixed before this lands." |
| `claude-reviewer-revise-hardening.jsonl` | `personal-claude-opus-review` / opus | `clean` | 0 | A revise that is not about the obvious bug. Captured while trying to obtain an accept by merely fixing the off-by-one — the reviewer found six further defects and refused. Kept because a reviewer that asks for changes on plausible-looking code is the normal case, not the exception. |
| `claude-no-judgment.jsonl` | `personal-claude-opus-review` / opus | `summary` | 0 | A reviewer transcript containing **no** accept/revise anywhere. This is the `indeterminate` fixture: interpreting it as accept is the exact fail-open this task exists to prevent. |
| `cursor-reviewer-revise.jsonl` | `personal-cursor-grok-review` / cursor-grok-4.5-high | `defective` | 0 | cursor's shape: a **single JSON document**, not JSONL, with the whole review in `result`. Proves the transcript helpers are not claude-shaped. |
| `claude-implementer-success.jsonl` | `personal-claude-sonnet-impl` / sonnet | `implement` | 0 | An implementer transcript, which must never carry a verdict. |
| `codex-usage-limit.jsonl` | `personal-codex-terra-review` / gpt-5.6-terra | `defective` | 1 | A real codex usage-limit failure (`turn.failed`), captured 2026-07-24. Four lines, no reasoning, no result. |

Captured 2026-07-24 and 2026-07-25 on macOS with `claude` 2.1.220,
`cursor-agent` 2026.07.23, `codex-cli` 0.145.0.

## Owed: codex reviewer transcripts

codex hit its ChatGPT usage limit on 2026-07-24 and does not reset until
**Jul 28 2026 2:02 PM** — `codex-usage-limit.jsonl` is that limit, captured
through the production argv. Until then there is **no codex reviewer transcript
with real reasoning in this directory**, and the three codex profiles cannot be
covered by the real-CLI gate. That is an owed cell, not a passing one.
