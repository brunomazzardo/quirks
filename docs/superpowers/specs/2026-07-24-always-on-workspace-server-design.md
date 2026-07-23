# Always-on workspace server — design (QK-SRV-001)

Status: revised, owner-ratified. Decisions (Bruno, 2026-07-23 night): auto-spawn + launchd; approvals fully in the UI; global multi-repo; **security posture right-sized for a local single-user tool — no adversarial hardening**.

## What this is

`quirks ui` gives you a standing local server at a stable address that always shows current truth — every registered repo's tasks, past campaigns, and live campaigns — with no per-view command. Open it once, bookmark it, watch your background agents work.

This runs on your own laptop, bound to loopback, not exposed to a network. It is not defending against a hostile local machine. Design for that reality and keep it simple. The valuable properties here are **correctness and honest auditability**, not security ceremony.

## Architecture

1. **Daemon, start-or-attach.** `quirks ui` binds the configured port; bind success means it *is* the daemon, `EADDRINUSE` means one is already up and it just opens the URL. Liveness is the socket, never a pid file — a stale pid can belong to an unrelated process (the same lesson the campaign lock learned). A small `ui-server.json` record (via `resolveAppPaths`: port, instance id, version) is advisory only; a tiny `GET /health` (id + version, nothing else) confirms an attach reached the right server. Detached spawn, logs to a rotated file. Subcommands: `status`, `stop`, `restart`, `pair`, `unpair`, `install`/`uninstall`.

2. **launchd** (`quirks ui install`): a user LaunchAgent with KeepAlive — up at login, restarts on crash. `stop` must `launchctl bootout` (and disable) when the agent is installed, or KeepAlive just brings it back.

3. **Stable address + fast dev loop.** Fixed default port (e.g. 43117) in one config file under the `resolveAppPaths` state dir — same place as the record and logs, no second config location. Loopback bind, existing nonce-CSP / no-remote-assets shell, single IIFE bundle. **Dev-speed (owner picked this one):** esbuild watch/incremental rebuilds the bundle on save, and the server picks it up via temp+rename (torn-safe — never a half-written bundle), so editing a view and hitting refresh shows the change with no rebuild command.

4. **Global multi-repo.** A registry (auto-registered when you run `quirks ui` in a repo; `add-repo`/`remove-repo` to manage) lets one server serve all your quirks repos. Repo switcher in the nav; a unified "Active" strip shows live campaigns across every registered repo. Reads are scoped to the requested repo server-side, resolving through that repo's own store (the QK-UI-005 scoping generalized — kept because it's how the code already works and it prevents accidental cross-repo bleed, not because we're modeling an attacker). A registered root that's been deleted or unmounted shows an honest "unavailable" for that repo without taking down the rest.

5. **Freshness (real new work — the client does not poll today).** `src/ui/client/query-client.ts` sets `refetchOnWindowFocus: false` and only plan-progress has a `refetchInterval`. So this is a full slice (QK-SRV-007): the server watches each repo's `.quirks` **parent directory** (per-file watchers die on `writeJsonAtomic`'s atomic rename), debounced, bumping a per-repo revision; a revision endpoint; a small client poll that invalidates queries when the revision changes. Watchers torn down on `remove-repo`.

## Approval in the UI

Approvals happen in the browser. One pairing moment, then the client trusts the local API — no per-URL tokens, no vault, no dual modes.

- **Pairing:** first `quirks ui` opens a one-time link that sets a session cookie (`HttpOnly`, `SameSite=Strict`). `pair` mints a link for another browser; `unpair` revokes everything. The session lasts until you unpair; its secret sits hashed (mode 0600) in the state dir and survives restarts.
- **Approving:** a paired browser approves an `awaiting_approval` campaign directly. What stays — because it's correctness and honesty, not security theatre: the envelope summary you read, the digest-acknowledgment control that names exactly what you're approving, the durable digest-bound write to `approvals.jsonl`, the stored-envelope re-read + replay check at consume, and journaling with the approving session's identity.
- The approval POST keeps the **Origin check it already has** — one line, already written, left as-is.
- The token system is **deleted outright**: per-open viewer tokens, the approval-token vault, the ephemeral `ui open` token mode. `ui open` becomes an alias that attaches to the daemon.

## Sensible defaults (not a threat model)

Local, single-user tool. The protections are cheap and boring:

- Loopback-only bind (`127.0.0.1`) — never on a network.
- One pairing moment → a `HttpOnly`, `SameSite=Strict` cookie; after that the client trusts the local API.
- The existing Origin check on the approval POST stays. No CSRF tokens, no `Sec-Fetch` matrices, no second credential system.
- Digest acknowledgment on approval so you always know what you're approving (UX, not a credential).
- Durable approval + event journaling — the product's auditability, kept as a feature.
- `unpair` to reset sessions if you ever want to.

Explicitly **not** building: threat models, port-scoping analyses, credential ceremonies, byte-diff security-review gates. If the tool ever needs network exposure or multi-user, revisit then — not before.

## Doctrine amendment (same change as QK-SRV-003)

`AGENTS.md`'s UI section is recalibrated to this posture (loopback + one pairing cookie + honest journaling; the "credentials never in cookies" rule and the byte-diff security-review language relax for local UI work), and the founding spec's §12/§20 credential ceremony is marked superseded — in the same change that deletes the tokens, not as a follow-up.

## Stack decision

**Status: ratified by the owner, 2026-07-23.** Keep the framework-independent stack: Node `http` + esbuild IIFE bundle + pinned TanStack libraries. No TanStack Start, Next, or Bun. The daemon needs no SSR or server functions; a framework migration adds surface and version churn for no benefit here, and esbuild watch + torn-safe reload already gives the fast dev loop. If live push ever beats polling, SSE on the existing server is a small addition. Revisit only on a real server-rendering need, multi-user/remote access, or the route tree outgrowing code-based wiring.

## Out of scope (v1)

Remote/non-loopback access, multi-user auth, framework/SSR migration, write operations beyond approval, mobile.

## Implementation breakdown

Order: **QK-UI-010/011 → QK-SRV-002 → QK-SRV-003 → {004, 005} → 006**, with **007** (freshness) after 004. QK-UI-010 (running-campaign crash fix) and QK-UI-011 (live waves) land first — 003 rewrites the UI test harness and shouldn't do it under a broken live view.

**QK-SRV-002 — daemon + dev loop.** Bind-not-pid liveness (socket is the mutex; EADDRINUSE ⇒ attach; record advisory only, `/health` confirms attach). One config/record/log location via `resolveAppPaths`. Detached spawn, rotated logs. **esbuild watch + torn-safe (temp+rename) bundle reload** for the dev loop. Pre-pairing, attach reuses the existing viewer-token issuance so nothing but `/health` serves unauthenticated; browser approval stays on the legacy path until 003.

**QK-SRV-003 — pairing + trusted session (deletes the token system).** One-time pairing link → session cookie (HttpOnly, SameSite=Strict, host-only); `pair`/`unpair`; secret hashed 0600, survives restart. Keep the existing approval-POST Origin check. Delete per-open viewer tokens + approval vault + ephemeral token mode; `ui open` becomes a daemon alias. Evolve `ui-approval-request-v1` / `campaign-approval-v1` off `approvalToken`/`tokenId` to session identity. Migrate the token-based test harness (`launch-ui.ts` fragment boot, `test/ui/auth`, `approval`, `api-abuse`, `test/ui/api/*`) to paired-session auth. Amend `AGENTS.md` + note the §12/§20 supersession in this change. QK-UI-010/011 already landed.

**QK-SRV-004 — global multi-repo.** Registry (auto-register; add/remove). Repo-scoped reads; requested repositoryId must be registered; dead roots degrade honestly. Repo switcher + unified Active strip.

**QK-SRV-005 — UI approvals.** End-to-end paired-session approval keeping digest ack, stored-envelope re-read, replay check, durable journaling with session identity; per-campaign single-flight on the check-then-append. Approval UX from the wireframe footer.

**QK-SRV-006 — launchd.** install/uninstall the LaunchAgent; `stop`/`restart` interact with launchctl (KeepAlive must not resurrect a stopped daemon); restart on version mismatch.

**QK-SRV-007 — freshness.** Parent-dir fs-watch (survives atomic rename), debounce, per-repo revision + endpoint, client revision-poll that invalidates on change, watcher teardown on remove-repo. After 004.

## Notes

An independent design review ran on the earlier draft; its **correctness/ops** findings are folded in above (bind-not-pid liveness, torn-safe reload, rotated logs, one location strategy, freshness ownership, dead-root degradation, deletion sequencing, launchd stop semantics). Its **security-hardening** findings (port-blind CSRF analysis, `Sec-Fetch` mandates, cookie-attribute matrices, accepted-risk enumerations, per-task security acceptance criteria) were deliberately dropped per owner recalibration: this is a local single-user tool and does not warrant that engineering. Ledger: QK-SRV-001's original deliverable text ("approval credentials still per-campaign digest-bound and short-lived") is superseded by this revision; record at acceptance.
