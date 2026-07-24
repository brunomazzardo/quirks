# Real-CLI runner boundary probe — 2026-07-24

Probe of every configured runner profile against the **real** agent CLIs, using the
production `buildRunnerArgv` from `src/runner/cli-runner-port.ts`. No fake runners, no
hand-rolled command lines: the probe fails exactly where a real campaign fails.

This exists because `QK-RUN-003` and `QK-RUN-005` were accepted on fake-runner evidence
(`test/fixtures/fake-runners`, `model: "smoke-*"`), which cannot observe CLI flag validity.
The smoke harness `writeSmokeProfilesConfig` (`src/smoke/host-runner.ts:208`) has the same
limitation. Three of the four defects below were invisible to every green test in the repo.

## Method

- Scratch git repository, one committed file.
- Brief written to a real artifact dir; argv built by `buildRunnerArgv(profile, input, artifactDir, briefContents)`.
- Each profile spawned with `stdio: ["ignore", "pipe", "pipe"]`, 240 s timeout.
- Recorded: exit code, signal, stdout/stderr tails, whether the result envelope was written.

## Results — 4 pass, 5 fail

| Profile | Runner | Model | Result |
|---|---|---|---|
| `personal-claude-sonnet-impl` | claude | sonnet | **PASS** (22 s) |
| `personal-claude-opus-review` | claude | opus | **FAIL** exit 1 (2 s) |
| `work-claude-sonnet-impl` | claude | sonnet | **FAIL** exit 1 (2 s) |
| `work-claude-opus-review` | claude | opus | **FAIL** exit 1 (2 s) |
| `personal-codex-gpt55-impl` | codex | gpt-5.5 | **PASS** (21 s) |
| `personal-codex-terra-review` | codex | gpt-5.6-terra | **PASS** (22 s) |
| `personal-codex-sol-review` | codex | gpt-5.6-sol | **PASS** (42 s) |
| `personal-cursor-composer-impl` | cursor | composer-2.5 | **FAIL** exit 1 (1 s) |
| `personal-cursor-grok-review` | cursor | cursor-grok-4.5-high | **FAIL** exit 1 (1 s) |

Codex was the only runner whose argv was already correct.

## Defect 1 — cursor runner passes a flag that does not exist (`QK-RUN-007`)

`buildCursorArgv` (`src/runner/cursor.ts:96`) emits `--file <briefPath>`. `cursor-agent`
2026.07.20 has no such option:

```
error: unknown option '--file'
```

Every cursor dispatch has always died in about one second, before contacting any model.
**This is the real cause of the earlier cursor reviewer failure** — not the account, not the
model, not quota. The runner also omits `--trust`, which risks a headless block on the
workspace trust prompt once `--file` is removed.

Corrected invocation verified working — brief as positional prompt, plus `--trust`:

```
cursor-agent -p --output-format json --model composer-2.5 --trust "<brief>"
→ {"type":"result","subtype":"success","is_error":false,"result":"PROBE_OK"}
```

## Defect 2 — variadic `--add-dir` swallows the claude brief (`QK-RUN-007`)

`buildClaudeArgv` (`src/runner/claude.ts:85`) appends the brief path as the trailing
positional, immediately after `--add-dir <workspace>`. `--add-dir` is variadic, so it
consumes the brief path as a second directory and no prompt remains:

```
Error: Input must be provided either through stdin or as a prompt argument when using --print
```

Write-capable profiles escape this **by accident**: `--dangerously-skip-permissions` is
inserted between `--add-dir` and the positional and terminates the variadic list. Read-only
profiles have no such separator.

**Consequence: every Claude reviewer profile is broken, and every Claude implementer works
only by luck of flag ordering.** The one profile that has ever been dispatched in a campaign
(`personal-claude-sonnet-impl`) is write-capable, which is why this was never seen.

Confirmed by reordering so a non-variadic flag separates them:

```
claude -p --model opus --effort high --add-dir . --output-format stream-json --verbose <brief>
→ "result":"PROBE_OK", "is_error":false, canonicalModel "claude-opus-5"
```

## Defect 3 — `stream-json` needs `--verbose`, supplied only by local settings (`QK-RUN-007`)

```
Error: When using --print, --output-format=stream-json requires --verbose
```

`personal-claude-sonnet-impl` passes only because `~/.claude/settings.json` sets
`"verbose": true`. The work account config has no such key, so the identical profile fails.
The runner must pass `--verbose` explicitly rather than depend on machine-local settings.

## Defect 4 — reviewer verdict conflated with transport status (`QK-RUN-008`)

From the retained artifacts of the failed `cmp-uimotion-1` campaign in `.quirks/briefs/`.
**Codex ran correctly and wrote well-formed envelopes**; the runner then misread both
possible outcomes.

*Verdict has no channel.* The reviewer brief's output contract demands an explicit
accept/revise recommendation, but the only channel is the envelope `status`, whose enum is
transport-level (`success`, `failure`, `cancelled`, `timeout`, `usage_limit`,
`permission_denied`). A reviewer recommending revise can only write `status: "failure"`,
which the supervisor reads as a failed runner job and retries.

`codex-result-cmp-uimotion-1-QK-UI-004D-reviewer-1.json` and `-2.json` both carry
`status: "failure"` with a complete review in `failure` — "Review recommendation: revise",
"Review result: REVISE" — not an error.

*Accepting also fails.* `src/runner/codex.ts:239` and `src/runner/cursor.ts:286` convert
`status: "success"` with empty `artifactPaths` into a failure. A read-only reviewer that
accepts legitimately produces no artifacts.
`codex-result-cmp-uimotion-1-QK-UI-008-reviewer-1.json` is exactly
`{"status":"success","sessionHandle":null,"artifactPaths":[],"failure":null}` and is
rejected.

**Both reviewer outcomes therefore fail**, so review attempts retried until
`BUDGET_EXCEEDED`. This is a semantic defect in the envelope contract, independent of the
argv defects above.

## Incidental observation

The `QK-UI-008` reviewer brief records base and candidate commit as the same SHA
(`419347a`), so there was no diff to review. Not diagnosed here; worth a separate look.

## Resolution — all six defects fixed and re-probed

`QK-RUN-007` (commit `f4d31e3`) and `QK-RUN-008` (commit `1223902`) fix all of the
above. Re-probed against the real CLIs using the production `buildRunnerArgv` and the
production result contract:

| Profile | Runner | Model | Dispatch | Envelope |
|---|---|---|---|---|
| `personal-claude-sonnet-impl` | claude | sonnet | PASS | written |
| `personal-claude-opus-review` | claude | opus | PASS | written |
| `work-claude-sonnet-impl` | claude | sonnet | PASS | written |
| `work-claude-opus-review` | claude | opus | PASS | written |
| `personal-codex-gpt55-impl` | codex | gpt-5.5 | PASS | written |
| `personal-codex-terra-review` | codex | gpt-5.6-terra | PASS | written |
| `personal-codex-sol-review` | codex | gpt-5.6-sol | PASS | written |
| `personal-cursor-composer-impl` | cursor | composer-2.5 | PASS | written |
| `personal-cursor-grok-review` | cursor | cursor-grok-4.5-high | PASS | written |

**9/9**, up from 4/9. `pnpm check`: 796 pass, 0 fail.

### Verdict round-trip, verified against real reviewers

Four reviewer profiles across all three vendors were given a file with an obvious
off-by-one and asked for an accept/revise recommendation. Every one returned
`status: "success"` with `verdict: "revise"` — read back through the production
parsers — and none modified the workspace:

| Profile | Model | status | verdict |
|---|---|---|---|
| `personal-claude-opus-review` | opus | success | revise |
| `personal-codex-terra-review` | gpt-5.6-terra | success | revise |
| `personal-codex-sol-review` | gpt-5.6-sol | success | revise |
| `personal-cursor-grok-review` | cursor-grok-4.5-high | success | revise |

Before the fix every one of these would have been recorded as a failed runner job
and retried.

### One finding the exit codes hid

The first post-fix probe passed 9/9 on exit code, but inspecting the envelope
bodies showed **two of three codex models writing `artifactPaths: []`** despite the
schema instructing them to include the envelope path. `parseCodexResult` rejects
success with empty evidence, so those reviewers would still have failed. Evidence
that a review ran cannot depend on the model remembering to cite it, so the
declared envelope — which the parser has already read — now counts as its own
evidence. Worth remembering: a green exit code is not a green result.

## Correction to the earlier hypothesis

The prior working theory — that `--json`, `--output-schema`, or a missing
`--skip-git-repo-check` made real codex exit non-zero — is **wrong**. All three codex
profiles exit 0 and write valid envelopes with those exact flags. The codex failure was
downstream envelope interpretation (Defect 4), and the cursor failure was an invalid flag
(Defect 1).
