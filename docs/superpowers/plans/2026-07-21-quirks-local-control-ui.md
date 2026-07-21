# Quirks Local Control UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the ephemeral loopback local control workspace—secure approval API, provider-neutral Existing Tasks / Preflight Proposal / Campaigns / Task History projections, nonce-CSP client shell, visual states, and browser-backed security tests—without making rendered HTML a state store.

**Architecture:** Plan 3 of the Quirks v1 suite. A framework-independent Node `http` server binds only to `127.0.0.1`, serves a nonce-CSP shell with zero embedded proposal data, and exposes bounded JSON read APIs plus a single `POST /api/v1/approval` mutation. The browser is a single locally built React bundle using code-based TanStack Router, TanStack Query, TanStack Table, and TanStack Form; TanStack Start and framework-owned server routes are intentionally absent. Read models are pure projections over the frozen kernel (`TaskSource`, `syncBoundary`, `buildTaskHistory`) and over control-plane ports defined here but implemented in `2026-07-21-quirks-campaign-control-plane.md`. Approval consumes a one-time fragment-delivered token bound to campaign ID and envelope digest; the control plane records the durable approval event.

**Tech Stack:** Node.js 24 LTS (`>=24.18.0`), TypeScript 7.0.2, ESM, pnpm 10.30.3, Node `node:test`, React/React DOM 19.2.8, TanStack Router 1.170.18, TanStack Query 5.101.4, TanStack Table 8.21.3, TanStack Form 1.33.2, Ajv 8.20.0 (build-time validators only), Oxlint 1.74.0, esbuild 0.25.9 (dev-only UI client bundle), Playwright 1.54.2 (dev-only browser tests), TanStack CLI 0.69.6 and Intent 0.3.6 (one-shot development tooling only).

## Ordered Plan Suite

| Order | Planned document | Starts after |
|---|---|---|
| 1 | `2026-07-21-quirks-foundation-task-sources.md` | approved design |
| 2 | `2026-07-21-quirks-campaign-control-plane.md` | foundation review (`QK-FND-013`) |
| 3 | `2026-07-21-quirks-local-control-ui.md` (this plan) | foundation review (`QK-FND-013`); may execute Tasks 1–6 alongside control-plane Tasks 1–2 |
| 4 | `2026-07-21-quirks-skills-git-integration.md` | approved control-plane and UI boundaries |
| 5 | `2026-07-21-quirks-host-integration-acceptance.md` | approved UI, skills, Git, and runner boundaries |

### Control-plane coupling (read-only for this plan)

This plan **does not** implement campaign scheduling, runner dispatch, envelope canonicalization, or supervisor state transitions. It defines UI-facing ports that the control-plane plan must satisfy:

| Port | Owner | UI usage |
|---|---|---|
| `PreflightReadPort.getProposal(campaignId)` | control plane | Preflight Proposal JSON + digest display |
| `ApprovalWritePort.issueToken(campaignId, envelopeDigest)` | control plane | URL fragment token minting at `awaiting_approval` |
| `ApprovalWritePort.approve({ campaignId, token, envelopeDigest, operator })` | control plane | sole durable mutation path |
| `CampaignReadPort.listSummaries(filter)` | control plane | Campaigns list |
| `CampaignReadPort.getDetail(campaignId)` | control plane | Campaign detail + sync state |
| `CampaignJournalEvents` (read-only) | control plane | Task History join with kernel provenance |

Until the control-plane plan lands, Tasks 8–10 and 19 use in-memory fakes under `test/ui/support/` that mirror the port signatures frozen here. Task 6 approval API calls the port; it never writes `approvals.jsonl` itself.

Kernel contracts consumed directly (already shipped in foundation):

- `loadProjectContext`, `createTaskSource`, `syncBoundary`, `reconcilePending`
- `buildTaskHistory`, `validateProvenanceCandidate`
- `resolveAppPaths`, `EventJournal`

## Global Constraints

- Node server, security, schema, read-model, and control-plane runtime modules import zero third-party production dependencies. Browser production dependencies are limited to React, React DOM, TanStack Router, Query, Table, and Form; esbuild bundles them into the one local client asset. TanStack Start, Store, Pacer, Virtual, router devtools, and Query devtools are absent.
- The local control UI is an authorization boundary: loopback-only bind, exact `127.0.0.1` Host authority, one-time approval token expiring within 15 minutes, fragment delivery only, no cookies/localStorage/history persistence of the token.
- Initial HTML shell contains no proposal, task, campaign, or history payload; authenticated same-origin `fetch` loads JSON projections.
- Approval accepts only `POST` JSON with `Content-Type: application/json`, exact loopback `Origin`, `Sec-Fetch-Site: same-origin`, valid session token, and displayed digest; no form endpoints, no GET mutations, replay fails after first terminal result.
- Every response sets `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin`, and CSP: `default-src 'none'; script-src 'nonce-<random>'; style-src 'nonce-<random>'; img-src 'self' data:; connect-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
- Task text, paths, headers, Git metadata, provider data, logs, and traffic data render as escaped text; remote links require `https`, file/Git actions use internal app routes, `http` is accepted only for the exact loopback UI authority; no attacker-controlled HTML/CSS/script/image URL/automatic remote fetch.
- Rendered HTML is ephemeral and is never persisted as a campaign artifact; only canonical envelope, digest, and terminal approval event are durable.
- Projections are provider-neutral, show sync freshness, state `Local coordination only` and `No shared lease`, and never copy specification/plan/log/diff/provider bodies into the UI model.
- Missing historical Git objects, provider records, or URLs remain visibly unavailable; never substitute current content.
- Operator/runner/Git/provider attribution is evidence, not authorization; `verified` only for valid signature or authenticated provider identity.
- Unknown schema fields, unsupported versions, stale approval digest, expired/consumed tokens, wrong Host/Origin, and cross-origin requests fail closed with no side effects.
- Every task follows red → green → refactor and ends with a focused commit. Run `pnpm check` before the final plan boundary.

### Implementation inventory mapping

| Inventory task | Plan tasks |
|---|---|
| QK-UI-002 ephemeral loopback UI security + approval API | Tasks 1–6, 15, 19 |
| QK-UI-003 Existing Tasks / Preflight / Campaigns / Task History views | Tasks 7–14, 16, 19 |
| QK-UI-004 UI security/a11y/responsive verification | Tasks 17–18 |

---

### Task 1: UI projection schemas and validators

**Files:**
- Create: `schemas/ui-existing-tasks-v1.schema.json`
- Create: `schemas/ui-preflight-proposal-v1.schema.json`
- Create: `schemas/ui-campaign-summary-v1.schema.json`
- Create: `schemas/ui-campaign-detail-v1.schema.json`
- Create: `schemas/ui-task-history-v1.schema.json`
- Create: `schemas/ui-approval-request-v1.schema.json`
- Create: `schemas/ui-approval-response-v1.schema.json`
- Modify: `src/schema/validate.ts`
- Modify: `scripts/generate-validators.mjs` (no logic change; new schemas auto-discovered)
- Create: `test/ui/schema-contract.test.ts`

**Interfaces:**
- Consumes: foundation `validateSchema` pattern and design sections 12, 17, 22.
- Produces: `validateSchema` union entries for all `ui-*-v1` schemas; bounded projection types used by every read model in this plan.

- [ ] **Step 1: Write the failing schema-contract test**

```ts
// test/ui/schema-contract.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../../src/schema/validate.js";

const existingTasks = {
  schemaVersion: 1,
  refreshedAt: "2026-07-21T12:00:00.000Z",
  source: { driver: "json", protocol: "task-source-v1", syncHealth: "fresh", pendingWrites: 0, conflicts: 0 },
  coordinationNotice: "Local coordination only",
  leaseNotice: "No shared lease",
  tasks: [{
    id: "QK-1",
    title: "Example",
    kind: "implementation",
    priority: "P1",
    status: "ready",
    readiness: "ready",
    blockers: [],
    workflowPhase: "execute",
    designGate: { required: false, mode: "human", delegable: false },
    risk: [],
    effort: "standard",
    suggestedRoute: { tier: "standard", label: "Composer 2.5" },
    source: { driver: "json", nativeId: "QK-1", webUrl: null },
    nativeRevision: "sha256:abc",
    dependsOn: [],
    coordination: null
  }]
};

test("accepts ui-existing-tasks-v1 and rejects unknown fields", () => {
  assert.deepEqual(validateSchema("ui-existing-tasks-v1", existingTasks), existingTasks);
  assert.throws(
    () => validateSchema("ui-existing-tasks-v1", { ...existingTasks, surprise: true }),
    /must NOT have additional properties/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/test/ui/schema-contract.test.js`

Expected: FAIL with unknown schema `ui-existing-tasks-v1`.

- [ ] **Step 3: Add strict UI projection schemas**

Each schema uses draft 2020-12, stable `$id` `quirks://schemas/<name>-v1`, `additionalProperties: false` at every object, explicit `maxLength`/`maxItems`, and `schemaVersion: 1` constant.

`ui-existing-tasks-v1` fields: `refreshedAt`, `source.{driver,protocol,syncHealth,pendingWrites,conflicts,lastError?}`, both notices, `tasks[]` with readiness enum `ready|blocked|claimed|ineligible|conflict`, blockers, workflow phase, design gate summary, risk/effort, suggested route, source identity, `nativeRevision`, `dependsOn`, optional `coordination.{scope,campaignId,owner}`.

`ui-preflight-proposal-v1` fields: `campaignId`, `state: "awaiting_approval"`, `envelopeDigest`, `summary.{taskCount,waveCount,estimatedMinutes,confidence,budget,landing,push}`, `waves[]`, `lanes[]`, `tasks[]` with routing/fallback/confidence, `inspector` nullable, `residuals[]`, `humanGates[]`, `unsupportedCapabilities[]`, fixed `approval.{campaignId,envelopeDigest}` duplicate for binding display.

`ui-campaign-summary-v1`: `items[]` with `campaignId`, `repositoryId`, `state`, `taskCount`, `startedAt?`, `finishedAt?`, `spend?`, `outcome?`.

`ui-campaign-detail-v1`: summary plus `tasks[]`, `waves[]`, `runners[]`, `commits[]`, `pullRequests[]`, `verification[]`, `sync.{pending,conflicts}`, `reportPath?`, `canRunAgain: true`.

`ui-task-history-v1`: `taskId`, `iterations[]` with compact refs only (`path`, `commit`, `sha`, `url`, `availability`, identities with `evidence`/`verified`), `actions` enum `open-as-executed|open-current|compare` per artifact, no `content`/`body`/`patch` fields.

`ui-approval-request-v1`: `{ schemaVersion: 1, campaignId, envelopeDigest, token }`.

`ui-approval-response-v1`: discriminated `result: "approved"|"rejected"|"stale"|"expired"|"replay"|"invalid"` plus optional `approvalEventId`.

Extend `SchemaName` in `src/schema/validate.ts` with all seven names.

- [ ] **Step 4: Build and run schema tests**

Run: `pnpm build && node --test dist/test/ui/schema-contract.test.js`

Expected: PASS for valid payloads and unknown-field rejection across all UI schemas.

- [ ] **Step 5: Commit**

```bash
git add schemas/ui-*.schema.json src/schema/validate.ts test/ui/schema-contract.test.ts
git commit -m "feat: add strict local control UI projection schemas"
```

---

### Task 2: Hostile-data escaping and URL policy

**Files:**
- Create: `src/ui/security/escape.ts`
- Create: `src/ui/security/url-policy.ts`
- Create: `test/ui/security/escape.test.ts`
- Create: `test/ui/security/url-policy.test.ts`

**Interfaces:**
- Consumes: loopback authority string from Task 3.
- Produces: `escapeHtml(text): string`, `escapeAttribute(text): string`, `classifyUrl(href, authority): ClassifiedUrl` with kinds `https`, `loopback-http`, `internal-route`, `rejected`.

- [ ] **Step 1: Write failing escape and URL tests**

```ts
// test/ui/security/escape.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../../../src/ui/security/escape.js";

test("escapes HTML metacharacters", () => {
  assert.equal(escapeHtml(`<img src=x onerror=alert(1)>`), "&lt;img src=x onerror=alert(1)&gt;");
});
```

```ts
// test/ui/security/url-policy.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { classifyUrl } from "../../../src/ui/security/url-policy.js";

const authority = "http://127.0.0.1:38491";

test("accepts https remotes and exact loopback authority", () => {
  assert.equal(classifyUrl("https://github.com/org/repo/pull/1", authority).kind, "https");
  assert.equal(classifyUrl("http://127.0.0.1:38491/git/open?sha=abc", authority).kind, "loopback-http");
});

test("rejects javascript, data, and mismatched loopback hosts", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,hi", "http://localhost:1/x", "http://127.0.0.1:99999/x"]) {
    assert.equal(classifyUrl(href, authority).kind, "rejected", href);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ui/security/escape.test.ts test/ui/security/url-policy.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement escape and URL policy**

```ts
// src/ui/security/escape.ts
const MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => MAP[ch] ?? ch);
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
```

```ts
// src/ui/security/url-policy.ts
export type ClassifiedUrl =
  | { kind: "https"; href: string }
  | { kind: "loopback-http"; href: string }
  | { kind: "internal-route"; route: string }
  | { kind: "rejected"; reason: string };

export function classifyUrl(raw: string, authority: string): ClassifiedUrl {
  if (raw.startsWith("/") && !raw.startsWith("//")) return { kind: "internal-route", route: raw };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { kind: "rejected", reason: "parse-error" }; }
  if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return { kind: "https", href: parsed.toString() };
  if (parsed.protocol === "http:" && parsed.toString().startsWith(`${authority}/`)) return { kind: "loopback-http", href: parsed.toString() };
  return { kind: "rejected", reason: "scheme-or-host" };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm build && node --test dist/test/ui/security`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/security test/ui/security
git commit -m "feat: add UI escaping and URL policy"
```

---

### Task 3: Loopback authority and server bind

**Files:**
- Create: `src/ui/authority.ts`
- Create: `src/ui/server.ts`
- Create: `src/ui/request.ts`
- Create: `test/ui/authority.test.ts`
- Create: `test/ui/server-bind.test.ts`

**Interfaces:**
- Consumes: Node `node:http`.
- Produces: `createLoopbackAuthority(): Promise<{ host: "127.0.0.1"; port: number; origin: string; baseUrl: string }>`, `createUiServer(options): Promise<UiServer>`, `UiServer.close()`, `assertLoopbackRequest(req, authority): void` throwing `UI_FORBIDDEN` on wrong Host/method/path prefix violations.

- [ ] **Step 1: Write failing bind and Host tests**

```ts
// test/ui/server-bind.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createLoopbackAuthority } from "../../src/ui/authority.js";
import { createUiServer } from "../../src/ui/server.js";

test("binds only to 127.0.0.1 and rejects wrong Host", async () => {
  const authority = await createLoopbackAuthority();
  const server = await createUiServer({ authority, handler: async () => new Response("ok", { status: 200 }) });
  const bad = await fetch(`${authority.baseUrl}/`, { headers: { Host: "localhost" } });
  assert.equal(bad.status, 403);
  await server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/server-bind.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement loopback bind and Host guard**

`createLoopbackAuthority` listens on port `0`, reads assigned port, closes probe socket, returns fixed host `127.0.0.1`.

`createUiServer` uses `http.createServer`, binds `127.0.0.1` only (never `::1`, never `0.0.0.0`), wraps handler with Host check: `req.headers.host` must equal `127.0.0.1:<port>` exactly.

`request.ts` provides `readJsonBody(req, maxBytes=1_048_576)` with size cap and `UI_PAYLOAD_TOO_LARGE` on excess.

- [ ] **Step 4: Run bind tests**

Run: `pnpm build && node --test dist/test/ui/authority.test.js dist/test/ui/server-bind.test.js`

Expected: PASS; verify listening address via `server.address()` is `127.0.0.1`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/authority.ts src/ui/server.ts src/ui/request.ts test/ui/authority.test.ts test/ui/server-bind.test.ts
git commit -m "feat: bind local control UI to loopback only"
```

---

### Task 4: Security headers and per-response nonce CSP

**Files:**
- Create: `src/ui/security/headers.ts`
- Create: `src/ui/security/nonce.ts`
- Create: `test/ui/security/headers.test.ts`

**Interfaces:**
- Consumes: `authority` from Task 3.
- Produces: `createResponseNonce(): string`, `applySecurityHeaders(res, { nonce }): void`, `contentSecurityPolicy(nonce): string` matching design section 20 verbatim.

- [ ] **Step 1: Write failing header test**

```ts
// test/ui/security/headers.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { contentSecurityPolicy, applySecurityHeaders } from "../../../src/ui/security/headers.js";
import { createResponseNonce } from "../../../src/ui/security/nonce.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

test("sets no-store, nosniff, CORP, COOP, referrer, and nonce CSP", () => {
  const nonce = createResponseNonce();
  const res = new ServerResponse(new IncomingMessage(new Socket()));
  const headers: Record<string, string | string[]> = {};
  res.setHeader = (k: string, v: string | string[]) => { headers[k.toLowerCase()] = v; return res.getHeaderLength(); };
  applySecurityHeaders(res, { nonce });
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["content-security-policy"], contentSecurityPolicy(nonce));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/security/headers.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement nonce and headers**

```ts
// src/ui/security/nonce.ts
import { randomBytes } from "node:crypto";

export function createResponseNonce(): string {
  return randomBytes(18).toString("base64url");
}
```

```ts
// src/ui/security/headers.ts
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function applySecurityHeaders(res: import("node:http").ServerResponse, options: { nonce: string }): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", contentSecurityPolicy(options.nonce));
}
```

- [ ] **Step 4: Run header tests**

Run: `pnpm build && node --test dist/test/ui/security/headers.test.js`

Expected: PASS; assert two consecutive calls produce different nonces.

- [ ] **Step 5: Commit**

```bash
git add src/ui/security/headers.ts src/ui/security/nonce.ts test/ui/security/headers.test.ts
git commit -m "feat: add per-response UI security headers and CSP"
```

---

### Task 5: One-time approval token lifecycle

**Files:**
- Create: `src/ui/ports/approval-write.ts`
- Create: `src/ui/ports/ui-session.ts`
- Create: `src/ui/approval/token-store.ts`
- Create: `test/ui/approval/token-store.test.ts`
- Create: `test/ui/support/fake-approval-write.ts`

**Interfaces:**
- Consumes: design section 20 token rules; control-plane `campaignId` + `envelopeDigest`.
- Produces:

```ts
export interface ApprovalWritePort {
  issueToken(input: { campaignId: string; envelopeDigest: string; now?: string }): Promise<{ token: string; expiresAt: string }>;
  approve(input: { campaignId: string; envelopeDigest: string; token: string; operator: { label: string; evidence: string } }): Promise<{ result: "approved"; approvalEventId: string } | { result: "stale" | "expired" | "replay" | "invalid" }>;
}

export interface UiSessionPort {
  authorize(input: { token: string; now?: string }): Promise<
    | { result: "authorized"; campaignId: string; envelopeDigest: string; expiresAt: string; approvalConsumed: boolean }
    | { result: "expired" | "invalid" }
  >;
}
```

`InMemoryApprovalTokenStore` enforces: 15-minute TTL, single approval use, binding to exact `{campaignId, envelopeDigest}`, constant-time compare, and no persistence of the token secret. `authorize` is side-effect free and gates every projection read; `consume` is the sole approval transition to terminal use.

- [ ] **Step 1: Write failing token tests**

```ts
// test/ui/approval/token-store.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryApprovalTokenStore } from "../../../src/ui/approval/token-store.js";

test("consumes token once and rejects replay", async () => {
  const store = new InMemoryApprovalTokenStore();
  const issued = await store.issue({ campaignId: "C-1", envelopeDigest: "sha256:abc", now: "2026-07-21T12:00:00.000Z" });
  const first = await store.consume({ campaignId: "C-1", envelopeDigest: "sha256:abc", token: issued.token, now: "2026-07-21T12:00:30.000Z" });
  assert.equal(first, "ok");
  const second = await store.consume({ campaignId: "C-1", envelopeDigest: "sha256:abc", token: issued.token, now: "2026-07-21T12:00:31.000Z" });
  assert.equal(second, "replay");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/approval/token-store.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement token store and port adapter**

Token format: `qkui_` + 32 bytes base64url random; store keyed by SHA-256 hash of token.

`consume` returns `expired` when `now > expiresAt`, `stale` when digest mismatch, `invalid` when unknown token, `replay` when `consumedAt` already set, `ok` once.

`authorize` accepts the same hashed token until expiry, returns its campaign/digest binding plus `approvalConsumed` without the secret, and remains read-authorized after approval so Query can refresh the now-terminal campaign. Add tests proving repeated authorization does not consume the token, authorization after approval remains read-only, and a second `consume` returns `replay`.

`FakeApprovalWritePort` in test support delegates to store and appends approval events to an in-memory array for assertions.

- [ ] **Step 4: Run token tests**

Run: `pnpm build && node --test dist/test/ui/approval/token-store.test.js`

Expected: PASS including expiry at 15 minutes, digest mismatch, post-approval read authorization, and mutation replay rejection.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ports/approval-write.ts src/ui/ports/ui-session.ts src/ui/approval/token-store.ts test/ui/approval test/ui/support/fake-approval-write.ts
git commit -m "feat: add one-time approval token lifecycle"
```

---

### Task 6: Approval JSON API and fetch-metadata gate

**Files:**
- Create: `src/ui/api/approval.ts`
- Create: `src/ui/api/errors.ts`
- Create: `src/ui/router.ts`
- Modify: `src/ui/server.ts`
- Create: `test/ui/api/approval.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5, `validateSchema` for request/response, `ApprovalWritePort`, and `UiSessionPort`.
- Produces: `POST /api/v1/approval` only mutation route; `GET`/`PUT`/`DELETE` on `/api/*` return `405`; `GET` on `/api/v1/*` read routes added in later tasks return JSON only.

- [ ] **Step 1: Write failing approval API tests**

```ts
// test/ui/api/approval.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTestUiServer } from "../support/test-server.js";

test("rejects cross-origin and form POST approval", async () => {
  const { authority, close, issue } = await createTestUiServer();
  const { token } = await issue("C-1", "sha256:abc");
  const xhr = await fetch(`${authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: "http://evil.test", Host: authority.hostHeader, "Sec-Fetch-Site": "cross-site" },
    body: JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", token }),
  });
  assert.equal(xhr.status, 403);
  const form = await fetch(`${authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded", Origin: authority.origin, Host: authority.hostHeader, "Sec-Fetch-Site": "same-origin" },
    body: "campaignId=C-1",
  });
  assert.equal(form.status, 415);
  await close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/api/approval.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement approval route**

The server router checks exact Host first, then requires `Authorization: Bearer <token>` and `UiSessionPort.authorize` before invoking any `/api/v1/*` read-model or control-plane port. Missing/unknown/expired tokens return `401` with a fixed body and zero projection/approval port calls. A token whose approval was consumed remains valid for bounded reads until its original expiry but can never authorize another mutation. Do not log or echo the header.

`approval.ts` additionally checks in order: method `POST`, `Content-Type: application/json`, `Origin === authority.origin`, `Sec-Fetch-Site === "same-origin"`, body schema, constant-time equality between bearer and body token, exact authorized campaign/digest binding, then token consume via the approval port. It returns `ui-approval-response-v1`.

No `/api/v1/approval` GET handler. Wrong digest → `{ result: "stale" }` without port mutation.

`test/ui/support/test-server.ts` wires fake ports, starts server on ephemeral port.

- [ ] **Step 4: Run approval API tests**

Run: `pnpm build && node --test dist/test/ui/api/approval.test.js`

Expected: PASS for authenticated reads, happy-path approval, replay, stale digest, expired token, bearer/body mismatch, GET mutation attempt, and missing `Sec-Fetch-Site`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/api src/ui/router.ts src/ui/server.ts test/ui/api test/ui/support/test-server.ts
git commit -m "feat: add digest-bound approval JSON API"
```

---

### Task 7: Existing Tasks read model and API

**Files:**
- Create: `src/ui/read-models/existing-tasks.ts`
- Create: `src/ui/api/existing-tasks.ts`
- Modify: `src/ui/router.ts`
- Create: `test/ui/read-models/existing-tasks.test.ts`
- Create: `test/ui/fixtures/hostile-tasks.json`

**Interfaces:**
- Consumes: `loadProjectContext`, `createTaskSource`, `syncBoundary`, kernel normalized tasks.
- Produces: `buildExistingTasksProjection(context): Promise<UiExistingTasksV1>`; `GET /api/v1/existing-tasks` returns validated JSON.

- [ ] **Step 1: Write failing projection test with hostile fixture**

```ts
// test/ui/read-models/existing-tasks.test.ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildExistingTasksProjection } from "../../../src/ui/read-models/existing-tasks.js";
import { loadProjectContext } from "../../../src/project/config.js";

test("projects provider-neutral tasks with sync freshness and local-only notices", async () => {
  const context = await loadProjectContext(path.resolve("test/fixtures/json-project"), { mode: "inspection" });
  const projection = await buildExistingTasksProjection(context);
  assert.equal(projection.coordinationNotice, "Local coordination only");
  assert.equal(projection.leaseNotice, "No shared lease");
  assert.equal(projection.source.driver, "json");
  assert.ok(projection.tasks.length > 0);
});
```

Add `test/ui/fixtures/hostile-tasks.json` task with title `<script>alert(1)</script>`, path `"><img src=x onerror=alert(1)>`, and Unicode bidi markers; projection retains raw strings (escaping happens at render).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/read-models/existing-tasks.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement Existing Tasks projection**

Compute readiness from `dependsOn`, status, design/plan gates, coordination conflicts.

`suggestedRoute` is a display label only; no runner dispatch.

`syncBoundary` refresh at `preflight` boundary before list.

Never embed task file bodies or `acceptanceCriteria` full text beyond bounded title and short labels.

Wire `GET /api/v1/existing-tasks` with security headers, no mutation.

- [ ] **Step 4: Run projection and API tests**

Run: `pnpm build && node --test dist/test/ui/read-models/existing-tasks.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/read-models/existing-tasks.ts src/ui/api/existing-tasks.ts test/ui/read-models test/ui/fixtures/hostile-tasks.json
git commit -m "feat: add Existing Tasks UI projection"
```

---

### Task 8: Preflight proposal read model and API

**Files:**
- Create: `src/ui/ports/preflight-read.ts`
- Create: `src/ui/read-models/preflight-proposal.ts`
- Create: `src/ui/api/preflight.ts`
- Create: `test/ui/read-models/preflight-proposal.test.ts`
- Create: `test/ui/support/fake-preflight.ts`

**Interfaces:**
- Consumes: `PreflightReadPort.getProposal(campaignId): Promise<UiPreflightProposalV1>` (implemented by control plane; faked in tests).
- Produces: `GET /api/v1/campaigns/:campaignId/preflight` returning validated proposal; digest in response must match `approval.envelopeDigest`.

```ts
export interface PreflightReadPort {
  getProposal(campaignId: string): Promise<import("../../schema/validate.js").UiPreflightProposalV1>;
}
```

- [ ] **Step 1: Write failing preflight projection test**

```ts
// test/ui/read-models/preflight-proposal.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildPreflightResponse } from "../../../src/ui/read-models/preflight-proposal.js";
import { fakePreflightPort } from "../support/fake-preflight.js";

test("returns proposal derived from port without HTML persistence fields", async () => {
  const port = fakePreflightPort();
  const proposal = await buildPreflightResponse(port, "C-1");
  assert.equal(proposal.campaignId, "C-1");
  assert.equal(proposal.approval.envelopeDigest, proposal.envelopeDigest);
  assert.equal((proposal as { html?: string }).html, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/read-models/preflight-proposal.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement preflight read model**

`buildPreflightResponse` validates port output against `ui-preflight-proposal-v1`.

Fake includes waves, lanes, delegated design envelope text, residuals, human gates, unsupported capabilities, inspector block.

API returns `404` when campaign not in `awaiting_approval`.

- [ ] **Step 4: Run tests**

Run: `pnpm build && node --test dist/test/ui/read-models/preflight-proposal.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ports/preflight-read.ts src/ui/read-models/preflight-proposal.ts src/ui/api/preflight.ts test/ui/read-models/preflight-proposal.test.ts test/ui/support/fake-preflight.ts
git commit -m "feat: add Preflight Proposal UI projection"
```

---

### Task 9: Campaigns read model and API

**Files:**
- Create: `src/ui/ports/campaign-read.ts`
- Create: `src/ui/read-models/campaigns.ts`
- Create: `src/ui/api/campaigns.ts`
- Create: `test/ui/read-models/campaigns.test.ts`
- Create: `test/ui/support/fake-campaigns.ts`

**Interfaces:**

```ts
export interface CampaignReadPort {
  listSummaries(input: { repositoryId?: string }): Promise<UiCampaignSummaryV1["items"]>;
  getDetail(campaignId: string): Promise<UiCampaignDetailV1>;
}
```

- Produces: `GET /api/v1/campaigns?repositoryId=`, `GET /api/v1/campaigns/:campaignId`.

- [ ] **Step 1: Write failing campaigns list test**

```ts
// test/ui/read-models/campaigns.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignList } from "../../../src/ui/read-models/campaigns.js";
import { fakeCampaignReadPort } from "../support/fake-campaigns.js";

test("lists local journals with default repository filter", async () => {
  const items = await buildCampaignList(fakeCampaignReadPort(), {});
  assert.ok(items.length >= 1);
  assert.ok(items.every((item) => item.state.length > 0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/read-models/campaigns.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement campaigns projections**

Detail view includes tasks, runners/models, timing/spend, deviations, accepted commits, PR refs, verification summaries, sync pending/conflicts, `canRunAgain: true`.

Append-only past campaigns remain readable; `Run again` is a client navigation to Existing Tasks with new preflight, not an API mutation.

- [ ] **Step 4: Run tests**

Run: `pnpm build && node --test dist/test/ui/read-models/campaigns.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ports/campaign-read.ts src/ui/read-models/campaigns.ts src/ui/api/campaigns.ts test/ui/read-models/campaigns.test.ts test/ui/support/fake-campaigns.ts
git commit -m "feat: add Campaigns UI projection"
```

---

### Task 10: Task History read model and API

**Files:**
- Create: `src/ui/read-models/task-history.ts`
- Create: `src/ui/api/task-history.ts`
- Create: `test/ui/read-models/task-history.test.ts`
- Create: `test/ui/fixtures/history-journal.jsonl`

**Interfaces:**
- Consumes: `buildTaskHistory`, `CampaignReadPort` events, `TaskSource.show`.
- Produces: `GET /api/v1/tasks/:taskId/history` → `ui-task-history-v1`.

- [ ] **Step 1: Write failing history projection test**

```ts
// test/ui/read-models/task-history.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskHistoryProjection } from "../../../src/ui/read-models/task-history.js";
import { createHistoryFixture } from "../support/history-fixture.js";

test("keeps missing historical refs unavailable without substituting current content", async () => {
  const fixture = await createHistoryFixture();
  const history = await buildTaskHistoryProjection(fixture);
  const missing = history.iterations.flatMap((it) => it.artifactRefs).find((ref) => ref.availability === "missing-at-commit");
  assert.ok(missing);
  assert.equal((missing as { content?: string }).content, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui/read-models/task-history.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement Task History projection**

Join kernel provenance + campaign journal events.

Expose `open-as-executed`, `open-current`, `compare` action metadata as enums for client routing through internal loopback routes `/git/open`, `/git/compare`.

Distinct operator, participant, git author/committer, PR opener/merger with evidence labels.

Signed vs unsigned Git identity fixtures.

- [ ] **Step 4: Run tests**

Run: `pnpm build && node --test dist/test/ui/read-models/task-history.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/read-models/task-history.ts src/ui/api/task-history.ts test/ui/read-models/task-history.test.ts test/ui/fixtures/history-journal.jsonl test/ui/support/history-fixture.ts
git commit -m "feat: add Task History UI projection"
```

---

### Task 11: Freeze the focused TanStack client contract and load shipped guidance

**Files:**
- Create: `AGENTS.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `test/ui/client-stack-contract.test.ts`

**Interfaces:**
- Consumes: approved design section 22.1; the disposable TanStack CLI reference output; package-shipped TanStack Intent skills.
- Produces: an exact browser dependency allow-list, reproducible tool versions, and durable agent guidance. No generated server, route, demo, Tailwind, devtools, or deployment code enters the repository.

- [ ] **Step 1: Write the failing client-stack contract test**

```ts
// test/ui/client-stack-contract.test.ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pins only the approved browser stack and exact Intent sources", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    intent: { skills: string[] };
  };
  assert.deepEqual(pkg.dependencies, {
    "@tanstack/react-form": "1.33.2",
    "@tanstack/react-query": "5.101.4",
    "@tanstack/react-router": "1.170.18",
    "@tanstack/react-table": "8.21.3",
    react: "19.2.8",
    "react-dom": "19.2.8",
  });
  assert.deepEqual(pkg.intent.skills, [
    "@tanstack/react-router",
    "@tanstack/react-query",
    "@tanstack/react-table",
    "@tanstack/react-form",
  ]);
  for (const excluded of ["@tanstack/react-start", "@tanstack/react-store", "@tanstack/react-pacer", "@tanstack/react-virtual"])
    assert.equal(pkg.dependencies[excluded], undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ui/client-stack-contract.test.ts`

Expected: FAIL because the browser dependencies and Intent allow-list are absent.

- [ ] **Step 3: Generate and inspect the disposable Router-only reference**

Run outside the repository in a disposable directory:

```bash
tanstack_reference_dir="$(mktemp -d)/quirks-ui-reference"
pnpm dlx @tanstack/cli@0.69.6 create quirks-ui-reference --router-only --framework React --package-manager pnpm --toolchain biome --no-examples --no-git --intent --target-dir "$tanstack_reference_dir" -y
```

Inspect its `package.json`, root/bootstrap code, route registration, and generated agent guidance. Record the exact command, CLI version `0.69.6`, and deliberate divergences in `AGENTS.md`: Quirks keeps its existing Oxlint/esbuild toolchain, code-based five-route tree, framework-independent Node server, and nonce-injected single bundle. Do not copy the scratch directory or `.cta.json` into Quirks.

- [ ] **Step 4: Install exact client packages and configure Intent trust**

Run:

```bash
pnpm add react@19.2.8 react-dom@19.2.8 @tanstack/react-router@1.170.18 @tanstack/react-query@5.101.4 @tanstack/react-table@8.21.3 @tanstack/react-form@1.33.2
pnpm add -D @types/react@19.2.17 @types/react-dom@19.2.3 esbuild@0.25.9
```

Add the exact four-package `intent.skills` allow-list asserted above. Do not use `"*"` or `"@tanstack/*"`; transitive packages do not gain instruction authority.

Run:

```bash
pnpm dlx @tanstack/intent@0.3.6 install --map
pnpm dlx @tanstack/intent@0.3.6 list --json
```

Before changing client files, execute every matching `load` command written by `install --map` for Router, Query, Table, and Form. If an allowed package exposes no skill at its pinned version, record `no shipped skill discovered` with that package/version in `AGENTS.md`; do not broaden the allow-list to find one.

Outside the managed Intent block, `AGENTS.md` records: exact scaffold and Intent commands, pinned stack, no environment variables or secrets required by the UI, loopback-only/no-deployment posture, code-based routing rationale, CSP/no-remote-assets constraints, no client canonical state, and the Virtual performance gate in Task 18.

- [ ] **Step 5: Run the contract test and commit**

Run: `pnpm build && node --test dist/test/ui/client-stack-contract.test.js`

Expected: PASS; `pnpm dlx @tanstack/intent@0.3.6 list --json` reports only explicitly allowed sources and no wildcard-trust notice.

```bash
git add AGENTS.md package.json pnpm-lock.yaml test/ui/client-stack-contract.test.ts
git commit -m "chore: freeze focused TanStack client contract"
```

---

### Task 12: Ephemeral shell, token vault, and single React bundle

**Files:**
- Create: `src/ui/shell.ts`
- Create: `src/ui/styles.ts`
- Create: `src/ui/client/main.tsx`
- Create: `src/ui/client/app.tsx`
- Create: `src/ui/client/token-vault.ts`
- Create: `src/ui/client/fetch-json.ts`
- Create: `scripts/bundle-ui-client.mjs`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `tsconfig.build.json`
- Create: `test/ui/shell.test.ts`
- Create: `test/ui/client/token-vault.test.ts`
- Create: `test/ui/client/bundle-boundary.test.ts`

**Interfaces:**
- Consumes: Tasks 4 and 6; browser packages frozen by Task 11.
- Produces: `renderShell({ nonce, clientScript }): string` with only `<div id="app"></div>`; a closure-backed `TokenVault`; one self-contained IIFE with no remote/runtime imports.

- [ ] **Step 1: Write failing shell and token tests**

```ts
// test/ui/shell.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { renderShell } from "../../src/ui/shell.js";

test("shell contains no projection data and nonces its only script and style", () => {
  const html = renderShell({ nonce: "nonce-123", clientScript: "window.__QUIRKS_BOOT__=1;" });
  assert.doesNotMatch(html, /envelopeDigest|campaignId|application\/json/);
  assert.equal((html.match(/nonce="nonce-123"/g) ?? []).length, 2);
  assert.match(html, /<div id="app"><\/div>/);
});
```

```ts
// test/ui/client/token-vault.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { consumeFragmentToken } from "../../../src/ui/client/token-vault.js";

test("consumes the fragment once and strips it without history state", () => {
  const replaced: unknown[][] = [];
  const vault = consumeFragmentToken({
    href: "http://127.0.0.1:9123/preflight/C-1#token=qkui_secret",
    replaceState: (...args: unknown[]) => replaced.push(args),
  });
  assert.equal(vault.withToken((token) => token), "qkui_secret");
  assert.deepEqual(replaced, [[null, "", "/preflight/C-1"]]);
  vault.clear();
  assert.equal(vault.withToken(() => "present"), undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ui/shell.test.ts test/ui/client/token-vault.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement the trusted shell and private token vault**

`src/ui/styles.ts` exports a fixed `UI_CSS` string containing no runtime interpolation. `renderShell` escapes the nonce attribute, injects `UI_CSS` and the local bundle with that nonce, and receives no campaign/task/projection argument.

The Node router serves this shell only for `GET /`, `GET /preflight/:campaignId`, `GET /campaigns`, `GET /campaigns/:campaignId`, and `GET /tasks/:taskId/history`, after exact Host validation. Add table-driven shell tests for all five patterns and every other method. Unknown paths—including `/health`, `/_next/*`, `/assets/*`, and malformed IDs—return fixed `404`/`405` responses with the same security headers; there is no framework fallback, server component, or broad static-file handler.

`consumeFragmentToken` accepts only one `token` parameter, immediately calls `history.replaceState(null, "", pathname + search)`, and returns an object whose token exists only in a private closure. The vault exposes `withToken(callback)` and `clear()`; it has no serializable token property. Never place the token in React state/props, TanStack Router context/search, Query keys/data/meta, Form values, logs, cookies, `sessionStorage`, or `localStorage`.

`fetch-json.ts` accepts only relative paths beginning `/api/v1/`, obtains the bearer from the vault inside the request closure, and sets `Authorization`, `Accept: application/json`, `credentials: "omit"`, `cache: "no-store"`, and `redirect: "error"`. It never accepts a caller-provided origin.

- [ ] **Step 4: Build one local IIFE and prove the bundle boundary**

Configure TypeScript for `jsx: "react-jsx"`. `main.tsx` calls `createRoot`, supplies the opaque vault through a private React context, and renders a temporary loading shell until Task 13 supplies the router.

`scripts/bundle-ui-client.mjs` invokes esbuild with entry point `src/ui/client/main.tsx`, `bundle: true`, `format: "iife"`, `platform: "browser"`, `target: "es2022"`, `write: false`, and `metafile: true`; it fails unless there is exactly one JavaScript output and `output.imports` is empty, then writes `dist/ui/client.bundle.js`. Update `build` so validator generation, TypeScript compilation, and `bundle:ui` all run deterministically.

`bundle-boundary.test.ts` reads the esbuild metafile and emitted bundle, asserts one JavaScript output with zero external imports, and rejects `sourceMappingURL`, `@tanstack/react-start`, devtools packages, or the fragment-token fixture. Do not reject inert URL strings embedded by React itself; Task 17 proves the stronger property that the running client makes zero non-loopback requests.

- [ ] **Step 5: Build, test, and commit**

Run: `pnpm build && node --test dist/test/ui/shell.test.js dist/test/ui/client/token-vault.test.js dist/test/ui/client/bundle-boundary.test.js`

Expected: PASS with one local bundle, no source map, and no projection/token material in HTML.

```bash
git add src/ui/shell.ts src/ui/styles.ts src/ui/client scripts/bundle-ui-client.mjs package.json tsconfig.json tsconfig.build.json test/ui/shell.test.ts test/ui/client/token-vault.test.ts test/ui/client/bundle-boundary.test.ts
git commit -m "feat: add nonce-bound React shell and bundle"
```

---

### Task 13: Typed Router and Query projection layer

**Files:**
- Create: `src/ui/client/router.tsx`
- Create: `src/ui/client/query-client.ts`
- Create: `src/ui/client/api-client.ts`
- Create: `src/ui/client/query-options.ts`
- Create: `src/ui/client/routes/root.tsx`
- Create: `src/ui/client/routes/existing-tasks.tsx`
- Create: `src/ui/client/routes/preflight.tsx`
- Create: `src/ui/client/routes/campaigns.tsx`
- Create: `src/ui/client/routes/campaign-detail.tsx`
- Create: `src/ui/client/routes/task-history.tsx`
- Modify: `src/ui/client/app.tsx`
- Create: `test/ui/client/query-contract.test.ts`

**Interfaces:**
- Consumes: all bounded read APIs and the opaque token vault.
- Produces: code-based typed routes `/`, `/preflight/$campaignId`, `/campaigns`, `/campaigns/$campaignId`, `/tasks/$taskId/history`; finite Query keys and explicit freshness/error states.

- [ ] **Step 1: Write the failing query contract test**

```ts
// test/ui/client/query-contract.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { queryKeys } from "../../../src/ui/client/query-options.js";

test("query keys contain bounded identity only", () => {
  assert.deepEqual(queryKeys.existingTasks(), ["ui", "existing-tasks"]);
  assert.deepEqual(queryKeys.preflight("C-1"), ["ui", "preflight", "C-1"]);
  assert.deepEqual(queryKeys.taskHistory("QK-1"), ["ui", "task-history", "QK-1"]);
  const serialized = JSON.stringify([
    queryKeys.existingTasks(),
    queryKeys.preflight("C-1"),
    queryKeys.taskHistory("QK-1"),
  ]);
  assert.doesNotMatch(serialized, /token|digest|qkui_/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ui/client/query-contract.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement the code-based route tree**

Use `createRootRouteWithContext`, `createRoute`, and `createRouter`; register `typeof router` through TanStack Router declaration merging. Code-based routing is deliberate: five fixed shell routes need no generated route tree, watcher, code splitting, or framework plugin, which preserves the single-bundle/CSP boundary.

The root renders navigation and `Outlet`. Each route validates path params against the same length/character bounds as its server handler. `notFoundComponent`, `pendingComponent`, and `errorComponent` render local text only. Set `defaultPreload: false`; route navigation must not trigger speculative projection requests.

- [ ] **Step 4: Implement Query ownership and API closures**

Create one `QueryClient` with:

```ts
{
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000, gcTime: 60_000 },
    mutations: { retry: false },
  },
}
```

The router context contains the `QueryClient` and an `ApiClient` whose private fetch closure reads the token vault. It does not contain the vault or token. Query keys contain only fixed route identity; query data is a replaceable server projection and is never persisted. Every success displays `refreshedAt`/sync freshness; errors do not fall back to stale durable truth.

- [ ] **Step 5: Build, test, and commit**

Run: `pnpm build && node --test dist/test/ui/client/query-contract.test.js`

Expected: PASS; the route declaration compiles with typed params and no generated/server framework files.

```bash
git add src/ui/client
git commit -m "feat: add typed local routes and projection queries"
```

---

### Task 14: Table, Form, views, and visual states

**Files:**
- Create: `src/ui/client/components/data-table.tsx`
- Create: `src/ui/client/components/status-badge.tsx`
- Create: `src/ui/client/components/sync-banner.tsx`
- Create: `src/ui/client/components/approval-form.tsx`
- Create: `src/ui/client/views/existing-tasks-view.tsx`
- Create: `src/ui/client/views/preflight-view.tsx`
- Create: `src/ui/client/views/campaigns-view.tsx`
- Create: `src/ui/client/views/task-history-view.tsx`
- Create: `src/ui/client/visual-states.ts`
- Modify: `src/ui/client/routes/*.tsx`
- Create: `test/ui/client/visual-states.test.ts`

**Interfaces:**
- Consumes: Task 13 route/query contracts, `classifyUrl`, and all projection types.
- Produces: the approved Existing Tasks, Preflight Proposal, Campaigns, Campaign Detail, and Task History workspace using TanStack Table/Form without client-owned canonical state.

- [ ] **Step 1: Write the failing visual-state test**

```ts
// test/ui/client/visual-states.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readinessBadge } from "../../../src/ui/client/visual-states.js";

test("maps readiness to text and tone rather than color alone", () => {
  assert.deepEqual(readinessBadge("ready"), { label: "Ready", tone: "success" });
  assert.deepEqual(readinessBadge("conflict"), { label: "Conflict", tone: "danger" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ui/client/visual-states.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement Table-backed views**

Use `useReactTable` with explicit column definitions for Existing Tasks, Campaigns, commits, pull requests, verification, and history. All cells return ordinary React text nodes or internal controls; there is no `dangerouslySetInnerHTML`, raw HTML prop, remote image, or automatic URL fetch. `classifyUrl` permits external anchors only for parsed `https:` URLs with `rel="noreferrer noopener"`; file/Git actions navigate to fixed internal routes.

Existing Tasks displays readiness, dependencies, route suggestion, source revision, sync freshness, `Local coordination only`, and `No shared lease`. Campaigns defaults to the current repository and requires an explicit control to show all projects. Task History preserves distinct operator/participant/Git/provider identities and visibly unavailable historical refs.

- [ ] **Step 4: Implement Form-backed approval without widening mutation authority**

Preflight renders every section in design section 22: exact tasks/order, delegated judgment, landing/push, authority, models/spend, verification, stop conditions/residuals, unsupported capabilities, and fixed campaign/digest binding.

Use TanStack Form only for local task filters/selection controls and the approval acknowledgement. Once a canonical envelope is displayed, its fields are read-only: client edits cannot change the envelope, digest, or durable campaign state. The approval form values contain only `acknowledged: boolean`; the campaign ID and digest come from the validated projection, and the token is obtained inside the `ApiClient` closure at submit time. Submission calls only `POST /api/v1/approval` as JSON, never a native form action; its mutation has `retry: false`. Disable the approve button until the digest is visible and acknowledgement is true. On success disable the mutation permanently and invalidate only the current campaign/preflight queries; the vault remains in page memory for those bounded reads until expiry. Clear it on authentication failure, expiry, or workspace close.

`visual-states.ts` centralizes labels and tones (`neutral`, `info`, `success`, `warning`, `danger`) so status is never conveyed by color alone.

- [ ] **Step 5: Build, test, and commit**

Run: `pnpm build && node --test dist/test/ui/client/visual-states.test.js`

Expected: PASS; `rg -n 'dangerouslySetInnerHTML|innerHTML|<form[^>]+action=' src/ui/client` returns no matches.

```bash
git add src/ui/client
git commit -m "feat: add TanStack control workspace views"
```

---

### Task 15: Focused API security suite (QK-UI-002 gate)

**Files:**
- Create: `test/ui/security/api-abuse.test.ts`

**Interfaces:**
- Consumes: `createTestUiServer` with fake ports.
- Produces: regression tests for unauthenticated reads, wrong-host, cross-origin, replay, stale-digest, GET mutation, form POST, missing token, redirects, and oversize bodies.

- [ ] **Step 1: Write failing abuse tests**

```ts
// test/ui/security/api-abuse.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTestUiServer } from "../support/test-server.js";

test("GET /api/v1/approval does not mutate", async () => {
  const { authority, close } = await createTestUiServer();
  const res = await fetch(`${authority.baseUrl}/api/v1/approval?campaignId=C-1&envelopeDigest=sha256:abc`, {
    headers: { Host: authority.hostHeader, Origin: authority.origin, "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(res.status, 405);
  await close();
});
```

Add cases for: replay second POST, digest mismatch, expired token (clock injection), `Host: 127.0.0.1:wrong`, `Origin: null`, missing `Sec-Fetch-Site`, body over 1 MiB.

Also request every read route without `Authorization`, with an unknown bearer, and after token expiry; expect `401` and zero port calls. After approval consumption, reads still succeed until the original expiry while a second approval returns `replay`. Verify API responses never redirect and never echo the bearer/token.

- [ ] **Step 2: Run tests**

Run: `pnpm build && node --test dist/test/ui/security/api-abuse.test.js`

Expected: initially FAIL any missing guard; then PASS after fixes.

- [ ] **Step 3: Fix any gaps found**

Implement missing guards in router/approval only; do not broaden API surface. All route matching is server-owned—TanStack Router has no API-route authority.

- [ ] **Step 4: Re-run full UI security tests**

Run: `node --test dist/test/ui/security`

Expected: PASS all files.

- [ ] **Step 5: Commit**

```bash
git add test/ui/security/api-abuse.test.ts
git commit -m "test: cover local UI approval API abuse cases"
```

---

### Task 16: Hostile projection and React render tests (QK-UI-003 gate)

**Files:**
- Create: `test/ui/security/hostile-render.test.tsx`
- Create: `test/ui/security/no-raw-html.test.ts`
- Modify: `test/ui/fixtures/hostile-tasks.json`

**Interfaces:**
- Consumes: all hostile projection fixtures and the actual React view components.
- Produces: proof that React text rendering and URL classification contain hostile titles, paths, headers, Git metadata, provider fields, traffic/log strings, bidi controls, and link schemes.

- [ ] **Step 1: Write failing hostile render tests**

```tsx
// test/ui/security/hostile-render.test.tsx
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ExistingTasksView } from "../../../src/ui/client/views/existing-tasks-view.js";
import { hostileExistingTasksProjection } from "../support/hostile-projections.js";

test("renders hostile task fields as text, never active markup", () => {
  const html = renderToStaticMarkup(<ExistingTasksView projection={hostileExistingTasksProjection()} />);
  assert.doesNotMatch(html, /<script|<img|onerror\s*=/i);
  assert.match(html, /&lt;script&gt;/);
});
```

`no-raw-html.test.ts` recursively scans `src/ui/client/**/*.tsx` and fails on `dangerouslySetInnerHTML`, `.innerHTML`, `javascript:`, `data:text/html`, or a component prop named `html`/`markup`.

- [ ] **Step 2: Run tests to verify failures**

Run: `node --test test/ui/security/hostile-render.test.tsx test/ui/security/no-raw-html.test.ts`

Expected: FAIL until the React views and scan helper exist.

- [ ] **Step 3: Exercise every projection and link state**

Render Existing Tasks, Preflight, Campaign Detail, and Task History through `renderToStaticMarkup` using hostile fixtures. Assert untrusted JSON remains unchanged in read models but becomes escaped text in markup. Cover `javascript:`, `data:`, protocol-relative, credential-bearing, malformed, and non-loopback `http:` URLs; each renders as plain unavailable text. Cover a valid `https:` link and exact internal Git action; each gets the expected safe target/route.

This test-only `react-dom/server` import does not enter `src/ui`, the Node UI server, or the browser bundle and does not authorize SSR.

- [ ] **Step 4: Run hostile suites**

Run: `pnpm build && node --test dist/test/ui/security/hostile-render.test.js dist/test/ui/security/no-raw-html.test.js`

Expected: PASS for every view and scheme; bundle boundary test from Task 12 remains green.

- [ ] **Step 5: Commit**

```bash
git add test/ui/security/hostile-render.test.tsx test/ui/security/no-raw-html.test.ts test/ui/fixtures/hostile-tasks.json test/ui/support/hostile-projections.ts
git commit -m "test: contain hostile data in React views"
```

---

### Task 17: Playwright browser harness and security scenarios

**Files:**
- Create: `playwright.config.ts`
- Create: `test/browser/ui-security.spec.ts`
- Create: `test/browser/support/launch-ui.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: running `createTestUiServer` on known port passed via `QUIRKS_UI_TEST_PORT`.
- Produces: automated browser verification of CSP, headers, nonce propagation, fragment removal, no remote requests, no persisted Query/router/form token state, clickjacking (`frame-ancestors`), and approval flow.

- [ ] **Step 1: Add Playwright dev dependency and failing spec**

```ts
// test/browser/ui-security.spec.ts
import { test, expect } from "@playwright/test";
import { launchUiFixture } from "./support/launch-ui.js";

test("approval page has no-store response and nonce CSP", async ({ page }) => {
  const ui = await launchUiFixture();
  const response = await page.goto(ui.preflightUrl);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["content-security-policy"]).toMatch(/script-src 'nonce-/);
  await ui.close();
});
```

- [ ] **Step 2: Install Playwright and run spec**

Run: `pnpm add -D @playwright/test@1.54.2 && pnpm exec playwright install chromium`

Run: `pnpm exec playwright test test/browser/ui-security.spec.ts`

Expected: FAIL until harness exists.

- [ ] **Step 3: Implement browser launch harness**

`launch-ui.ts` starts the real test server and actual bundled React client, opens preflight with `#token=...`, and exposes helpers for approval click plus a network log that fails on every non-loopback request.

Add scenarios: fragment absent immediately after boot, unauthenticated read rejected, stale digest result, replay after approve, hostile task title visible as text not script, history/search/storage free of the token, and no token/digest in TanStack Query keys. Install no Router or Query devtools and expose no debug globals merely to inspect state; observe requests/storage/history and use the unit contracts instead.

- [ ] **Step 4: Run browser security suite**

Run: `pnpm exec playwright test test/browser/ui-security.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts test/browser package.json pnpm-lock.yaml
git commit -m "test: add Playwright React UI security harness"
```

---

### Task 18: Responsive, accessibility, and 1,000-row performance gate (QK-UI-004)

**Files:**
- Create: `test/browser/ui-responsive.spec.ts`
- Create: `test/browser/ui-a11y.spec.ts`
- Create: `test/browser/ui-table-performance.spec.ts`
- Create: `test/browser/support/viewports.ts`
- Create: `test/ui/fixtures/thousand-history-items.json`

**Interfaces:**
- Consumes: Playwright harness; views from Task 14.
- Produces: layout assertions at `1280x800` and `390x844`; semantic focus/label/status checks; an explicit gate deciding whether TanStack Virtual is justified.

- [ ] **Step 1: Write failing responsive spec**

```ts
// test/browser/ui-responsive.spec.ts
import { test, expect } from "@playwright/test";
import { VIEWPORTS } from "./support/viewports.js";
import { launchUiFixture } from "./support/launch-ui.js";

for (const viewport of VIEWPORTS) {
  test(`preflight layout fits ${viewport.name}`, async ({ page }) => {
    const ui = await launchUiFixture();
    await page.setViewportSize(viewport.size);
    await page.goto(ui.preflightUrl);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await ui.close();
  });
}
```

`VIEWPORTS`: desktop `1280x800`, compact `390x844`.

- [ ] **Step 2: Run specs to verify failures**

Run: `pnpm exec playwright test test/browser/ui-responsive.spec.ts test/browser/ui-a11y.spec.ts test/browser/ui-table-performance.spec.ts`

Expected: FAIL on layout, accessibility, or 1,000-row budget gaps.

- [ ] **Step 3: Fix layout and accessibility**

Add responsive CSS grid/flex rules inside nonce style block: task map stacks on compact, inspector becomes full-width panel, commit tables use `overflow-x: auto` on panel not page.

Approval control: keyboard-focusable, `aria-describedby` pointing to digest hash element, `role="status"` on sync freshness banner.

The a11y spec verifies landmark/heading hierarchy, table names, text labels for every tone, focus order, visible focus, and an approval result announcement using role/name assertions. Do not call this a full WCAG audit or add an unreviewed accessibility package.

The performance spec loads the fixed 1,000-row history fixture, warms one filter interaction, then measures five filter-and-render cycles from click to two animation frames. The median must be at most 250 ms on the pinned Chromium/CI runner at both viewports, with the correct final row count each time. This is an acceptance budget, not a benchmark claim.

TanStack Virtual remains absent when the gate passes. If it fails reproducibly on the pinned runner, stop this task and amend the approved spec/plan with exact `@tanstack/react-virtual` version, affected tables, keyboard/screen-reader behavior, and new tests before adding it; do not silently add the package.

- [ ] **Step 4: Run full browser suite**

Run: `pnpm exec playwright test test/browser`

Expected: PASS all specs.

- [ ] **Step 5: Commit**

```bash
git add test/browser test/ui/fixtures/thousand-history-items.json src/ui/client
git commit -m "test: verify responsive accessible table performance"
```

---

### Task 19: `quirks-campaign ui open` integration and projection persistence guard

**Files:**
- Modify: `src/cli/quirks-campaign.ts`
- Create: `src/ui/open-workspace.ts`
- Create: `test/cli/quirks-campaign-ui.test.ts`
- Create: `test/ui/projection-not-persisted.test.ts`

**Interfaces:**
- Consumes: control-plane preflight session handle when available; falls back to explicit error message if ports unavailable.
- Produces: `quirks-campaign ui open --campaign <id> [--json]` prints `{ ok, authority, campaignId, expiresAt }`, launches the OS browser only when stdout is a TTY and `--json` is absent, and never writes HTML/client state under `AppPaths`.

- [ ] **Step 1: Write failing CLI and persistence tests**

```ts
// test/ui/projection-not-persisted.test.ts
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openWorkspace } from "../../src/ui/open-workspace.js";

test("does not persist rendered HTML under campaign artifacts", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-open-"));
  process.env.QUIRKS_STATE_DIR = stateDir;
  const result = await openWorkspace({ campaignId: "C-1", ports: "fake" });
  const files = await readdir(path.join(stateDir, "repositories"), { recursive: true });
  assert.equal(result.ok, true);
  assert.ok(!files.some((f) => String(f).endsWith(".html")));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ui/projection-not-persisted.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement open workspace**

`open-workspace.ts` starts the framework-independent UI server with injected ports from the control-plane factory and loads the already built local client bundle. It does not import React, TanStack packages, CLI scaffold output, or Intent at Node runtime.

`quirks-campaign ui open --campaign <id>` validates args, issues token via `ApprovalWritePort`, prints JSON when `--json`, uses `open`/`xdg-open` only on TTY.

Search campaign artifact and state directories after navigation/approval; assert no `.html`, client cache, router state, form state, or token file was created.

- [ ] **Step 4: Run CLI tests**

Run: `pnpm build && node --test dist/test/cli/quirks-campaign-ui.test.js dist/test/ui/projection-not-persisted.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/quirks-campaign.ts src/ui/open-workspace.ts test/cli/quirks-campaign-ui.test.ts test/ui/projection-not-persisted.test.ts
git commit -m "feat: open ephemeral local control workspace from CLI"
```

---

## Plan Boundary Verification

- [ ] Run `pnpm check` and `pnpm exec playwright test test/browser` from a clean worktree; record commands and exit codes.
- [ ] Confirm no file under `AppPaths.campaigns/**` gains `.html` artifacts during UI tests.
- [ ] Run hostile fixture suite: titles, paths, logs, Git identities, provider metadata render escaped in browser snapshots.
- [ ] Verify no read projection or approval can occur without the live in-memory token; approval also fails on replay, stale digest, GET/form, or cross-origin fetch.
- [ ] Confirm projections expose `Local coordination only` and `No shared lease` on Existing Tasks and Campaigns views.
- [ ] Run `pnpm dlx @tanstack/intent@0.3.6 list --json`; confirm only the four exact allowed packages surface and the `AGENTS.md` commands/versions remain current.
- [ ] Search `src/ui` for `TODO`, `TBD`, `FIXME`, `dangerouslySetInnerHTML`, `innerHTML`, remote `http` except loopback authority, and runtime imports of Start/Store/Pacer/Virtual/devtools.
- [ ] Inspect `package.json` and the esbuild metafile: production dependencies match Task 11 exactly, the Node UI server imports none of them, and the browser artifact has one output with zero imports/source maps.
- [ ] Request independent review against design sections 12, 17, 20, 22, and 23.7 before marking QK-UI-002..004 complete.

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| Loopback bind + Host authority | 3 |
| One-time 15-minute fragment token | 5, 12, 15, 17, 19 |
| No proposal data in initial shell | 12 |
| JSON approval only, fetch metadata | 6, 14, 15, 17 |
| Security headers + nonce CSP | 4, 12, 17 |
| Escaped hostile content | 2, 14, 16, 17 |
| Existing Tasks read model/view | 7, 13, 14 |
| Preflight proposal sections | 8, 13, 14 |
| Campaigns journal view | 9, 13, 14 |
| Task History compact provenance | 10, 13, 14 |
| Local coordination notices | 7, 9 |
| Framework-independent server; no Start | 3, 6, 11, 12, 19 |
| Focused Router/Query/Table/Form stack | 11, 13, 14 |
| Exact Intent trust and shipped guidance | 11 |
| No HTML/client-state persistence | 19 |
| Browser tests 23.7 | 17, 18 |
| Responsive layouts and Virtual gate | 18 |

### Placeholder scan

No `TBD`, `TODO`, or "implement later" steps remain. Each task includes concrete file paths, code, commands, and expected outcomes.

### Type consistency

- `envelopeDigest` is used consistently in token store, approval API, preflight proposal, and client approval view.
- Port names `ApprovalWritePort`, `PreflightReadPort`, `CampaignReadPort` are stable for the control-plane plan to implement.
- UI schema names follow `ui-*-v1` and are registered in `SchemaName`.
- Router params use `$campaignId`/`$taskId`; server paths use `:campaignId`/`:taskId`; both validate the same bounded identifier grammar.
- Query keys contain projection identity only; approval Form values contain acknowledgement only; the bearer token stays in the closure-backed vault.

### Concerns carried to execution

1. **Control-plane dependency:** Tasks 8–10 and 19 require real port implementations from `2026-07-21-quirks-campaign-control-plane.md`; until then fakes unblock UI development but end-to-end preflight approval needs CTL-002/003.
2. **Client bundling:** esbuild is dev-only; `pnpm build` must compile TypeScript and rebuild `dist/ui/client.bundle.js` from source before shell/Playwright tests. A stale checked-in browser artifact is not allowed.
3. **Client state:** Query cache, Router state, React state, and Form state are disposable projections. Any implementation that makes them authoritative or persists them is a design violation even if the UI appears to work.
4. **TanStack guidance:** CLI and Intent are alpha-era development tools invoked at exact recorded versions. They do not become production dependencies or runtime commands, and newly discovered skill sources require a reviewed allow-list change.
5. **Virtualization:** v1 deliberately starts without TanStack Virtual. A reproducible failure of Task 18 is a plan-amendment trigger, not permission to add the dependency ad hoc.
6. **Playwright in CI:** Chromium download adds CI time; expose the suite through `pnpm test:browser` and make the release gate provision the pinned browser rather than silently skipping browser tests.
