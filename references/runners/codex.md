# Codex runner (shared)

Versioned Codex argv guidance for Quirks dispatch. Parent authority remains `quirks-campaign` and `quirks-watchdog`.

All flags below were verified against `codex-cli 0.144.1` (`codex exec --help`, `codex exec resume --help`). Builders live in `src/runner/codex.ts`; dispatch wiring lives in `src/runner/cli-runner-port.ts` and `src/runner/dispatcher.ts`.

## Fresh run argv

`buildCodexArgv` emits:

```
<executable> exec -m <model> -C <workspace> -s <sandbox> --add-dir <artifactDir> \
  -c model_reasoning_effort=<effort> --output-schema <schemaPath> \
  --color never --json -o <resultPath> -- <promptText>
```

## Resume argv

`buildCodexResumeArgv` emits (exec-level flags precede the `resume` subcommand so the parent parser consumes them):

```
<executable> exec -s <sandbox> -c model_reasoning_effort=<effort> --output-schema <schemaPath> \
  --color never --json -o <resultPath> resume <sessionHandle> -- <continuePrompt>
```

Resume carries `--output-schema` too (deliberate amendment to the plan's resume interface line): `exec resume` accepts the same output options, and without the schema a resumed session that ends in prose would be misclassified as failure despite completed work.

`<continuePrompt>` defaults to the exported `CODEX_CONTINUE_PROMPT` constant with `<briefPath>` substituted: "Continue from the current thread state. Re-read the brief at `<briefPath>`, pick the next highest-value step, and write the result envelope to the declared result path before exiting."

## Flag table (verified, codex-cli 0.144.1)

| Flag | Value | Purpose |
|---|---|---|
| `exec` | subcommand | Non-interactive run; `exec resume <SESSION_ID> [PROMPT]` continues a recorded session. |
| `-m, --model` | profile `model` | Model the agent should use. Fresh runs only; resume inherits the session model. |
| `-C, --cd` | worktree path | Agent working root. Fresh runs only; resume restores the recorded session context. |
| `-s, --sandbox` | `workspace-write` when profile capabilities include `repository-write`, else `read-only` | Sandbox policy for model-generated shell commands (`danger-full-access` is never emitted). |
| `--add-dir` | artifact directory (dirname of the brief path) | Grants writability to the artifact directory, which may sit outside the worktree, so the result envelope can be written. |
| `-c model_reasoning_effort=<effort>` | mapped profile `effort` (see table below) | Config override carrying the profile effort; previously dropped for codex. |
| `--output-schema` | `schemas/codex-result.schema.json` (resolved via `codexResultSchemaPath()`) | JSON Schema constraining the model's final response to the Quirks result envelope. |
| `--color` | `never` | Disables ANSI color so stdout stays mechanically parseable. |
| `--json` | flag | Emits JSONL events on stdout; the thread/session id is captured from these events. |
| `-o, --output-last-message` | `<artifactDir>/codex-result-<jobId>.json` (`codexResultPath()`) | Codex writes the final agent message (the schema-constrained envelope) to the declared result path. Job-unique so concurrent jobs sharing a briefs directory never clobber each other. Required on resume too — without it the dispatcher classifies `missing_result_path`. |
| `--` | separator | Terminates flag parsing before the prompt positional so briefs starting with `-` (YAML frontmatter, markdown lists) are never parsed as flags. |
| `[PROMPT]` positional | brief contents, continue prompt, or pointer instruction | Must always be present: `codex exec` with no prompt positional reads stdin, which Quirks spawns as `ignore`. |

## Prompt delivery

Fresh runs pass the brief **contents** as the prompt positional, read at dispatch time in `cli-runner-port.ts`. Briefs over 100 KB (`CODEX_PROMPT_MAX_BYTES`), or briefs that cannot be read, are replaced by a pointer instruction telling the agent to read the brief at its path, keeping argv under OS limits.

## Result contract

- The declared result path (`-o`) must contain the envelope `{ status, sessionHandle, artifactPaths, failure }`; `--output-schema` enforces that shape mechanically.
- The session handle is captured from `--json` JSONL events (`thread.started` → `thread_id`; `session.created`/`session_configured` → `session_id` accepted defensively) and preferred over the envelope's self-reported `sessionHandle`. Disagreement records a `session_handle_mismatch` note on the job result without changing classification.
- When the envelope is missing or invalid, JSONL `error`/`turn.failed` messages classify `usage_limit` (usage/rate/quota) or `cancelled` (interrupt/abort) instead of a generic failure; the captured session handle is kept for resume eligibility.
- Success without on-disk artifact evidence is downgraded to failure by `parseCodexResult`.

## Sandbox and effort notes

- `-s` accepts `read-only`, `workspace-write`, `danger-full-access`; Quirks maps capabilities only onto the first two.
- `codex exec resume` itself does not accept `-s`/`--color`; both are passed at the `exec` level before the `resume` subcommand, which codex-cli 0.144.1 parses on the parent command.
- Profile effort tiers are mapped onto the codex `model_reasoning_effort` enum (`minimal|low|medium|high`) by `codexReasoningEffort`:

| Profile effort tier | `model_reasoning_effort` |
|---|---|
| `mechanical` | `low` |
| `standard` | `medium` |
| `high` | `high` |
| `principal` | `high` |
| any other value | passed through verbatim (supports codex-native values) |
