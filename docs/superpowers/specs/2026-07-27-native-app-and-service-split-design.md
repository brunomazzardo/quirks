# Native app and service split — design (QK-NAT-001)

Status: proposed, owner-ratified in conversation (Bruno, 2026-07-27). Supersedes the browser-UI stack decision of 2026-07-23.

**Partly revised the same day by `2026-07-27-runs-not-campaigns-design.md` (QK-RBT-001).**
That spec withdraws D8's frozen command surface, replaces the five-view list, and keeps the
Preflight view as a run planner. Read it alongside this one; where they disagree, it wins.

## What this is

Quirks becomes two artifacts instead of one repository that serves a browser:

1. **`quirks`** — one Bun binary that is both the HTTP service and the CLI. It owns the
   TaskSource, the campaign store, the runner layer, and the read-model projections.
2. **`Quirks.app`** — a native-rendered desktop app built with the Native SDK. Its logic
   is a TypeScript app core; its views are declarative `.native` markup. No browser, no
   WebView, no JavaScript runtime in the binary.

Everything that consumes Quirks — the CLI, the native app, and one day an MCP server —
is an HTTP client of the service. The service abstracts storage, so "the tasks live in a
JSON file on disk" stops leaking into clients that should not care.

## Why now

The 2026-07-23 stack decision said to stay on the framework-independent browser stack and
listed its revisit triggers: shipping beyond the local machine, true SSR, or a route tree
outgrowing code-based wiring. **None of those fired.** The owner reopened the decision on a
different basis — wanting a native application rather than a bookmarked localhost tab — and
that is a legitimate owner call, recorded here rather than rationalized into the old triggers.

The Bun decision has a genuine new trigger. "No Bun" was ratified when the server was only a
server, where Bun added a runtime for no gain. `bun build --compile` producing one
self-contained executable is a capability that decision did not weigh.

## Evidence gathered before this design

Measured on this machine (macOS, 2026-07-26/27), not read from documentation:

| Fact | Value |
|---|---|
| `native` CLI already installed | 0.6.1 |
| `native check --strict` on a scaffolded app | passes, 0.63s |
| `native build` (ReleaseFast, cold, incl. 50 MB Zig 0.16 download) | 5.1 MB binary, 80s |
| `bun build --compile` of a trivial `node:http` server | **58 MB** |
| `.quirks/tasks.json` today (138 tasks) | 216,191 bytes |
| `test/ui/fixtures/thousand-history-items.json` | 246,816 bytes |
| `Cmd.fetch` hard body ceiling | 262,144 bytes (256 KiB) |
| `src/` TypeScript | 19,686 lines |
| `test/` TypeScript | 23,719 lines |
| Server's runtime surface | `node:` builtins only — all implemented by Bun |
| `import type` from `"../../shared/wire.ts"` in a core | rejected, NS1034 (path escape) |
| `import type` from `"@quirks/wire"` in a core | **accepted, subset checker clean** |

Two of these decided architecture. The real ledger is already at **82%** of the fetch ceiling
and the perf fixture at **94%**, which forces pagination. And 17,700 lines of domain logic
behind 23,700 lines of tests is what a port to another language would cost.

## Decisions

### D1 — Native-rendered, not a WebView shell

The app draws through the Native SDK's own engine. The alternative (`native init --frontend
react`, keeping the React views inside a WebView) was rejected: it delivers a `.app` icon and
little else, and leaves the browser stack in place under a native wrapper.

### D2 — TypeScript core, not Zig

`src/core.ts` in the app-core subset. Rationale: it is the language this codebase is written
in; it keeps the authored stack to one language (the Zig the transpiler emits is a build
artifact nobody edits); and it lets the app and the service **share one type contract**
(D3a) — which no cross-language split can offer.

Accepted costs, each verified against the SDK's own documentation:

- **No `JSON`** in the subset. Response bodies arrive as `Uint8Array`; decoding is
  hand-written. The SDK's reference is `examples/ai-chat-ts/src/api.ts`.
- **No `<terminal>` / PTY.** Not in the `Cmd` vocabulary; it is Zig-only. Accepted because
  the owner reads runner transcripts after the fact, not live.
- **No windowed virtual list.** `ui.virtualWindow`/`ui.virtualList` are builder-only. Markup
  keeps bounded `<list virtualized>`, documented as suiting "hundreds" of rows.
- **No `data_grid`** (per-column cell templates) — explicitly not markup-expressible.

The escape hatch is real and recorded: `native_sdk.TsUiApp(core)` wraps a compiled TypeScript
core in Zig wiring — "the committed TS model IS the app model, no shim, no glue." That is the
seam through which `fx.ptySpawn` arrives the day runs start from inside the app. **Unverified:
this design has not built that seam.** Treat it as a plausible path, not a promise.

### D3 — Bun binary: service and CLI in one artifact, Hono for routing

One executable, two entry paths. Hono replaces the 174 hand-rolled lines of path matching in
`src/ui/router.ts`; it runs on Bun and Node both, so the runtime choice stays reversible.

Bun is chosen for CLI ergonomics as much as for `--compile` — owner preference, recorded as
such rather than argued from benchmarks.

### D3a — One shared wire contract, imported type-only

The wire types live in a workspace package, `@quirks/wire`. The Bun service imports it
normally; the native core imports it **type-only**. Types are erased at compile time, so
nothing crosses into the binary — what crosses is tsc checking the app's parsers against the
shape the service actually serves.

```ts
// src/parse/tasks.ts, inside the native core
import type { WireExistingTasksV1 } from "@quirks/wire";   // erased; checker-clean
```

Two rules, both verified rather than assumed:

- **A package name is required.** `import type { T } from "../../shared/wire.ts"` is rejected
  by NS1034 — "the entry module's directory is the core's whole world." Relative escapes stay
  banned even for types. This is a trap worth knowing before someone tries the obvious thing.
- **Wire types are not Model types.** The wire carries JSON `string`; the Model carries
  `Uint8Array` (NS1024), and the D6 reshapes apply on top. `@quirks/wire` pins the contract at
  the seam; the Model is derived from it, not equal to it.

### D4 — The CLI is an HTTP client. It fails loudly, with autostart.

The service becomes the authority boundary. The CLI stops opening the TaskSource directly.

- **Autostart:** a CLI invocation that finds no service starts one, using the same
  bind-or-attach discipline QK-SRV-002 specifies (bind success means you are the daemon;
  `EADDRINUSE` means attach). Liveness is the socket, never a pid file.
- **No direct-mode fallback.** A CLI that silently reverts to opening the TaskSource
  reintroduces multi-writer concurrency under exactly the conditions where it is hardest to
  observe. An unreachable service is reported as an unreachable service.

This is a doctrine change and is recorded as one (see "Doctrine amendments").

### D5 — Spawn the runtime from PATH now; bundle it when packaging for others

The `.app` stays 5.1 MB and spawns `bun` from PATH. Bundling the 58 MB runtime into
`Contents/Resources/` is a packaging flag, not a different architecture, and gets switched on
when Quirks is handed to anyone but its owner.

### D6 — Paginated JSON on the wire; the projections reshape server-side

No second wire format. The native app and the React UI read the same bytes, which is what lets
both run during the migration. Rejected alternative: a tab-separated record format — smaller
and cheaper to parse, but a second representation to keep honest for a saving that disappears
once the scanner exists.

The subset does force three reshapes, applied in the read-models:

| Today | Why it cannot stand | Native shape |
|---|---|---|
| `blockers: string[]`, `dependsOn: string[]`, `risk: string[]` | arrays of byte-strings are not model fields | `readonly { value: Uint8Array }[]` |
| `spend: Record<string, number>` | no dynamic-key records, no `Map` | `readonly { key: Uint8Array; amount: number }[]` |
| `title: string` and every dynamic text field | `string` model fields are banned (NS1024) | `Uint8Array` |

### D7 — Client credentials: a mode-0600 token file, not a cookie

QK-SRV-003's pairing cookie was designed for a browser. A native app has no cookie jar and no
same-origin policy, so `HttpOnly`/`SameSite` protect nothing here, and the CLI never had them.

Following the owner's ratified posture for this tool — *"local single-user… the protections
are cheap and boring… not building threat models or credential ceremonies"* — the service
writes a token to its state directory at mode 0600 on first start. Every client (CLI, native
app, later MCP) reads that file and sends it as a bearer header. Loopback bind stays. The
existing Origin check on the approval POST stays for as long as a browser client exists, and
retires with it.

What is deliberately kept from QK-SRV-003, because it is correctness rather than security
ceremony: the digest acknowledgment naming exactly what is being approved, the stored-envelope
re-read, the replay check at consume, and durable journaling with the approving client's
identity.

### D8 — The CLI's command surface is frozen; the skills layer is a first-class client

Quirks ships six agent skills across eleven files carrying **69 direct CLI invocations**
(34 `quirks-campaign`, 24 `quirks-tasks`, 11 `quirks-watchdog`). They are how agents learn the
framework, and they are a consumer of this architecture as much as the app is.

**The command surface does not change.** `quirks-tasks propose` keeps its name, arguments,
exit codes, and output shape. An agent must not be able to observe that a socket appeared
underneath it. This is what keeps D4's rewrite from rippling into eleven skill files and every
campaign brief that quotes them.

Two skills are nonetheless wrong the day this lands, and are corrected in the same change:

- **`running-agent-campaigns`** teaches "loopback **UI** approval." That flow becomes a native
  app; the skill's approval section is rewritten against it.
- **`writing-tasks`** teaches "without direct JSON mutation." True, and now *structural* —
  agents cannot reach the JSON at all, because only the service can. The skill states the
  boundary rather than asking agents to respect it.

New surface the skills must eventually teach — the HTTP API and the operation vocabulary
directly, for agents that would rather call an endpoint than shell out. Deferred with the MCP
server, not designed here; noted so it is not discovered late.

### D9 — Rust was considered and rejected

A full port would rewrite ~17,700 lines of domain logic and ~23,700 lines of tests, reopening
the defect classes in `src/runner/` that took five independent cross-vendor review rounds to
close — to save ~45 MB on a tool that runs on one laptop. It would also *increase* language
count from one authored language to three (Rust service, TypeScript core, Zig runtime), and
forfeit the shared type contract of D3a. If a single-language stack ever became the goal, the
answer would be Zig, not Rust — and the owner has ruled Zig out.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Quirks.app                    5.1 MB native binary      │
│                                                           │
│  src/core.ts        Model · Msg · update  (subset TS)     │
│  src/json.ts        byte scanner, written once            │
│  src/parse/*.ts     one targeted walk per projection      │
│  src/app.native     five views + shared templates         │
│  app.zon            window · menus · shortcuts · theme    │
└───────────────────────────┬──────────────────────────────┘
                            │ Cmd.fetch — GET, paginated JSON
┌───────────────────────────▼──────────────────────────────┐
│  quirks            one Bun binary: service + CLI          │
│                                                           │
│  Hono routes  →  read-models  →  TaskSource / stores      │
│  (unchanged domain: campaign, runner, sync, provenance)   │
└──────────────────────────────────────────────────────────┘
        ▲                        ▲                    ▲
        │                        │                    │
   quirks CLI            React UI (until cut)    MCP (later)

  @quirks/wire — the projection contract. The service imports it;
  the native core imports it TYPE-ONLY (erased, never in the binary).
```

### The model

Routing is a model union, not a router. There is no React, no TanStack, no bundle, no HTML.

```ts
export type View =
  | { readonly kind: "tasks" }
  | { readonly kind: "campaigns" }
  | { readonly kind: "campaign";  readonly id: Uint8Array }
  | { readonly kind: "preflight"; readonly id: Uint8Array }
  | { readonly kind: "history";   readonly taskId: Uint8Array };

export interface Model {
  readonly view: View;
  readonly tasks: readonly Task[];
  readonly loaded: number;
  readonly total: number;
  readonly loading: boolean;
  readonly failure: Uint8Array;   // empty = fine; never a silent empty table
}
```

### The dispatch cycle

```
act ─▶ Msg ─▶ update ─▶ [nextModel, Cmd.fetch(…)]
                            │
              model commits; loading state paints immediately
                            ▼
        { kind:"fetched", status: number, body: Uint8Array }
                            │
              parseTasks(body) ─▶ Task[] | null
                            │
              null ─▶ named failure state, never a half-parsed model
```

`update` is pure and synchronous — it returns *data describing* a fetch, never performs one.
Every state transition is therefore testable with no server, no window, and no browser.

### Freshness and paging

- **Freshness** is `subscriptions(model)` returning a `Sub.timer` only while something live
  warrants it, reconciled by key. It consumes the QK-SRV-007 revision endpoint.
- **Paging** is `<scroll on-reach-end="load_more">`, which has hysteresis built in and cannot
  storm. One mechanism answers all three budgets: the 256 KiB fetch ceiling, the 1024
  widget-node per-view budget, and the 1 MiB model heap.

### Budgets that bind

| Budget | Value | Consequence |
|---|---|---|
| Widget nodes per view | 1024 | 138 tasks × ~8 nodes = 1104 — over budget unmounted. Virtualize. |
| `Cmd.fetch` body | 256 KiB | Real ledger is at 82% today. Paginate. |
| Model heap / frame arena | 1 MiB each | Tunable via `--heap-cap` / `--frame-cap`; overflow panics loudly. |
| Markup virtualization | "hundreds" of rows | The 1000-row history fixture sits on this line. |

## Error handling

The failure discipline mirrors the runner layer's, deliberately:

- A malformed body yields `null` from the parser and a **named failure state**. Nothing maps
  a bad parse to an empty-but-fine view — the same rule as the runner's "absence fails closed
  to `indeterminate`."
- `Cmd.fetch` reports `truncated` when a body exceeds the ceiling rather than delivering a cut
  body. That reason surfaces as its own state, not as a generic error.
- An unreachable service is reported as unreachable, by both the CLI and the app.
- HTTP-level errors are delivered responses: a 404 arrives on the `ok` arm with its real
  status, and the app decides what it means.

## Testing

| Layer | Mechanism | Replaces |
|---|---|---|
| Core logic | `native dev --core` with `.ndjson` message scripts | React component tests |
| Parsers | plain `node --test` — the subset runs unmodified under node | — |
| Markup / bindings | `native check` verifies every binding path, message tag, and payload type against the real Model | type-checking JSX props |
| Live app | `native automate wait / snapshot / assert / widget-click / screenshot` | the Playwright suite |
| Service | the existing suites, unchanged | — |

`native automate` exposes the same stable widget ids the unit tests see, so live assertions are
regex greps against a snapshot. Deterministic screenshots replace visual-conformance captures.

## Doctrine amendments required in the same change

Not as follow-ups — these are wrong the moment this lands:

1. **`CLAUDE.md` "Local control UI guidance"** — the pinned browser-stack table, the TanStack
   Intent allow-list, the CLI-reference divergences, and the Virtual performance gate all
   describe a layer that stops existing. Replaced with native-app guidance.
2. **The 2026-07-23 stack decision** — marked superseded, with the honest reason: the owner
   wanted a native app, not that a documented trigger fired.
3. **"`TaskSource` is the task authority boundary"** — still true, but the *service* is now the
   only thing that holds it. Clients reach it over HTTP.
4. **"Quirks CLIs remain the only mechanical task/campaign authority"** — the CLI is now a
   client of that authority, not the authority itself.
5. **`AGENTS.md`** — mirrored, per the repository's parity rule.

## Effect on the QK-SRV workstream

Most of it survives; this is a re-pointing, not a deletion.

| Task | Status under this design |
|---|---|
| QK-SRV-002 daemon + bind-or-attach | Survives, and grows: it is now how the CLI works too |
| QK-SRV-004 multi-repo registry, server-side scoping | Survives unchanged |
| QK-SRV-005 approval end-to-end | Survives; the approving client changes |
| QK-SRV-006 launchd | Survives |
| QK-SRV-007 freshness (fs-watch → revision) | Survives; the app polls the revision |
| **QK-SRV-003 pairing cookie** | **Rewritten** — see D7. |
| QK-UI-008 … QK-UI-014 (motion, states, nav, visual refs) | **Retired.** They describe React views. |

## Out of scope (v1)

Remote (non-loopback) access; multi-user auth; the MCP server; mobile; live in-app run
launching via `<terminal>`; bundling the Bun runtime into `Contents/Resources/` (D5 ships
spawn-from-PATH; bundling is a later packaging flag, not a later architecture).

## Risks and honest unknowns

- **The `TsUiApp` Zig-wiring seam is documented but unbuilt here.** The "one day terminal"
  path rests on it. If it does not hold, that feature costs a core migration to Zig.
- **No Quirks view has been rendered in markup yet.** The 1024-node estimate for a task row
  (~8 nodes) is arithmetic, not measurement. The first implementation task must measure it via
  `native automate` and report `widget_nodes=N/1024`.
- **The JSON scanner has been read, not written.** ~230 lines lifted from `ai-chat-ts` plus
  40–80 per projection is an estimate against a flatter shape than Quirks'.
- **Bun has not run this codebase.** The runtime surface is `node:` builtins only, which Bun
  implements, but that is a compatibility claim, not a passing test suite.
- **The React UI and the native app diverge while both live.** Every projection reshape (D6)
  must keep the React client working, or the migration loses its safety net.

## Implementation order

Sequenced so each step produces something runnable and the safety net never drops:

1. **QK-NAT-002 — the wire contract and projection reshape.** Extract `@quirks/wire` as a
   workspace package; apply D6 in the read-models; React keeps working. Add `?offset=&limit=`
   to the list routes. Pure server change, existing tests cover it.
2. **QK-NAT-003 — the scanner.** `src/json.ts` in the subset, tested under `node --test`
   against real captured Quirks bodies.
3. **QK-NAT-004 — first view end-to-end.** Existing Tasks: parse, model, markup, virtualized
   rows, load-more. **Gate: report measured `widget_nodes` against 1024.** This is the task
   that proves or kills the estimates.
4. **QK-NAT-005 — service and CLI merge.** Hono routes; CLI becomes an HTTP client with
   autostart and loud failure. Doctrine amendments land here.
5. **QK-NAT-006 — remaining four views.** Campaigns, Campaign Detail, Preflight, Task History.
6. **QK-NAT-007 — approval.** Digest acknowledgment, durable write, replay check preserved.
7. **QK-NAT-008 — skills.** Rewrite `running-agent-campaigns`' approval section against the
   native app; restate `writing-tasks`' boundary as structural. Verify the other four still
   hold by running their CLI invocations against the service. `pnpm validate:skills` gates it.
8. **QK-NAT-009 — cut over.** Delete `src/ui/client/**`, the six browser dependencies, the
   esbuild bundle, and the Playwright suite. Rewrite the doctrine sections.

Steps 1–3 are reversible at any point; step 9 is the commitment.
