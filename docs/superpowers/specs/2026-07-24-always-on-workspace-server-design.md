# Always-on workspace server — design (QK-SRV-001)

Status: DRAFT for independent design review. Owner decisions recorded 2026-07-23 night (Bruno, interactive): lifecycle **auto-spawn + launchd**; approvals **fully via UI, deliberately loosening the split-credential ceremony**; scope **global multi-repo now**.

## Goal

`quirks ui` gives a standing local server at a stable address that always shows current truth — every registered repository's tasks, past campaigns, and live campaigns — with zero per-view command ritual. "We should always have a live server… always up to date with past campaigns, live campaigns, all tasks."

## Architecture

1. **Daemon, start-or-attach.** `quirks ui` checks a daemon record (`~/Library/Application Support/Quirks/ui-server.json`: port, pid, startedAt, version). If alive: print/open `http://127.0.0.1:<port>`. If not: spawn the server detached (stdio to a log file under the state dir), write the record, open the browser. Subcommands: `status`, `stop`, `restart`, `unpair`, `install` / `uninstall` (launchd).
2. **launchd agent** (`quirks ui install`): user LaunchAgent plist running the compiled server entry with KeepAlive; start at login, restart on crash. `quirks ui` and launchd share the same daemon record; whoever finds a live server attaches.
3. **Stable address.** Default fixed port in `~/.config/quirks/ui.json` (created on first run, e.g. 43117), loopback bind only, unchanged Host/Origin checks, nonce-CSP, no remote assets, single IIFE bundle. Bundle is re-read when its mtime changes so a rebuild shows up without restart.
4. **Global multi-repo.** The daemon keeps a repo registry (in `ui.json`): running `quirks ui` inside a repository auto-registers it; `quirks ui add-repo/remove-repo` manage it explicitly. The shell nav gains a repository switcher; every read route is explicitly repo-scoped server-side (the standalone scoping model from QK-UI-005, generalized: the requested repositoryId must be in the registry, all reads resolve through that repo's own task source and campaign store, cross-repo leakage remains a test-gated invariant). Live campaigns across all registered repos surface in a unified "Active" strip; everything else renders within the selected repo context.
5. **Freshness.** Server-side reads stay durable-state-per-request (already true). Add fs-watch on each registered repo's `.quirks/tasks.json` and campaign store directories to bump a per-repo revision the client's existing polling reads, so updates appear within one poll cycle without new push infrastructure.

## Approval model (deliberate security amendment)

Owner decision: approvals must work end-to-end in the UI; the founding spec §12 split-credential ceremony (fresh approval token minted per campaign-bound `ui open`, carried in a URL fragment, closure-vaulted) is **retired for the standing server** in favor of a **paired operator session**:

- **Pairing (once per browser):** first `quirks ui` prints/opens a one-time pairing link; the server sets an HttpOnly, SameSite=Strict, Secure-equivalent (loopback) session cookie with a rotating secret persisted (hashed) in the state dir. `quirks ui unpair` revokes all sessions.
- **Viewing:** any paired browser sees everything. No URL tokens.
- **Approving:** a paired session may approve an `awaiting_approval` campaign directly. Kept, unconditionally: the envelope summary rendering, the explicit digest acknowledgment control naming the digest, the durable digest-bound `approvals.jsonl` write through the existing approval write port, stored-envelope re-read at consume time, replay protection, and journaling. Removed: the separate per-open approval credential and its vault plumbing.
- **Accepted risk (recorded, not hidden):** on this single-user machine, anything that can drive a paired browser can approve. Mitigations retained: loopback-only bind, HttpOnly+SameSite cookie, explicit digest acknowledgment, durable journal of every approval with session identity, `unpair` kill-switch. This supersedes the founding spec's §12 ceremony by owner decision; the CLI paths (`run` y/N, `approve --digest`) remain for scripting and recovery.
- **Simplicity posture (owner, 2026-07-23):** one auth moment, then the client trusts the local API. No per-request credentials, no dual auth modes, no vault plumbing anywhere. The digest acknowledgment stays because it is UX (know what you approve), not a credential. Anything resembling a second credential system in implementation review is a design violation, not caution.

## Out of scope (v1)

Remote/non-loopback access, multi-user auth, TanStack Start/SSR adoption, write operations beyond approval, mobile.

## Implementation breakdown (to propose after design review)

- **QK-SRV-002** — daemon lifecycle: start-or-attach, detached spawn, daemon record, status/stop/restart, stable port config, bundle mtime reload, log file. (CLI + server plumbing; no UI change.)
- **QK-SRV-003** — pairing + trusted local session, replacing the token system OUTRIGHT: pairing link flow, cookie sessions, unpair; the per-open URL viewer tokens, approval-token vault, and ephemeral `ui open` token mode are DELETED, not retained (owner amendment 2026-07-23: "the per-URL token thing is overengineered… set up some kind of auth, then the client should be trusting the local API"). `ui open` becomes an alias that attaches to the daemon.
- **QK-SRV-004** — global multi-repo registry, repo switcher nav, server-side repo scoping generalization with cross-repo leak tests, unified active-campaigns strip.
- **QK-SRV-005** — UI approvals via paired session (retire the approval-token ceremony in daemon mode) + the approval UX from the wireframes' fixed footer.
- **QK-SRV-006** — launchd install/uninstall + upgrade behavior (record schema version; `restart` on version mismatch).

Dependencies: 002 → 003 → {004, 005} → 006. QK-UI-010/011 (live-view crash fix, wave projections) land independently and this server inherits them.
