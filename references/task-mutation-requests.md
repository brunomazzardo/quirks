# Task mutation request files

Every `quirks-tasks` mutation consumes a short-lived, repository-relative JSON request file. Create it under `.quirks/requests/`, pass it with `--request-file`, and remove it only after the CLI has acknowledged the mutation with `pending: 0`.

The file must be a `task-source-request-v1` mutation object with exactly these top-level fields:

```json
{
  "schemaVersion": 1,
  "operation": "claim",
  "taskId": "QK-123",
  "expectedNativeRevision": "sha256:...",
  "idempotencyKey": "campaign-id:QK-123:claim:attempt-1",
  "input": {
    "campaignId": "campaign-id",
    "owner": "configured-profile:operator",
    "claimedAt": "2026-07-22T00:00:00.000Z"
  }
}
```

The requested CLI operation and `operation` in the JSON must match. Fetch the current `nativeRevision` with `quirks-tasks show TASK_ID --json`, retain the same idempotency key for a duplicate-safe retry, and never place the request outside the repository or mutate a task-source file directly.

Examples:

```sh
quirks-tasks claim --request-file .quirks/requests/claim-QK-123.json --json
quirks-tasks submit-review --request-file .quirks/requests/review-QK-123.json --json
quirks-tasks attach-provenance --request-file .quirks/requests/provenance-QK-123.json --json
quirks-tasks complete --request-file .quirks/requests/complete-QK-123.json --json
```

Only delete `.quirks/requests/*.json` after a successful response has `ok: true` and `pending: 0`; retain it for idempotent retry if acknowledgement is not yet confirmed.

Completion evidence is conservative and provenance-bound: `commit:value` must be a completed iteration's accepted, landed, or listed commit; `review:value` must be that iteration's review artifact path or URL; and `verification:`, `ci:`, and `deployment:` values must match a verification reference of the same kind. Merge-boundary evidence uses a provenance commit from an iteration at least as advanced as that boundary. This is semantic correlation only; it does not inspect Git, filesystems, networks, or external providers.

Verification, CI, and deployment evidence additionally requires the matching provenance `verificationRef` to have exact `outcome: "passed"`; every other outcome fails closed.
