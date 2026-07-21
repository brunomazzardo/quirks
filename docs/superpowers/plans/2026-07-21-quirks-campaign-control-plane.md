# Quirks Campaign Control Plane and Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the host-independent `quirks-campaign` control plane on top of the frozen task-source kernel: immutable campaign envelopes, digest-bound approval, deterministic scheduling, external CLI runner dispatch, durable recovery, budgets, circuit breakers, and fake-runner acceptance.

**Architecture:** Campaign truth lives in append-only journals under the platform application-state directory keyed by repository identity and campaign ID. Deterministic TypeScript enforces state transitions, envelope hashes, approval binding, lane scheduling, and runner IPC; a separately dispatched supervisor CLI session returns schema-valid decisions but cannot bypass mechanical invariants. Runner profiles resolve from user configuration; argv-array dispatch never shells briefs; the watchdog owns detached child lifecycle. Loopback HTML, CSP, and browser security belong to plan 3; Git worktrees, merge, and push belong to plan 4.

**Tech Stack:** Node.js 24 LTS (`>=24.18.0`), TypeScript 7.0.2, ESM, pnpm 10.30.3, Node `node:test`, Ajv 8.20.0 plus `ajv-formats` 3.0.1 at build time only, and Oxlint 1.74.0.

## Ordered Plan Suite

This is plan 2 of the Quirks v1 suite. It may be authored alongside the local-control-UI plan against the frozen kernel contracts. Do not collapse UI, Git landing, skills, or host acceptance into this pass:

| Order | Planned document | Starts after |
|---|---|---|
| 1 | `2026-07-21-quirks-foundation-task-sources.md` | approved design |
| 2 | `2026-07-21-quirks-campaign-control-plane.md` (this plan) | foundation review (`QK-FND-013`) |
| 3 | `2026-07-21-quirks-local-control-ui.md` | foundation review; may be authored alongside plan 2 |
| 4 | `2026-07-21-quirks-skills-git-integration.md` | approved control-plane and runner interfaces |
| 5 | `2026-07-21-quirks-host-integration-acceptance.md` | approved UI, skills, Git, and runner boundaries |

### Inventory mapping

| Task inventory ID | Plan tasks |
|---|---|
| `QK-CTL-002` | Tasks 1–4 |
| `QK-CTL-003` | Tasks 5–7, 14 |
| `QK-RUN-001` | Tasks 8–10 |
| `QK-RUN-002` | Tasks 11–13 |
| `QK-CTL-004` | Tasks 15–16 |

### File structure

```text
schemas/
  campaign-v1.schema.json
  campaign-state-v1.schema.json
  campaign-event-v1.schema.json
  campaign-approval-v1.schema.json
  host-profile-v1.schema.json
  runner-profile-v1.schema.json
  runner-job-result-v1.schema.json
src/campaign/
  types.ts              # envelope, lifecycle, budgets, routing contracts
  envelope.ts           # canonical digest and immutability checks
  store.ts              # campaign directory layout and atomic writes
  state-machine.ts      # legal transitions and terminal states
  replay.ts             # rebuild state.json from events.jsonl
  approval.ts           # one-time digest-bound tokens and approvals.jsonl
  preflight.ts          # read-only inspection and envelope assembly
  scheduler.ts          # dependency waves and conflict lanes
  routing.ts            # model/effort tier resolution and quota pools
  budgets.ts            # spend and retry counters
  circuit-breakers.ts   # lane/campaign pause rules
  failures.ts           # failure classification
  supervisor.ts         # claim/dispatch/verify orchestration (no Git landing)
  recovery.ts           # resume revalidation and stale-lock takeover
src/runner/
  types.ts              # profiles, jobs, sessions
  profiles.ts           # user-config loading and validation
  claude.ts             # argv builder and result parser
  codex.ts
  cursor.ts
  dispatcher.ts         # spawn-without-shell dispatch
  sessions.ts           # sessions.json registry
  watchdog.ts           # detached execution and liveness
src/cli/
  quirks-campaign.ts    # replace placeholder with real commands
  campaign-args.ts
scripts/
  quirks-watchdog
test/campaign/
test/runner/
test/fixtures/fake-runners/
test/integration/campaign-control-plane.test.ts
```

## Global Constraints

- Runtime code has zero third-party production dependencies; Ajv emits standalone validators during the build.
- Build on the frozen kernel (`TaskSource`, `SyncOutbox`, `syncBoundary`, `reconcileMutation`, `EventJournal`, `RepositoryLock`, provenance validators). Do not reimplement task-source storage or compact provenance rules.
- Unknown schema fields, unsupported versions, malformed frames, secrets in protocol output, stale revisions, and oversized payloads fail closed.
- The selected task source owns canonical status. Campaign journals own execution events, approvals, runner activity, and recovery—not native task status.
- JSON coordination is local to one clone and must never be described as a shared or cross-machine lease.
- Project configuration contains no credentials. Runner profiles reference credential aliases only; aliases resolve from user configuration and never reach project JSON, prompts, campaign evidence, or worker environments.
- Commands are argv arrays. Do not invoke a shell to execute runners, adapters, or briefs.
- All paths persisted in project data are repository-relative POSIX paths; reject absolute paths, `..` traversal, NUL bytes, and paths outside the canonical repository.
- Workers cannot mark tasks reviewed or done, broaden scope, merge, push, change campaign state or budgets, or approve their own work.
- Nothing may claim, dispatch, or mutate a task before a durable digest-bound approval event exists.
- Loopback HTML, CSP, browser tests, and rendered approval UI belong to plan 3—not this plan. This plan exposes schema-valid JSON read models and headless approval consumption for tests and the UI plan.
- Git worktrees, integration branches, merge, and approved push belong to plan 4. This plan defines a `WorktreePort` interface and uses fakes in tests.
- Every task follows red → green → refactor and ends with a focused commit. Run `pnpm check` before the final plan boundary.

---

### Task 1: Campaign, runner, and job-result schemas

**Files:**
- Create: `schemas/campaign-v1.schema.json`
- Create: `schemas/campaign-state-v1.schema.json`
- Create: `schemas/campaign-event-v1.schema.json`
- Create: `schemas/campaign-approval-v1.schema.json`
- Create: `schemas/host-profile-v1.schema.json`
- Create: `schemas/runner-profile-v1.schema.json`
- Create: `schemas/runner-job-result-v1.schema.json`
- Modify: `src/schema/validate.ts`
- Modify: `scripts/generate-validators.mjs` (no logic change; new schema files auto-discovered)
- Create: `test/campaign/schema-contract.test.ts`

**Interfaces:**
- Consumes: existing schema generation pipeline and finite enums from foundation plan Task 3.
- Produces: extended `SchemaName` union and validators for campaign envelope, lifecycle snapshot, append-only events, approval records, host/runner profiles, and normalized job results.

- [ ] **Step 1: Write the failing schema-contract test**

```ts
// test/campaign/schema-contract.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../../src/schema/validate.js";

const envelope = {
  schemaVersion: 1,
  campaignId: "cmp-20260721-abc123",
  digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  repositoryId: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  createdAt: "2026-07-21T16:00:00.000Z",
  taskIds: ["QK-101"],
  taskRevisions: { "QK-101": "sha256:rev" },
  designModes: { "QK-101": { mode: "human", envelope: ["Bound decision"] } },
  git: {
    baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    campaignBranch: "quirks/cmp-20260721-abc123",
    targetBranch: "main",
    push: { enabled: false }
  },
  authority: ["repository"],
  routing: {
    "QK-101": {
      primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
      fallbacks: []
    }
  },
  budgets: {
    maxTasks: 1,
    maxConcurrency: 1,
    maxWallClockMs: 3_600_000,
    maxRetries: 1,
    laneFailureThreshold: 2
  },
  verification: ["pnpm test"],
  hashes: {
    config: "sha256:cfg",
    workflowPolicy: "sha256:wf",
    instructions: "sha256:ins"
  },
  externalRoutingEnabled: false
};

test("accepts a v1 campaign envelope and rejects unknown fields", () => {
  assert.equal(validateSchema("campaign-v1", envelope), envelope);
  assert.throws(
    () => validateSchema("campaign-v1", { ...envelope, surprise: true }),
    /must NOT have additional properties/,
  );
});

test("accepts lifecycle states from the approved machine", () => {
  const snapshot = {
    schemaVersion: 1,
    campaignId: envelope.campaignId,
    status: "awaiting_approval",
    digest: envelope.digest,
    updatedAt: "2026-07-21T16:00:01.000Z"
  };
  assert.equal(validateSchema("campaign-state-v1", snapshot), snapshot);
  assert.throws(
    () => validateSchema("campaign-state-v1", { ...snapshot, status: "exploding" }),
    /status/,
  );
});
```

- [ ] **Step 2: Build and verify validators are missing**

Run: `pnpm build`

Expected: FAIL with missing schema validators for `campaign-v1`.

- [ ] **Step 3: Add strict campaign and runner schemas**

Write every schema with `$schema: "https://json-schema.org/draft/2020-12/schema"`, stable `$id`, `type`, explicit `required`, and `additionalProperties: false` at every object boundary.

| Schema | Required payload |
|---|---|
| `campaign-v1` | immutable approved envelope: `schemaVersion`, `campaignId`, `digest`, `repositoryId`, `createdAt`, exact `taskIds`, `taskRevisions`, per-design-task `designModes`, `git` block, finite `authority`, per-task `routing` with `primary`/`fallbacks`, `budgets`, `verification`, content `hashes`, `externalRoutingEnabled` |
| `campaign-state-v1` | derived snapshot: `schemaVersion`, `campaignId`, `status`, `digest`, `updatedAt`, optional `pausedReason`, `blockedReason`, `activeLanes`, `spend` |
| `campaign-event-v1` | append-only transition: `schemaVersion`, `id`, `type`, `at`, `actor`, `from`, `to`, `reason`, `evidence` object with bounded strings only |
| `campaign-approval-v1` | durable approval: `schemaVersion`, `campaignId`, `digest`, `approvedAt`, `operator`, `tokenId`, `evidence` |
| `host-profile-v1` | host harness metadata: `schemaVersion`, `hostType` (`claude-code` \| `codex` \| `cursor`), `version`, optional `identitySummary` |
| `runner-profile-v1` | user config profile: `schemaVersion`, `profileId`, `runnerType` (`claude` \| `codex` \| `cursor`), `executable`, `accountAlias`, `quotaPoolId`, `tier`, `model`, `effort`, `capabilities`, `wallClockMs`, optional `configDir`, `redactionRules` — never a credential value |
| `runner-job-result-v1` | normalized dispatch result matching design section 16 |

Finite enums:

```json
{
  "campaignStatus": [
    "draft", "preflight", "awaiting_approval", "running", "paused",
    "blocked", "final_review", "landing", "hold", "complete", "cancelled"
  ],
  "designMode": ["human", "human-after-draft", "delegated"],
  "judgmentTier": ["mechanical", "standard", "high", "principal"],
  "runnerType": ["claude", "codex", "cursor"],
  "hostType": ["claude-code", "codex", "cursor"],
  "jobStatus": ["success", "failure", "cancelled", "timeout", "usage_limit", "permission_denied"]
}
```

Extend `SchemaName` and `validateSchema` in `src/schema/validate.ts`:

```ts
export type SchemaName =
  | "project-config-v1"
  | "json-task-file-v1"
  | "normalized-task-v1"
  | "task-provenance-v1"
  | "task-source-capabilities-v1"
  | "task-source-request-v1"
  | "task-source-response-v1"
  | "task-sync-intent-v1"
  | "campaign-v1"
  | "campaign-state-v1"
  | "campaign-event-v1"
  | "campaign-approval-v1"
  | "host-profile-v1"
  | "runner-profile-v1"
  | "runner-job-result-v1";
```

- [ ] **Step 4: Generate, build, and run schema tests**

Run: `pnpm build`

Expected: PASS and create validators for all seven new schemas.

Run: `node --test dist/test/campaign/schema-contract.test.js`

Expected: PASS for valid envelopes, unknown-field rejection, and invalid lifecycle status.

- [ ] **Step 5: Commit campaign schemas**

```bash
git add schemas/campaign-v1.schema.json schemas/campaign-state-v1.schema.json schemas/campaign-event-v1.schema.json schemas/campaign-approval-v1.schema.json schemas/host-profile-v1.schema.json schemas/runner-profile-v1.schema.json schemas/runner-job-result-v1.schema.json src/schema/validate.ts test/campaign/schema-contract.test.ts
git commit -m "feat: add campaign and runner protocol schemas"
```

### Task 2: Campaign envelope digest and on-disk store layout

**Files:**
- Create: `src/campaign/types.ts`
- Create: `src/campaign/envelope.ts`
- Create: `src/campaign/store.ts`
- Create: `test/campaign/envelope.test.ts`
- Create: `test/campaign/store.test.ts`

**Interfaces:**
- Consumes: `validateSchema`, `canonicalJson`, `sha256`, `resolveAppPaths`, `writeJsonAtomic`, `EventJournal`.
- Produces: `CampaignEnvelope`, `computeEnvelopeDigest(envelopeInput): string`, `CampaignStore.open(repositoryId, campaignId)`, paths for `campaign.json`, `events.jsonl`, `approvals.jsonl`, `state.json`, `sessions.json`, `sync-outbox.jsonl`, `tasks/<task-id>.json`, `artifacts/<job-id>/`.

- [ ] **Step 1: Write failing digest and layout tests**

```ts
// test/campaign/envelope.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";

test("digest is stable across key order and excludes the digest field itself", () => {
  const input = {
    schemaVersion: 1 as const,
    campaignId: "cmp-1",
    repositoryId: "sha256:repo",
    createdAt: "2026-07-21T16:00:00.000Z",
    taskIds: ["QK-1"],
    taskRevisions: { "QK-1": "sha256:rev" },
    designModes: {},
    git: {
      baseCommit: "a".repeat(40),
      campaignBranch: "quirks/cmp-1",
      targetBranch: "main",
      push: { enabled: false }
    },
    authority: ["repository"],
    routing: {},
    budgets: {
      maxTasks: 1,
      maxConcurrency: 1,
      maxWallClockMs: 1,
      maxRetries: 1,
      laneFailureThreshold: 2
    },
    verification: [],
    hashes: { config: "sha256:cfg", workflowPolicy: "sha256:wf", instructions: "sha256:ins" },
    externalRoutingEnabled: false
  };
  const digest = computeEnvelopeDigest(input);
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  const withDigest = { ...input, digest };
  assert.equal(computeEnvelopeDigest(stripDigest(withDigest)), digest);
});
```

```ts
// test/campaign/store.test.ts
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CampaignStore } from "../../src/campaign/store.js";

test("creates the canonical campaign directory layout", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-campaign-store-"));
  const store = await CampaignStore.create({
    stateDir,
    repositoryId: "sha256:repo",
    campaignId: "cmp-1",
    envelope: {
      schemaVersion: 1,
      campaignId: "cmp-1",
      digest: "sha256:" + "0".repeat(64),
      repositoryId: "sha256:repo",
      createdAt: "2026-07-21T16:00:00.000Z",
      taskIds: [],
      taskRevisions: {},
      designModes: {},
      git: {
        baseCommit: "a".repeat(40),
        campaignBranch: "quirks/cmp-1",
        targetBranch: "main",
        push: { enabled: false }
      },
      authority: ["repository"],
      routing: {},
      budgets: {
        maxTasks: 1,
        maxConcurrency: 1,
        maxWallClockMs: 1,
        maxRetries: 1,
        laneFailureThreshold: 2
      },
      verification: [],
      hashes: { config: "sha256:cfg", workflowPolicy: "sha256:wf", instructions: "sha256:ins" },
      externalRoutingEnabled: false
    }
  });
  assert.equal(await store.hasFile("campaign.json"), true);
  assert.equal(await store.hasFile("events.jsonl"), true);
  assert.equal(await store.hasFile("approvals.jsonl"), true);
  assert.equal(await store.hasFile("state.json"), true);
  assert.equal(await store.hasFile("sessions.json"), true);
});
```

- [ ] **Step 2: Build and verify campaign modules are missing**

Run: `pnpm build`

Expected: FAIL with missing `src/campaign/*`.

- [ ] **Step 3: Implement envelope hashing and store layout**

```ts
// src/campaign/types.ts
import type { validateSchema } from "../schema/validate.js";

export type CampaignEnvelope = ReturnType<typeof validateSchema<"campaign-v1">>;
export type CampaignSnapshot = ReturnType<typeof validateSchema<"campaign-state-v1">>;
export type CampaignEvent = ReturnType<typeof validateSchema<"campaign-event-v1">>;
export type CampaignApproval = ReturnType<typeof validateSchema<"campaign-approval-v1">>;

export type CampaignStatus = CampaignSnapshot["status"];
```

```ts
// src/campaign/envelope.ts
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import { QuirksError } from "../core/errors.js";
import type { CampaignEnvelope } from "./types.js";

export type EnvelopeInput = Omit<CampaignEnvelope, "digest">;

export function stripDigest(envelope: CampaignEnvelope): EnvelopeInput {
  const { digest: _digest, ...rest } = envelope;
  return rest;
}

export function computeEnvelopeDigest(input: EnvelopeInput): string {
  return sha256(JSON.parse(canonicalJson(input)));
}

export function finalizeEnvelope(input: EnvelopeInput): CampaignEnvelope {
  const digest = computeEnvelopeDigest(input);
  return { ...input, digest };
}

export function assertEnvelopeUnchanged(approved: CampaignEnvelope, candidate: EnvelopeInput): void {
  const approvedDigest = approved.digest;
  const candidateDigest = computeEnvelopeDigest(candidate);
  if (approvedDigest !== candidateDigest) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Campaign envelope drift requires new approval", {
      approvedDigest,
      candidateDigest
    });
  }
}
```

`CampaignStore.create` writes immutable `campaign.json`, initializes empty `events.jsonl` and `approvals.jsonl`, writes initial `state.json` with `status: "awaiting_approval"`, and creates `tasks/` and `artifacts/` directories. `CampaignStore.open` validates existing files and refuses envelopes whose embedded digest does not match `computeEnvelopeDigest(stripDigest(envelope))`. All writes use `writeJsonAtomic` with mode `0o600`.

- [ ] **Step 4: Run envelope and store tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/campaign/envelope.test.js dist/test/campaign/store.test.js`

Expected: PASS for stable digest, directory layout, and digest mismatch rejection.

- [ ] **Step 5: Commit envelope and store**

```bash
git add src/campaign/types.ts src/campaign/envelope.ts src/campaign/store.ts test/campaign/envelope.test.ts test/campaign/store.test.ts
git commit -m "feat: add campaign envelope digest and store layout"
```

### Task 3: Lifecycle state machine and event replay

**Files:**
- Create: `src/campaign/state-machine.ts`
- Create: `src/campaign/replay.ts`
- Create: `test/campaign/state-machine.test.ts`
- Create: `test/campaign/replay.test.ts`

**Interfaces:**
- Consumes: `CampaignEvent`, `CampaignSnapshot`, `CampaignStatus`, `EventJournal`.
- Produces: `assertTransition(from, to): void`, `applyEvent(snapshot, event): CampaignSnapshot`, `replayEvents(events): CampaignSnapshot`.

- [ ] **Step 1: Write failing transition and replay tests**

```ts
// test/campaign/state-machine.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { assertTransition, applyEvent, initialSnapshot } from "../../src/campaign/state-machine.js";

test("allows draft to preflight and rejects skipping approval", () => {
  assert.doesNotThrow(() => assertTransition("draft", "preflight"));
  assert.throws(() => assertTransition("draft", "running"), /ILLEGAL_TRANSITION/);
});

test("running can pause and resume without rewriting history", () => {
  const snapshot = initialSnapshot("cmp-1", "sha256:digest");
  const paused = applyEvent(snapshot, {
    schemaVersion: 1,
    id: "evt-1",
    type: "state.changed",
    at: "2026-07-21T16:00:01.000Z",
    actor: "control-plane",
    from: "running",
    to: "paused",
    reason: "usage_limit",
    evidence: {}
  });
  assert.equal(paused.status, "paused");
});
```

```ts
// test/campaign/replay.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { replayEvents } from "../../src/campaign/replay.js";

test("rebuilds state.json from append-only events", () => {
  const snapshot = replayEvents("cmp-1", "sha256:digest", [
    {
      schemaVersion: 1,
      id: "evt-1",
      type: "state.changed",
      at: "2026-07-21T16:00:00.000Z",
      actor: "control-plane",
      from: "draft",
      to: "preflight",
      reason: "created",
      evidence: {}
    },
    {
      schemaVersion: 1,
      id: "evt-2",
      type: "state.changed",
      at: "2026-07-21T16:00:01.000Z",
      actor: "control-plane",
      from: "preflight",
      to: "awaiting_approval",
      reason: "proposal_ready",
      evidence: {}
    }
  ]);
  assert.equal(snapshot.status, "awaiting_approval");
});
```

- [ ] **Step 2: Build and verify state machine is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/campaign/state-machine.ts`.

- [ ] **Step 3: Implement the approved transition table**

Legal transitions exactly match design section 13:

```text
draft -> preflight -> awaiting_approval -> running -> final_review -> landing -> complete
running|paused|blocked may move among paused/blocked/running
draft|preflight|awaiting_approval|running|paused|blocked -> cancelled
post-push ambiguity -> hold
```

`assertTransition` throws `QuirksError("PROTOCOL_VIOLATION", "ILLEGAL_TRANSITION", { from, to })` on illegal edges. `applyEvent` updates `status`, `updatedAt`, and optional `pausedReason`/`blockedReason` from `reason` and `evidence` without deleting prior fields. `replayEvents` folds events in file order and rejects torn sequences where `from` does not match the current snapshot.

`initialSnapshot(campaignId, digest)` returns `{ schemaVersion: 1, campaignId, status: "draft", digest, updatedAt }`.

- [ ] **Step 4: Run state machine and replay suites**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/campaign/state-machine.test.js dist/test/campaign/replay.test.js`

Expected: PASS for every legal/illegal edge and replay reconstruction.

- [ ] **Step 5: Commit lifecycle machine**

```bash
git add src/campaign/state-machine.ts src/campaign/replay.ts test/campaign/state-machine.test.ts test/campaign/replay.test.ts
git commit -m "feat: add campaign lifecycle state machine and replay"
```

### Task 4: Digest-bound approval tokens and durable approval events

**Files:**
- Create: `src/campaign/approval.ts`
- Modify: `src/campaign/store.ts` (append helpers for approvals and events)
- Create: `test/campaign/approval.test.ts`

**Interfaces:**
- Consumes: `CampaignEnvelope`, `CampaignApproval`, `randomBytes`, `EventJournal`.
- Produces: `createApprovalChallenge({ campaignId, digest, ttlMs? })`, `consumeApprovalToken({ token, campaignId, digest, operator })`, `hasDurableApproval(store): Promise<boolean>`.

- [ ] **Step 1: Write failing approval binding tests**

```ts
// test/campaign/approval.test.ts
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { CampaignStore } from "../../src/campaign/store.js";

const envelope = {
  schemaVersion: 1 as const,
  campaignId: "cmp-approval",
  digest: "sha256:" + "a".repeat(64),
  repositoryId: "sha256:repo",
  createdAt: "2026-07-21T16:00:00.000Z",
  taskIds: ["QK-1"],
  taskRevisions: { "QK-1": "sha256:rev" },
  designModes: {},
  git: {
    baseCommit: "b".repeat(40),
    campaignBranch: "quirks/cmp-approval",
    targetBranch: "main",
    push: { enabled: false }
  },
  authority: ["repository"],
  routing: {},
  budgets: {
    maxTasks: 1,
    maxConcurrency: 1,
    maxWallClockMs: 1,
    maxRetries: 1,
    laneFailureThreshold: 2
  },
  verification: [],
  hashes: { config: "sha256:cfg", workflowPolicy: "sha256:wf", instructions: "sha256:ins" },
  externalRoutingEnabled: false
};

test("records one durable approval per digest and rejects replay", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-approval-"));
  const store = await CampaignStore.create({ stateDir, repositoryId: envelope.repositoryId, campaignId: envelope.campaignId, envelope });
  const challenge = createApprovalChallenge({ campaignId: envelope.campaignId, digest: envelope.digest, ttlMs: 60_000 });
  const approval = await consumeApprovalToken({
    store,
    token: challenge.token,
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    operator: { kind: "configured-profile", id: "operator@test" }
  });
  assert.equal(approval.digest, envelope.digest);
  await assert.rejects(
    () => consumeApprovalToken({
      store,
      token: challenge.token,
      campaignId: envelope.campaignId,
      digest: envelope.digest,
      operator: { kind: "configured-profile", id: "operator@test" }
    }),
    /APPROVAL_REPLAY/
  );
});

test("rejects digest mismatch and expired tokens without mutation", async () => {
  const challenge = createApprovalChallenge({ campaignId: "cmp-approval", digest: envelope.digest, ttlMs: 0 });
  await assert.rejects(
    () => consumeApprovalToken({
      store: undefined as never,
      token: challenge.token,
      campaignId: envelope.campaignId,
      digest: "sha256:" + "b".repeat(64),
      operator: { kind: "self-asserted", id: "x" }
    }),
    /DIGEST_MISMATCH/
  );
});
```

- [ ] **Step 2: Build and verify approval module is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/campaign/approval.ts`.

- [ ] **Step 3: Implement one-time approval challenges**

```ts
// src/campaign/approval.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { QuirksError } from "../core/errors.js";
import type { CampaignApproval } from "./types.js";
import type { CampaignStore } from "./store.js";

const MAX_TTL_MS = 15 * 60 * 1000;

export interface ApprovalOperator {
  kind: "configured-profile" | "authenticated-host" | "authenticated-provider" | "self-asserted";
  id: string;
}

interface ChallengeRecord {
  tokenId: string;
  campaignId: string;
  digest: string;
  expiresAt: string;
  consumedAt?: string;
}

const challenges = new Map<string, ChallengeRecord>();

export function createApprovalChallenge(input: {
  campaignId: string;
  digest: string;
  ttlMs?: number;
}): { token: string; tokenId: string; expiresAt: string } {
  const ttlMs = Math.min(input.ttlMs ?? MAX_TTL_MS, MAX_TTL_MS);
  const tokenId = createHash("sha256").update(randomBytes(32)).digest("hex");
  const token = createHash("sha256").update(`${tokenId}:${input.campaignId}:${input.digest}:${randomBytes(16).toString("hex")}`).digest("hex");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  challenges.set(token, { tokenId, campaignId: input.campaignId, digest: input.digest, expiresAt });
  return { token, tokenId, expiresAt };
}

export async function consumeApprovalToken(input: {
  store: CampaignStore;
  token: string;
  campaignId: string;
  digest: string;
  operator: ApprovalOperator;
}): Promise<CampaignApproval> {
  const record = challenges.get(input.token);
  if (!record) throw new QuirksError("PROTOCOL_VIOLATION", "Unknown approval token");
  if (record.campaignId !== input.campaignId) throw new QuirksError("PROTOCOL_VIOLATION", "Campaign mismatch");
  if (!timingSafeEqual(Buffer.from(record.digest), Buffer.from(input.digest))) {
    throw new QuirksError("PROTOCOL_VIOLATION", "DIGEST_MISMATCH");
  }
  if (record.consumedAt) throw new QuirksError("PROTOCOL_VIOLATION", "APPROVAL_REPLAY");
  if (Date.parse(record.expiresAt) <= Date.now()) throw new QuirksError("PROTOCOL_VIOLATION", "APPROVAL_EXPIRED");

  record.consumedAt = new Date().toISOString();
  const approval: CampaignApproval = {
    schemaVersion: 1,
    campaignId: input.campaignId,
    digest: input.digest,
    approvedAt: record.consumedAt,
    operator: input.operator,
    tokenId: record.tokenId,
    evidence: { channel: "headless" }
  };
  await input.store.appendApproval(approval);
  await input.store.appendEvent({
    schemaVersion: 1,
    id: `approval:${record.tokenId}`,
    type: "approval.recorded",
    at: approval.approvedAt,
    actor: input.operator.id,
    from: "awaiting_approval",
    to: "running",
    reason: "operator_approved",
    evidence: { digest: input.digest, tokenId: record.tokenId }
  });
  return approval;
}

export async function hasDurableApproval(store: CampaignStore, digest: string): Promise<boolean> {
  const approvals = await store.readApprovals();
  return approvals.some((entry) => entry.digest === digest);
}
```

Tokens live in memory for v1 control-plane tests and are delivered to the UI plan through a narrow `ApprovalService` port; they are never written to logs, cookies, or `approvals.jsonl` before consumption. `appendApproval` appends one canonical JSON line to `approvals.jsonl` and fsyncs.

- [ ] **Step 4: Run approval replay and mismatch tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/campaign/approval.test.js`

Expected: PASS for success, replay rejection, digest mismatch, and expiry.

- [ ] **Step 5: Commit approval binding**

```bash
git add src/campaign/approval.ts src/campaign/store.ts test/campaign/approval.test.ts
git commit -m "feat: add digest-bound campaign approval tokens"
```

### Task 5: Read-only preflight and immutable envelope assembly

**Files:**
- Create: `src/campaign/preflight.ts`
- Create: `src/campaign/git-inspect.ts`
- Create: `test/campaign/preflight.test.ts`
- Create: `test/fixtures/campaign-project/.agents/quirks.json`
- Create: `test/fixtures/campaign-project/.quirks/tasks.json`

**Interfaces:**
- Consumes: `loadProjectContext`, `createTaskSource`, `syncBoundary`, `finalizeEnvelope`, `RepositoryLock`, normalized tasks.
- Produces: `runPreflight(input): Promise<PreflightResult>` with `envelope`, `blockers`, `proposal`, and `syncHealth`.

- [ ] **Step 1: Write failing preflight tests**

```ts
// test/campaign/preflight.test.ts
import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { runPreflight } from "../../src/campaign/preflight.js";

const execFileAsync = promisify(execFile);
const fixture = path.resolve("test/fixtures/campaign-project");

async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-preflight-"));
  await cp(fixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  return root;
}

test("preflight is read-only and flags missing design dependencies", async () => {
  const root = await freshRepo();
  const result = await runPreflight({
    repositoryRoot: root,
    selectedTaskIds: ["QK-200"],
    externalRoutingEnabled: false
  });
  assert.equal(result.blockers.length > 0, true);
  assert.equal(result.mutatedRepository, false);
  assert.match(result.envelope.digest, /^sha256:/);
});
```

Fixture `QK-200` is an implementation task depending on a design task without an approved plan dependency.

- [ ] **Step 2: Build and verify preflight is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/campaign/preflight.ts`.

- [ ] **Step 3: Implement read-only preflight**

`runPreflight` must:

1. Load project context in `inspection` mode and open the selected `TaskSource`.
2. Call `syncBoundary({ boundary: "preflight", ... })` and surface pending/conflict state.
3. Expand `selectedTaskIds` to exact dependency closure; reject cycles and out-of-envelope IDs.
4. Record task-source, workflow-policy, and instruction hashes; never mutate canonical tasks.
5. Inspect Git with argv-only `git rev-parse HEAD`, `git status --porcelain`, and `git symbolic-ref --short HEAD` to populate `git.baseCommit`, dirty flag, and default branches.
6. Build `designModes` per task from workflow metadata; non-delegable tasks cannot be forced to delegated mode.
7. Resolve routing placeholders from effort/risk metadata (concrete profile binding happens in Task 7).
8. Return `finalizeEnvelope(...)` plus human-readable `blockers` and a `proposal` JSON read model for plan 3.

`git-inspect.ts` wraps Git calls with `execFile` and rejects dirty-tree unattended campaigns unless `mode: "inspection"`.

- [ ] **Step 4: Run preflight read-only and blocker tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/campaign/preflight.test.js`

Expected: PASS for dependency gate detection, hash recording, and zero repository mutation.

- [ ] **Step 5: Commit preflight**

```bash
git add src/campaign/preflight.ts src/campaign/git-inspect.ts test/campaign/preflight.test.ts test/fixtures/campaign-project
git commit -m "feat: add read-only campaign preflight"
```

### Task 6: Dependency waves and conflict lanes

**Files:**
- Create: `src/campaign/scheduler.ts`
- Create: `test/campaign/scheduler.test.ts`

**Interfaces:**
- Consumes: normalized tasks with `dependsOn` and `execution.parallelismKeys`.
- Produces: `buildExecutionPlan(tasks, budgets): ExecutionPlan` with `waves`, `lanes`, and `maxConcurrency`.

- [ ] **Step 1: Write failing scheduler tests**

```ts
// test/campaign/scheduler.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionPlan } from "../../src/campaign/scheduler.js";

const tasks = [
  { id: "A", dependsOn: [], parallelismKeys: ["shared"], status: "ready" },
  { id: "B", dependsOn: ["A"], parallelismKeys: ["shared"], status: "ready" },
  { id: "C", dependsOn: [], parallelismKeys: ["other"], status: "ready" }
] as const;

test("serializes parallelism key conflicts and respects dependency waves", () => {
  const plan = buildExecutionPlan([...tasks], { maxConcurrency: 3, maxTasks: 3 });
  assert.deepEqual(plan.waves[0]?.taskIds.sort(), ["A", "C"]);
  assert.equal(plan.lanes.some((lane) => lane.key === "shared" && lane.taskOrder.join(",") === "A,B"), true);
});
```

- [ ] **Step 2: Build and verify scheduler is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/campaign/scheduler.ts`.

- [ ] **Step 3: Implement wave and lane planning**

```ts
// src/campaign/scheduler.ts
export interface ExecutionTask {
  id: string;
  dependsOn: readonly string[];
  parallelismKeys: readonly string[];
  status: string;
}

export interface ExecutionLane {
  key: string;
  taskOrder: readonly string[];
}

export interface ExecutionWave {
  index: number;
  taskIds: readonly string[];
}

export interface ExecutionPlan {
  waves: readonly ExecutionWave[];
  lanes: readonly ExecutionLane[];
  maxConcurrency: number;
}

export function buildExecutionPlan(
  tasks: readonly ExecutionTask[],
  budgets: { maxConcurrency: number; maxTasks: number }
): ExecutionPlan {
  if (tasks.length > budgets.maxTasks) {
    throw new Error("TASK_BUDGET_EXCEEDED");
  }
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map<string, number>();
  for (const task of tasks) indegree.set(task.id, task.dependsOn.length);
  const waves: ExecutionWave[] = [];
  const scheduled = new Set<string>();
  let index = 0;
  while (scheduled.size < tasks.length) {
    const ready = tasks
      .filter((task) => !scheduled.has(task.id) && task.dependsOn.every((dep) => scheduled.has(dep)))
      .map((task) => task.id);
    if (ready.length === 0) throw new Error("DEPENDENCY_CYCLE");
    waves.push({ index: index++, taskIds: ready });
    for (const id of ready) scheduled.add(id);
  }
  const laneMap = new Map<string, string[]>();
  for (const task of tasks) {
    for (const key of task.parallelismKeys.length > 0 ? task.parallelismKeys : [`task:${task.id}`]) {
      const order = laneMap.get(key) ?? [];
      order.push(task.id);
      laneMap.set(key, order);
    }
  }
  const lanes = [...laneMap.entries()].map(([key, taskOrder]) => ({ key, taskOrder }));
  return { waves, lanes, maxConcurrency: Math.max(1, Math.min(budgets.maxConcurrency, tasks.length)) };
}
```

Lanes with overlapping `parallelismKeys` must not appear in the same concurrent dispatch set even when a wave contains multiple ready tasks. The scheduler exposes `selectRunnableTasks(plan, completed, activeLanes)` for the supervisor.

- [ ] **Step 4: Run scheduler tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/campaign/scheduler.test.js`

Expected: PASS for waves, lane serialization, cycle rejection, and task-count budget.

- [ ] **Step 5: Commit scheduler**

```bash
git add src/campaign/scheduler.ts test/campaign/scheduler.test.ts
git commit -m "feat: add dependency waves and conflict lanes"
```

### Task 7: Model and effort routing with forbidden downgrades

**Files:**
- Create: `src/campaign/routing.ts`
- Create: `test/campaign/routing.test.ts`

**Interfaces:**
- Consumes: `RunnerProfile`, normalized task `execution.effort` and `risk`, campaign envelope routing table.
- Produces: `resolveRoute(task, profiles, options): ResolvedRoute`, `assertTierCompatible(required, resolved)`.

- [ ] **Step 1: Write failing routing tests**

```ts
// test/campaign/routing.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoute, assertTierCompatible } from "../../src/campaign/routing.js";

const profiles = [
  { profileId: "claude-principal", runnerType: "claude", tier: "principal", effort: "principal", quotaPoolId: "pool-a", healthy: true, remainingAllocation: 10 },
  { profileId: "cursor-standard", runnerType: "cursor", tier: "standard", effort: "standard", quotaPoolId: "pool-b", healthy: true, remainingAllocation: 5 }
] as const;

test("requires principal supervision for delegated architecture", () => {
  const route = resolveRoute(
    { id: "D-1", effort: "principal", risk: ["architecture"] },
    [...profiles],
    { role: "supervisor" }
  );
  assert.equal(route.profileId, "claude-principal");
});

test("rejects tier downgrades not present in the approved envelope", () => {
  assert.throws(
    () => assertTierCompatible("principal", { tier: "standard", profileId: "cursor-standard" }),
    /TIER_DOWNGRADE/
  );
});
```

- [ ] **Step 2: Build and verify routing is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/campaign/routing.ts`.

- [ ] **Step 3: Implement routing rules from design section 11**

```ts
// src/campaign/routing.ts
export type JudgmentTier = "mechanical" | "standard" | "high" | "principal";
export type RunnerType = "claude" | "codex" | "cursor";

export interface RoutableProfile {
  profileId: string;
  runnerType: RunnerType;
  tier: JudgmentTier;
  effort: JudgmentTier;
  quotaPoolId: string;
  healthy: boolean;
  remainingAllocation: number;
}

export interface ResolvedRoute {
  profileId: string;
  runnerType: RunnerType;
  tier: JudgmentTier;
  effort: JudgmentTier;
  quotaPoolId: string;
}

const TIER_RANK: Record<JudgmentTier, number> = {
  mechanical: 0,
  standard: 1,
  high: 2,
  principal: 3
};

export function assertTierCompatible(required: JudgmentTier, resolved: ResolvedRoute): void {
  if (TIER_RANK[resolved.tier] < TIER_RANK[required]) {
    throw new Error("TIER_DOWNGRADE");
  }
}

export function resolveRoute(
  task: { id: string; effort: JudgmentTier; risk: readonly string[] },
  profiles: readonly RoutableProfile[],
  options: { role: "supervisor" | "implementer" | "reviewer"; preferredProfileId?: string }
): ResolvedRoute {
  const required: JudgmentTier = options.role === "supervisor" ? "principal" : task.effort;
  const compatible = profiles
    .filter((profile) => profile.healthy && TIER_RANK[profile.tier] >= TIER_RANK[required])
    .sort((left, right) => right.remainingAllocation - left.remainingAllocation);
  const chosen = options.preferredProfileId
    ? compatible.find((profile) => profile.profileId === options.preferredProfileId)
    : compatible[0];
  if (!chosen) throw new Error("NO_COMPATIBLE_ROUTE");
  return {
    profileId: chosen.profileId,
    runnerType: chosen.runnerType,
    tier: chosen.tier,
    effort: chosen.effort,
    quotaPoolId: chosen.quotaPoolId
  };
}
```

Routing prefers the healthy quota pool with the most remaining approved allocation, then lowest campaign spend (spend plumbed in Task 13). Reviewer routes must be at least one tier above implementer effort for judgment-heavy tasks. Usage-limit failures are never silently retried on a lower tier.

- [ ] **Step 4: Run routing tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/campaign/routing.test.js`

Expected: PASS for supervisor principal requirement, pool preference, and downgrade rejection.

- [ ] **Step 5: Commit routing**

```bash
git add src/campaign/routing.ts test/campaign/routing.test.ts
git commit -m "feat: add model and effort routing"
```

### Task 8: Runner profile loading from user configuration

**Files:**
- Create: `src/runner/types.ts`
- Create: `src/runner/profiles.ts`
- Create: `test/runner/profiles.test.ts`
- Create: `test/fixtures/runner-profiles/profiles.json`

**Interfaces:**
- Consumes: `validateSchema("runner-profile-v1")`, user config directory resolution.
- Produces: `loadRunnerProfiles(options): Promise<readonly RunnerProfile[]>`, `loadHostProfile(): HostProfile`.

- [ ] **Step 1: Write failing profile validation tests**

```ts
// test/runner/profiles.test.ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadRunnerProfiles } from "../../src/runner/profiles.js";

test("loads sanitized runner profiles without credential material", async () => {
  const profiles = await loadRunnerProfiles({
    configDir: path.resolve("test/fixtures/runner-profiles")
  });
  assert.equal(profiles.length, 3);
  for (const profile of profiles) {
    assert.equal("credential" in profile, false);
    assert.match(profile.profileId, /^[a-z0-9-]+$/);
  }
});

test("rejects profiles whose tier alias weakens declared capability", async () => {
  await assert.rejects(
    () => loadRunnerProfiles({
      configDir: path.resolve("test/fixtures/runner-profiles-invalid")
    }),
    /TIER_DOWNGRADE/
  );
});
```

- [ ] **Step 2: Build and verify profile loader is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/runner/profiles.ts`.

- [ ] **Step 3: Implement profile loading**

```ts
// src/runner/types.ts
import type { validateSchema } from "../schema/validate.js";

export type RunnerProfile = ReturnType<typeof validateSchema<"runner-profile-v1">>;
export type HostProfile = ReturnType<typeof validateSchema<"host-profile-v1">>;
export type RunnerJobResult = ReturnType<typeof validateSchema<"runner-job-result-v1">>;
```

`loadRunnerProfiles` reads `profiles.json` from `QUIRKS_CONFIG_DIR` or platform default (`~/.config/quirks` on POSIX), validates every profile, rejects embedded secrets via the same secret-shape detector used by external adapters, and requires each profile to declare `quotaPoolId`, `tier`, `model`, `effort`, and `capabilities`. Profiles referencing `accountAlias` never inline credential values.

- [ ] **Step 4: Run profile loader tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/runner/profiles.test.js`

Expected: PASS for valid fixtures and invalid-tier rejection.

- [ ] **Step 5: Commit runner profiles**

```bash
git add src/runner/types.ts src/runner/profiles.ts test/runner/profiles.test.ts test/fixtures/runner-profiles
git commit -m "feat: load validated runner profiles from user config"
```

### Task 9: Claude, Codex, and Cursor argv builders

**Files:**
- Create: `src/runner/claude.ts`
- Create: `src/runner/codex.ts`
- Create: `src/runner/cursor.ts`
- Create: `test/runner/argv-builders.test.ts`

**Interfaces:**
- Consumes: `RunnerProfile`, bounded brief paths, generated session IDs.
- Produces: `buildClaudeArgv(input): readonly string[]`, `buildCodexArgv(input)`, `buildCursorArgv(input)`, and matching `parse*Result(stdout, artifacts)`.

- [ ] **Step 1: Write failing argv builder tests**

```ts
// test/runner/argv-builders.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildClaudeArgv } from "../../src/runner/claude.js";
import { buildCodexArgv } from "../../src/runner/codex.js";
import { buildCursorArgv } from "../../src/runner/cursor.js";

test("claude argv uses explicit session id and never enables permission bypass by default", () => {
  const argv = buildClaudeArgv({
    executable: "/usr/bin/claude",
    sessionId: "11111111-1111-4111-8111-111111111111",
    model: "fable",
    effort: "high",
    briefPath: "artifacts/job-1/brief.md",
    workspace: "/tmp/worktree"
  });
  assert.equal(argv.includes("--dangerously-skip-permissions"), false);
  assert.equal(argv.includes("--session-id"), true);
  assert.equal(argv[0], "/usr/bin/claude");
  assert.equal(argv.includes("-p"), true);
});

test("codex and cursor use non-interactive entry points", () => {
  const codex = buildCodexArgv({
    executable: "/usr/bin/codex",
    sessionId: "sess-1",
    model: "gpt-5.6-terra-medium",
    briefPath: "artifacts/job-1/brief.md",
    workspace: "/tmp/worktree"
  });
  assert.deepEqual(codex.slice(0, 2), ["/usr/bin/codex", "exec"]);
  const cursor = buildCursorArgv({
    executable: "/usr/bin/agent",
    sessionId: "thread-1",
    model: "composer-2.5",
    briefPath: "artifacts/job-1/brief.md",
    workspace: "/tmp/worktree"
  });
  assert.equal(cursor.includes("-p"), true);
});
```

- [ ] **Step 2: Build and verify argv builders are missing**

Run: `pnpm build`

Expected: FAIL with missing `src/runner/claude.ts`.

- [ ] **Step 3: Implement argv builders and parsers**

Claude builder requirements from design section 16.2:

- generate UUID before launch and pass `--session-id`;
- use `claude -p` with explicit `--model` and effort flags from profile;
- pass brief by file path, never interpolate brief prose into argv;
- optional `CLAUDE_CONFIG_DIR` only when profile declares `configDir`;
- resume argv helper `buildClaudeResumeArgv(sessionId, ...)`.

Codex uses `codex exec` plus `codex exec resume <id>` helper; final result is read from the declared artifact path, not stdout transcript.

Cursor uses `agent -p` with `--resume <thread-id>` helper; structured result events are parsed from stdout JSONL.

Each parser returns `{ status, sessionHandle, artifactPaths, failure }` without treating prose "done" as success.

- [ ] **Step 4: Run argv builder tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/runner/argv-builders.test.js`

Expected: PASS for argv shapes and default permission posture.

- [ ] **Step 5: Commit argv builders**

```bash
git add src/runner/claude.ts src/runner/codex.ts src/runner/cursor.ts test/runner/argv-builders.test.ts
git commit -m "feat: add claude codex cursor argv builders"
```

### Task 10: Runner dispatch, job results, and on-disk verification hooks

**Files:**
- Create: `src/runner/dispatcher.ts`
- Create: `src/runner/job-result.ts`
- Create: `test/runner/dispatcher.test.ts`
- Create: `test/fixtures/fake-runners/fake-claude.mjs`

**Interfaces:**
- Consumes: argv builders, `RunnerProfile`, `CampaignStore` artifact directory.
- Produces: `dispatchRunnerJob(input): Promise<RunnerJobResult>`, `verifyJobArtifacts(result, expectations)`.

- [ ] **Step 1: Write failing dispatcher tests**

```ts
// test/runner/dispatcher.test.ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { dispatchRunnerJob } from "../../src/runner/dispatcher.js";

test("dispatch spawns argv directly without a shell and normalizes success", async () => {
  const result = await dispatchRunnerJob({
    jobId: "job-1",
    profile: {
      schemaVersion: 1,
      profileId: "fake-claude",
      runnerType: "claude",
      executable: process.execPath,
      accountAlias: "default",
      quotaPoolId: "pool",
      tier: "standard",
      model: "test-model",
      effort: "standard",
      capabilities: ["repository-read"],
      wallClockMs: 5_000,
      redactionRules: []
    },
    argv: [process.execPath, path.resolve("test/fixtures/fake-runners/fake-claude.mjs"), "--mode", "success"],
    artifactDir: await makeTempArtifactDir(),
    timeoutMs: 5_000
  });
  assert.equal(result.status, "success");
  assert.match(result.sessionHandle, /./);
});
```

- [ ] **Step 2: Build and verify dispatcher is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/runner/dispatcher.ts`.

- [ ] **Step 3: Implement spawn-without-shell dispatch**

```ts
// src/runner/job-result.ts
import type { RunnerJobResult } from "./types.js";

export function normalizeJobResult(input: {
  jobId: string;
  profileId: string;
  runnerType: "claude" | "codex" | "cursor";
  resolvedModel: string;
  effort: string;
  status: RunnerJobResult["status"];
  sessionHandle: string;
  artifactPaths: readonly string[];
  failure: RunnerJobResult["failure"];
}): RunnerJobResult {
  return {
    schemaVersion: 1,
    jobId: input.jobId,
    runner: input.profileId,
    runnerType: input.runnerType,
    resolvedModel: input.resolvedModel,
    effort: input.effort,
    status: input.status,
    sessionHandle: input.sessionHandle,
    artifactPaths: [...input.artifactPaths],
    usage: {},
    failure: input.failure
  };
}
```

`dispatchRunnerJob` calls `spawn(argv[0], argv.slice(1), { shell: false, stdio: ["ignore", "pipe", "pipe"] })`, enforces stdout/stderr byte limits, classifies permission-denied exit-zero as `permission_denied`, and never parses prose completion without artifact verification. `verifyJobArtifacts` checks expected files exist and optional schema-valid JSON result envelopes are present.

The fake Claude runner supports `--mode success|exit-zero-denied|timeout|malformed|usage-limit`.

- [ ] **Step 4: Run dispatcher and permission-denial tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/runner/dispatcher.test.js`

Expected: PASS for success, exit-zero permission denial, malformed output rejection, and timeout classification.

- [ ] **Step 5: Commit runner dispatch**

```bash
git add src/runner/dispatcher.ts src/runner/job-result.ts test/runner/dispatcher.test.ts test/fixtures/fake-runners/fake-claude.mjs
git commit -m "feat: add runner dispatch and normalized job results"
```

### Task 11: Session registry and liveness metadata

**Files:**
- Create: `src/runner/sessions.ts`
- Create: `test/runner/sessions.test.ts`
- Modify: `src/campaign/store.ts` (persist `sessions.json`)

**Interfaces:**
- Consumes: `RunnerJobResult`, `CampaignStore`.
- Produces: `SessionRegistry.register/update/list`, opaque handles with heartbeat timestamps and artifact paths.

- [ ] **Step 1: Write failing session registry tests**

```ts
// test/runner/sessions.test.ts
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionRegistry } from "../../src/runner/sessions.js";
import { CampaignStore } from "../../src/campaign/store.js";

test("records session handles and heartbeats for recovery", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-sessions-"));
  const store = await openMinimalStore(stateDir);
  const registry = await SessionRegistry.open(store);
  await registry.register({
    jobId: "job-1",
    role: "implementer",
    profileId: "cursor-standard",
    sessionHandle: "thread-1",
    pid: process.pid,
    artifactPaths: ["artifacts/job-1/result.json"]
  });
  const sessions = await registry.list();
  assert.equal(sessions.length, 1);
  assert.match(sessions[0]?.lastHeartbeatAt ?? "", /202/);
});
```

- [ ] **Step 2: Build and verify session registry is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/runner/sessions.ts`.

- [ ] **Step 3: Implement sessions.json persistence**

```ts
// src/runner/sessions.ts
export interface SessionRecord {
  schemaVersion: 1;
  jobId: string;
  role: "supervisor" | "implementer" | "reviewer";
  profileId: string;
  sessionHandle: string;
  pid: number;
  startedAt: string;
  lastHeartbeatAt: string;
  artifactPaths: readonly string[];
  terminalStatus?: string;
}
```

`SessionRegistry` reads/writes `sessions.json` atomically, updates `lastHeartbeatAt` on watchdog ticks, and marks terminal status without deleting history.

- [ ] **Step 4: Run session registry tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/runner/sessions.test.js`

Expected: PASS for register, heartbeat, and terminal update.

- [ ] **Step 5: Commit session registry**

```bash
git add src/runner/sessions.ts src/campaign/store.ts test/runner/sessions.test.ts
git commit -m "feat: add durable runner session registry"
```

### Task 12: Watchdog, detached execution, and resume probes

**Files:**
- Create: `src/runner/watchdog.ts`
- Create: `scripts/quirks-watchdog`
- Create: `test/runner/watchdog.test.ts`
- Modify: `package.json` (add `quirks-watchdog` bin)

**Interfaces:**
- Consumes: `SessionRegistry`, `dispatchRunnerJob`, `CampaignStore`, `EventJournal`.
- Produces: `startDetachedJob(input): Promise<{ campaignId, jobId }>`, `probeLiveness(jobId): Promise<LivenessReport>`, `resumeJob(jobId): Promise<RunnerJobResult>`.

- [ ] **Step 1: Write failing watchdog tests**

```ts
// test/runner/watchdog.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { probeLiveness, startDetachedJob } from "../../src/runner/watchdog.js";

test("records PID and heartbeat before returning campaign ID", async () => {
  const { campaignId, jobId } = await startDetachedJob({
    campaignId: "cmp-1",
    argv: fakeArgv("success"),
    timeoutMs: 5_000
  });
  assert.match(campaignId, /cmp-/);
  const liveness = await probeLiveness(jobId);
  assert.equal(liveness.pid > 0, true);
  assert.equal(liveness.outputGrowing || liveness.terminal, true);
});
```

- [ ] **Step 2: Build and verify watchdog is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/runner/watchdog.ts`.

- [ ] **Step 3: Implement watchdog ownership**

Watchdog behavior from design sections 16.3 and 17:

1. Append a `runner.dispatched` event with PID, session handle, artifact paths, timeout, and cancel scope.
2. Start child with `detached: true` only after journal fsync.
3. Record heartbeat files under `artifacts/<job-id>/heartbeat.json`.
4. `probeLiveness` checks output growth, process liveness, worktree modifications (via `WorktreePort`), runner-native transcript recovery, then one permitted resume.
5. `scripts/quirks-watchdog` is a thin Node entry that calls the same module for manual reattachment.

No blind PID polling loops in the supervisor; all probes are bounded.

- [ ] **Step 4: Run watchdog detach and probe tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/runner/watchdog.test.js`

Expected: PASS for durable start metadata, heartbeat updates, and timeout pause classification.

- [ ] **Step 5: Commit watchdog**

```bash
git add src/runner/watchdog.ts scripts/quirks-watchdog package.json test/runner/watchdog.test.ts
git commit -m "feat: add runner watchdog and detached execution"
```

### Task 13: Budgets, circuit breakers, and failure classification

**Files:**
- Create: `src/campaign/budgets.ts`
- Create: `src/campaign/circuit-breakers.ts`
- Create: `src/campaign/failures.ts`
- Create: `test/campaign/budgets.test.ts`
- Create: `test/campaign/circuit-breakers.test.ts`
- Create: `test/campaign/failures.test.ts`

**Interfaces:**
- Consumes: `CampaignEnvelope.budgets`, `RunnerJobResult`, spend counters on `CampaignSnapshot`.
- Produces: `BudgetTracker`, `evaluateCircuitBreakers(input)`, `classifyFailure(result): FailureClass`.

- [ ] **Step 1: Write failing budget and breaker tests**

```ts
// test/campaign/circuit-breakers.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCircuitBreakers } from "../../src/campaign/circuit-breakers.js";

test("pauses a lane after two consecutive task failures", () => {
  const decision = evaluateCircuitBreakers({
    laneFailureThreshold: 2,
    consecutiveLaneFailures: 2,
    integrationFailure: false,
    envelopeDrift: false,
    usageLimitWithoutReset: false
  });
  assert.equal(decision.action, "pause_lane");
});

test("pauses the campaign after integration verification failure", () => {
  const decision = evaluateCircuitBreakers({
    laneFailureThreshold: 2,
    consecutiveLaneFailures: 0,
    integrationFailure: true,
    envelopeDrift: false,
    usageLimitWithoutReset: false
  });
  assert.equal(decision.action, "pause_campaign");
});
```

```ts
// test/campaign/failures.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { classifyFailure } from "../../src/campaign/failures.js";

test("classifies usage limits and permission denials without generic retry", () => {
  assert.equal(classifyFailure({ status: "usage_limit" }), "usage_limit");
  assert.equal(classifyFailure({ status: "permission_denied" }), "permission_denial");
  assert.equal(classifyFailure({ status: "failure", retryable: true }), "transient_runner");
});
```

- [ ] **Step 2: Build and verify budget modules are missing**

Run: `pnpm build`

Expected: FAIL with missing `src/campaign/budgets.ts`.

- [ ] **Step 3: Implement budgets, breakers, and failure classes**

Failure classes from design section 21: `task_rejection`, `honest_partial`, `transient_runner`, `usage_limit`, `permission_denial`, `fabricated_evidence`, `wedge_after_work`, `task_source_conflict`, `task_source_outage`, `ambiguous_mutation`, `integration_failure`, `pre_push_landing_failure`, `post_push_ambiguity`, `crash_restart`.

Defaults from design section 19:

- one resume/retry for classified transient runner failure;
- no retry for usage-limit before reset/probe;
- pause lane after two consecutive task failures;
- pause campaign on integration/post-merge verification failure;
- stop before exceeding approved token/cost/wall-clock ceilings;
- pause on envelope or task revision drift;
- hold after ambiguous accepted/pushed state.

`BudgetTracker` increments task count, wall clock, token/cost estimates when present, and retry count; it throws `BUDGET_EXCEEDED` before dispatch when a ceiling would be crossed.

- [ ] **Step 4: Run budget, breaker, and classification tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/campaign/budgets.test.js dist/test/campaign/circuit-breakers.test.js dist/test/campaign/failures.test.js`

Expected: PASS for all default breaker thresholds and failure classes.

- [ ] **Step 5: Commit budgets and breakers**

```bash
git add src/campaign/budgets.ts src/campaign/circuit-breakers.ts src/campaign/failures.ts test/campaign/budgets.test.ts test/campaign/circuit-breakers.test.ts test/campaign/failures.test.ts
git commit -m "feat: add campaign budgets circuit breakers and failure classes"
```

### Task 14: Campaign supervisor orchestration and crash recovery

**Files:**
- Create: `src/campaign/supervisor.ts`
- Create: `src/campaign/recovery.ts`
- Create: `src/campaign/ports.ts`
- Create: `test/campaign/supervisor.test.ts`
- Create: `test/campaign/recovery.test.ts`

**Interfaces:**
- Consumes: all campaign modules, `RepositoryLock`, `SyncOutbox`, `reconcileMutation`, `dispatchRunnerJob`, `WorktreePort`.
- Produces: `CampaignSupervisor.startApproved(input)`, `CampaignSupervisor.tick()`, `recoverCampaign(store): Promise<RecoveryReport>`.

- [ ] **Step 1: Write failing supervisor gate tests**

```ts
// test/campaign/supervisor.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { CampaignSupervisor } from "../../src/campaign/supervisor.js";
import { FakeWorktreePort } from "./support/fake-worktree.js";
import { FakeRunnerPort } from "./support/fake-runner-port.js";

test("refuses claim before durable approval exists", async () => {
  const supervisor = await CampaignSupervisor.open(testContext());
  await assert.rejects(() => supervisor.startApproved(), /APPROVAL_REQUIRED/);
});

test("claims and dispatches only approved tasks after approval", async () => {
  const supervisor = await CampaignSupervisor.open(testContext());
  await supervisor.recordApproval(testApproval());
  await supervisor.startApproved();
  const status = await supervisor.status();
  assert.equal(status.claimedTaskIds.includes("QK-101"), true);
  assert.equal(status.dispatchedJobs.length, 1);
});
```

```ts
// test/campaign/recovery.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { recoverCampaign } from "../../src/campaign/recovery.js";

test("reconstructs running jobs from events and sessions without duplicating dispatch", async () => {
  const report = await recoverCampaign(await crashedStoreFixture());
  assert.equal(report.duplicateDispatchesPrevented >= 1, true);
  assert.equal(report.state.status, "paused");
});
```

- [ ] **Step 2: Build and verify supervisor is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/campaign/supervisor.ts`.

- [ ] **Step 3: Implement supervisor and recovery**

```ts
// src/campaign/ports.ts
export interface WorktreePort {
  prepareTaskWorktree(taskId: string, baseCommit: string): Promise<{ path: string; branch: string }>;
  listModifiedFiles(path: string): Promise<readonly string[]>;
  readCommit(path: string): Promise<string | undefined>;
}

export interface RunnerPort {
  dispatch(input: {
    jobId: string;
    taskId: string;
    role: "supervisor" | "implementer" | "reviewer";
    route: ResolvedRoute;
    briefPath: string;
    worktreePath: string;
  }): Promise<RunnerJobResult>;
}
```

`CampaignSupervisor.startApproved` sequence (design section 14, minus Git landing):

1. Acquire `RepositoryLock` with `local-clone` scope.
2. Revalidate envelope hashes and `syncBoundary({ boundary: "claim", ... })`.
3. Require `hasDurableApproval` for the current digest.
4. Claim eligible tasks through `reconcileMutation` with durable intents.
5. Build execution plan and dispatch runnable tasks through `RunnerPort`.
6. Record `runner.dispatched` and session handles before accepting results.
7. Verify artifacts and classify failures; pause lane/campaign per breakers.
8. Never complete tasks locally without required sync acknowledgement.

`recoverCampaign` replays events, reloads `sessions.json`, checks live PIDs, rebuilds `state.json`, and pauses when envelope/task revision drift is detected. Stale-lock takeover verifies process, session, and Git evidence before replacing the lock.

- [ ] **Step 4: Run supervisor and recovery tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/campaign/supervisor.test.js dist/test/campaign/recovery.test.js`

Expected: PASS for approval gate, claim ordering, duplicate-dispatch prevention, and crash reconstruction.

- [ ] **Step 5: Commit supervisor orchestration**

```bash
git add src/campaign/supervisor.ts src/campaign/recovery.ts src/campaign/ports.ts test/campaign/supervisor.test.ts test/campaign/recovery.test.ts test/campaign/support
git commit -m "feat: add campaign supervisor orchestration and recovery"
```

### Task 15: Fake runners, fake hosts, and failure-mode fixtures

**Files:**
- Create: `test/fixtures/fake-runners/fake-codex.mjs`
- Create: `test/fixtures/fake-runners/fake-cursor.mjs`
- Create: `test/fixtures/fake-hosts/fake-host.mjs`
- Create: `test/runner/fake-runner-matrix.test.ts`
- Create: `test/campaign/support/fake-runner-port.ts`
- Create: `test/campaign/support/fake-worktree.ts`

**Interfaces:**
- Consumes: dispatcher, watchdog, failure classifier, supervisor.
- Produces: deterministic fixtures for every design section 23.3 scenario.

- [ ] **Step 1: Write failing fake-runner matrix test**

```ts
// test/runner/fake-runner-matrix.test.ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { dispatchRunnerJob } from "../../src/runner/dispatcher.js";
import { classifyFailure } from "../../src/campaign/failures.js";

const modes = [
  "success",
  "success-no-disk",
  "permission-exit-zero",
  "partial",
  "malformed",
  "oversized",
  "transient",
  "usage-limit",
  "silence",
  "wedge-after-work",
  "non-resumable",
  "fabricated-tests"
] as const;

for (const mode of modes) {
  test(`fake claude handles mode ${mode} deterministically`, async () => {
    const result = await dispatchRunnerJob(fakeJob("fake-claude.mjs", mode));
    const failureClass = classifyFailure(result);
    assert.equal(typeof failureClass, "string");
  });
}
```

- [ ] **Step 2: Run matrix against missing fixtures**

Run: `pnpm build && node --test dist/test/runner/fake-runner-matrix.test.js`

Expected: FAIL with missing `fake-codex.mjs` or `fake-cursor.mjs`.

- [ ] **Step 3: Implement fake runners and fake host launcher**

Each fake runner accepts `--mode <name>` and writes predictable artifacts under `QUIRKS_FAKE_RUNNER_OUTDIR`. Modes mirror design section 23.3:

- `success` valid artifacts;
- `success-no-disk` prose only;
- `permission-exit-zero`;
- `partial` half-finished output;
- `malformed` and `oversized` output;
- `transient` and `usage-limit`;
- `silence` until timeout;
- `wedge-after-work` completes disk work then hangs;
- `non-resumable` invalid resume handle;
- `fabricated-tests` claims pass without test output;
- `cancel` and `orphan` cleanup modes.

`fake-host.mjs` simulates foreground completion, host conversation loss after durable `start`, later `attach` by campaign ID, and scoped cancel.

- [ ] **Step 4: Run the full fake-runner matrix**

Run: `node --test dist/test/runner/fake-runner-matrix.test.js`

Expected: PASS for all modes on Claude, Codex, and Cursor fakes.

- [ ] **Step 5: Commit fake-runner fixtures**

```bash
git add test/fixtures/fake-runners test/fixtures/fake-hosts test/runner/fake-runner-matrix.test.ts test/campaign/support
git commit -m "test: add fake runner and host failure fixtures"
```

### Task 16: `quirks-campaign` CLI and control-plane acceptance suite

**Files:**
- Modify: `src/cli/quirks-campaign.ts`
- Create: `src/cli/campaign-args.ts`
- Modify: `src/index.ts`
- Create: `test/integration/campaign-control-plane.test.ts`
- Create: `test/cli/quirks-campaign.test.ts`

**Interfaces:**
- Consumes: preflight, approval, supervisor, recovery, watchdog, JSON output helpers.
- Produces: CLI commands `preflight`, `approve`, `start`, `status`, `attach`, `resume`, `cancel` with `--json` mode.

- [ ] **Step 1: Write failing CLI acceptance test**

```ts
// test/integration/campaign-control-plane.test.ts
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("preflight, headless approval, start, status, and recovery work without UI", async () => {
  const cli = path.resolve("dist/src/cli/quirks-campaign.js");
  const cwd = path.resolve("test/fixtures/campaign-project");
  const preflight = JSON.parse((await execFileAsync(process.execPath, [cli, "preflight", "--task", "QK-101", "--json"], { cwd, env: testEnv() })).stdout);
  assert.equal(preflight.ok, true);
  const approve = JSON.parse((await execFileAsync(process.execPath, [cli, "approve", "--campaign", preflight.campaignId, "--digest", preflight.envelope.digest, "--json"], { cwd, env: testEnv() })).stdout);
  assert.equal(approve.ok, true);
  const start = JSON.parse((await execFileAsync(process.execPath, [cli, "start", "--campaign", preflight.campaignId, "--json"], { cwd, env: testEnv() })).stdout);
  assert.match(start.campaignId, /./);
  const status = JSON.parse((await execFileAsync(process.execPath, [cli, "status", "--campaign", preflight.campaignId, "--json"], { cwd, env: testEnv() })).stdout);
  assert.equal(status.localCoordinationOnly, true);
});
```

- [ ] **Step 2: Run CLI test against placeholder**

Run: `pnpm build && node --test dist/test/integration/campaign-control-plane.test.js`

Expected: FAIL because `quirks-campaign` still exits 2 with the placeholder message.

- [ ] **Step 3: Replace placeholder CLI**

`campaign-args.ts` accepts only:

```text
quirks-campaign preflight --task TASK_ID [--task TASK_ID ...] [--config PATH] [--external-routing|--no-external-routing] [--json]
quirks-campaign approve --campaign ID --digest DIGEST [--json]
quirks-campaign start --campaign ID [--json]
quirks-campaign status --campaign ID [--json]
quirks-campaign attach --campaign ID [--json]
quirks-campaign resume --campaign ID [--json]
quirks-campaign cancel --campaign ID [--scope JOB_ID] [--json]
```

JSON stdout is one bounded object; diagnostics go to stderr. Human output states `Local coordination only`. `approve` uses `createApprovalChallenge` immediately followed by `consumeApprovalToken` for headless tests; plan 3 replaces the transport, not the approval records. `start` requires durable approval, acquires the repository lock, starts the supervisor, and returns after watchdog metadata is durable. Export public campaign and runner factories from `src/index.ts` without exposing internal file helpers.

- [ ] **Step 4: Run the full control-plane acceptance suite**

Run: `pnpm check`

Expected: PASS with lint, typecheck, foundation tests, and new campaign/runner suites.

Run: `node --test dist/test/integration/campaign-control-plane.test.js dist/test/cli/quirks-campaign.test.js`

Expected: PASS for preflight, approval gate, start/status, attach after simulated host loss, cancel scope, and recovery without duplicate dispatch.

- [ ] **Step 5: Commit control-plane CLI**

```bash
git add src/cli/quirks-campaign.ts src/cli/campaign-args.ts src/index.ts test/integration/campaign-control-plane.test.ts test/cli/quirks-campaign.test.ts
git commit -m "feat: expose quirks campaign control plane CLI"
```

## Plan Boundary Verification

- [ ] Run `pnpm check` from a clean worktree and record the command plus exit code in the task provenance candidate.
- [ ] Run `node --test dist/test/integration/campaign-control-plane.test.js` and the full fake-runner matrix without any real Claude, Codex, or Cursor credentials.
- [ ] Confirm no task claims, runner dispatches, or task-source mutations occur before a durable digest-bound approval event.
- [ ] Confirm `quirks-campaign status --json` reports `localCoordinationOnly: true` and never implies a global lease.
- [ ] Search new files for absolute personal paths, credentials, shell command strings, `TODO`, `TBD`, and `FIXME`; only disposable fixture identifiers may appear as project names.
- [ ] Confirm loopback HTML, CSP, browser tests, Git worktree creation, merge, and push are absent from this diff and remain in plans 3 and 4.
- [ ] Request an independent review of the full control-plane diff against design sections 10, 11, 12, 13, 14, 16, 17, 19, 21, and 23.2–23.3 before beginning skills/Git integration.
