# Cursor runner (shared)

Versioned Cursor argv guidance for Quirks dispatch. Parent authority remains `quirks-campaign` and `quirks-watchdog`.

## Result contract (QK-RUN-005)

Verified against `cursor-agent 2026.07.20` (`cursor-agent --help`): the CLI has **no `--output-schema` equivalent and no `-o`/result-file flag** — nothing mechanically constrains the agent's final output the way the codex runner's schema does. In the first real campaign (2026-07-23) the cursor reviewer emitted `{"status":"ok"}` and burned both attempts on a bare `missing_structured_result`. Enforcement is therefore **brief-guided plus validation-strict**:

- **Brief-guided**: every dispatched cursor brief ends with a `Runner result contract:` section (`cursorResultContractSection` in `src/runner/cursor.ts`, appended by `buildTaskBrief` when the supervisor routes a cursor profile). It states the exact envelope JSON contract, a filled example, and the exact job-unique path to write it before exiting.
- **Validation-strict**: `parseCursorResult` reads the declared envelope path and requires all four fields. Any violation fails the job with an actionable detail that **names the offending fields** (e.g. `missing_structured_result: result envelope at <path> is missing required fields: sessionHandle, artifactPaths`), never a bare code.

### Per-job result path

`cursorResultPath(artifactDir, jobId)` mirrors the codex fix: `<artifactDir>/cursor-result-<sanitized jobId>.json`, unique per job so attempts and roles sharing a briefs directory never clobber (or inherit) each other's envelopes. The dispatcher derives the same path at parse time from the job id, and `artifactPathsForRunner` declares it as the expected artifact.

### Envelope shape

Same shape the codex `--output-schema` enforces mechanically (`schemas/codex-result.schema.json`), all four fields required:

```json
{"status":"success","sessionHandle":"cursor-session-1","artifactPaths":["<resultPath>"],"failure":null}
```

- `status`: one of `success | failure | cancelled | timeout | usage_limit | permission_denied`.
- `sessionHandle`: string or null; the stream `session_id`/`chatId`/`threadId` from `--output-format json` events is preferred over the envelope's self-report.
- `artifactPaths`: array of file path strings; `success` with an empty array is downgraded to failure (`missing_artifact_evidence`), mirroring codex.
- `failure`: string reason for any non-success status, or null.

### Classification order

1. A valid envelope at the declared path is authoritative for status.
2. Without a trustworthy envelope, CLI-level `type:"result"` error events still classify `permission_denied`/`usage_limit`/failure (mirroring the codex stream fallback), keeping the captured session handle for resume eligibility.
3. Otherwise the job fails `missing_structured_result` with a detail naming the declared path and every missing/invalid envelope field.
