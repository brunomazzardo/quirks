# Quirks v2 — founding document

Written 2026-07-27. **Build fresh rather than convert.** This is the entry point for a new
session starting from zero; every other document is referenced from here.

## Why from scratch

The existing codebase is 19,686 lines of `src` and 23,719 lines of tests, and **60 of its 144
source files (42%) touch the envelope/approval/digest layer the reboot deletes**. The ceremony
is also the best-tested part: `campaign` sits at 2.2:1 test-to-source, `ui` at 2.5:1, while
`provenance` — the only thing serving the product's second reason to exist — sits at 0.57:1.

Converting that means unpicking a permission system from a scheduler, retiring a React client
with 7,900 lines of tests, and carrying a `TaskSource` protocol built for adapters that do not
exist yet. Building fresh with the direction settled is less work than any of it.

**What survives is the knowledge, not the code.** The specs below cost weeks of real probing —
five cross-vendor review rounds, measured CLI failures, a real managing-agent layer. That is
the asset. The implementation is replaceable.

## What Quirks is

Two problems, and nothing else is allowed to outrank them:

- **A.** Structure what you want built on a large project, without losing intent.
- **B.** Let agents run overnight, then understand what happened and what went wrong.

**The line the design rests on:**

> **Honesty machinery is code. Permission machinery does not exist. Judgment lives in skills.**

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  quirks — one Bun binary: HTTP service AND CLI              │
│  Hono routes · a plain JSON store · runner dispatch         │
│  THE authority. The only thing that touches storage.        │
└───────────┬──────────────┬───────────────┬──────────────────┘
            │              │               │
      quirks CLI      native app        MCP server
   (HTTP client,   (Native SDK,      (later — falls out
    autostarts     TypeScript core)   once HTTP exists)
    the service)
```

- **The CLI is an HTTP client.** It fails loudly when the service is unreachable and autostarts
  one using bind-or-attach (bind success means you *are* the daemon; `EADDRINUSE` means attach).
  Liveness is the socket, never a pid file. **No direct-store fallback** — that reintroduces
  multi-writer concurrency exactly when it is hardest to observe.
- **The native app is a client too.** Native SDK, TypeScript app core, markup views. It comes
  **last**, after the CLI, service, and skills are stable.
- **MCP is another client.** Deferred, but the HTTP surface should not make it awkward.

## The model: goal → task → run

What I am trying to achieve · what needs doing · when agents did it.

- **Goal** — the object above a task. Carries `why` (a pointer to a spec, never a copied body),
  `doneWhen` criteria, and an asserted state: `active` | `done` | `abandoned`, the latter two
  **requiring a reason**. `doneWhen` is asserted, never derived — every member task can complete
  while the thing is not built. **A goal is never executable**: the moment you can "run a goal"
  it collapses into a run and long-lived intent is lost again.
- **Task** — a unit of work, ordered by `dependsOn`. **Never approved.** Flags: `needs design`
  (we don't know what to build) and `needs breakdown` (we know, it's too big) — each routes to
  an interactive flow with the operator.
- **Run** — a named parent grouping tasks: a feature. **The only thing approved**, once, over a
  plan you can read. Also the unit of resumability.

### The verbs

```
quirks goal   list | show | new | done | abandon
quirks task   propose | list | show | block | claim | complete | release
quirks run    QK-A QK-B --name "…" [--goal X] [--mode autonomous|park-on-issue] [--yes]
quirks status
quirks report <run-id|slug>
quirks harness
```

**Interactivity is drawn by path.** Goal creation may converse when a human is present; given
flags it stays headless. **The execution path never converses** — agents run this, and a prompt
is a hung overnight run. `quirks run`'s confirmation therefore takes `--yes`.

## Founding principle: refactoring is cheap, so build the simple thing

Make it work locally first. Add structure when a second case actually arrives, not in
anticipation of one.

### Do NOT build (all of these existed in v1 and all of them cost more than they returned)

| Not building | Why |
|---|---|
| **The `TaskSource` adapter protocol** | v1 has a capabilities negotiation, an operations enum, request/response schemas, and idempotency plumbing — for a provider set of exactly one (a JSON file). Write a plain store. Add the adapter boundary the day a second provider is real. |
| Envelopes, digests, approval tokens | A race against yourself on your own laptop, seconds apart |
| The capability model | v1 admits it "is not an enforcement boundary" |
| Leases, claims, circuit breakers | Single writer, no contention |
| Per-invocation budgets | v1 admits they "reset every invocation" |
| A separate preflight command | Planning is a workspace, not a gate |
| Plan documents | The ledger *is* the plan. v1's last two plans were 38 and 28 lines — the layer was already dissolving |
| Blanket TDD | Test the runner and the report. Elsewhere, when it earns it |
| Remote access, multi-user, auth | Local single-user tool. Loopback bind and a mode-0600 token is the whole story |

### Do build, from the start

- **The honesty properties** (below) — these are the product.
- **`goal list` as a union** of recorded goals and goals the task ids imply. A goal with no
  tasks yet is exactly the intent this object exists to hold; deriving from tasks alone hides
  the thing you just declared.
- **Timestamps on everything** — `createdAt`/`updatedAt` on goals and tasks. v1 has none, and
  recency-based precedence is inert without them.
- **A reason required** to leave `active`. A dropped direction with no reason is the silent
  backlog rot that makes a ledger lie.

## The honesty properties — carry these exactly

These cost five independent cross-vendor review rounds in v1, each of which found something the
previous round missed, including two defects introduced while fixing earlier ones.

- **A verdict must quote the runner's own words**, and Quirks verifies that quote against the
  retained transcript — in its own code, not on the agent's word. Only the runner's own messages
  count (not the brief it read), a quote must begin where a sentence begins, and an `accept` may
  not rest on words a refusal was leading up to.
- **Absence fails closed to `indeterminate`.** Nothing maps absence to `accept`.
- **The transcript is always retained**, including on timeout and flood.
- **A non-zero runner exit is never a durable terminal success.** A PID probe failing for
  *permission* reasons is not evidence the process died. A corrupt registry is not an empty one.
  (These are v1's QK-RUN-012 — bare `catch` blocks collapsing distinct failures into a benign
  default. Do not rewrite them into v2.)
- **A run reported `completed` has actually transitioned its tasks, or it is not reported
  completed.** (v1's QK-CTL-012 — completion was memory-only.)

**Carrying a bug class across a rewrite is a test, not vigilance.** Every defect above must land
as an acceptance criterion on the v2 component that replaces it, or the rewrite reintroduces it
and the audit that found it is wasted.

## The execution model

One **parent agent per task**, live on that task's harness for the duration — not a post-hoc
transcript reader. It claims the task, dispatches the implementer, watches, and on an honest
partial writes a **continuation brief into the same worktree**: what exists, numbered remaining
scope, "do not redo groundwork."

Where review is part of completion, the parent **dispatches a reviewer on a different model**
through the CLI. It never reviews its own task's work.

**Quirks imposes no tool, MCP, or skill restrictions on the agents it launches.** v1 measured
$0.0049 restricted against $0.145 a call unrestricted; that ~30× is the price of a parent that
can actually act, and it belongs in the plan a run prints, not hidden. The honesty property does
not depend on the restriction — quote verification is mechanical and does not ask permission.

**Autonomy is a per-run mode.** `--mode autonomous` decides and continues. `--mode
park-on-issue` uses the phase boundary: **before a landing commit exists a failure releases the
work; once a verified landing commit exists a failure holds it for the operator and never
unassigns verified work.**

## `quirks report <run-id|slug>`

Answers one question — **what needs me now?** — then explains the night. Fixed order, never
chronological: **NEEDS YOU** (rejected, held-after-land, `indeterminate`) → **PARTIAL** →
**ACCEPTED**. One screen by default; `--task <id>` for the full transcript and diff.

Per task: files changed, the runner's reasoning, **verbatim test tails** (not a summary), risks,
acceptance-criteria mapping, `git status --porcelain`.

Every quoted sentence is the same bytes verified against the transcript — the report never
paraphrases a verdict. PARTIAL has an objective bar: commits individually reviewed as
scope-correct, the completed subset passing its stated verification verbatim, and an explicit
written list of what remains. "Mostly done" is a rejection with no partial-credit framing.

## The brief — CLI supplies facts, skills supply judgment

**CLI assembles** (verifiable): task facts, goal `why`/`doneWhen`, git base/candidate commits,
and for every source its **pinned commit, current HEAD, the diff between them, and last-changed
dates**. Plus operator notes and an instructions hash.

**Skills govern** (judgment, no code): whether that diff invalidates the task, conflict
resolution, scope, when to stop and surface.

- **Precedence is recency** — the most recently changed source wins. It self-maintains, and on
  v1's real dates it ordered correctly where a fixed ladder put the stalest source on top.
- **The pin stays**, for the non-obvious reason: it is not an alternative to reading current, it
  is *the baseline that makes "this changed" computable*. v1 pins and never diffs — worst of
  both.
- **Escalation:** supervisor diffs → a higher-tier model holding the conflict skill decides
  whether anything is invalidated (detection is itself judgment) → recency orders what it flags
  → the operator sees only what it cannot call.
- **Doc→task links are written into the doc.** Visible where you read. Staleness accepted.

Ground rules every brief carries, each learned by losing a night: **the workspace is already
decided — do not ask, begin** (repository rules that say "ask the operator" make agents stop and
wait until morning); read the repository instructions and the goal's `why` before the
deliverables; smallest complete change; never push; report in the shape above.

## Where tasks come from

```
idea → brainstorm SKILL (interactive, with the operator)
     → spec  →  quirks goal new  →  quirks task propose ×N
```

No plan document. Quirks owns its own brainstorm because Superpowers' states its terminal state
as *"the ONLY skill you invoke after brainstorming is writing-plans"* — hardwired to end in a
plan. Ours ends in **tasks**.

## Skills Quirks must own

These carry the discipline that used to be code, so they are deliverables:

**brainstorm** (ends in goals + tasks) · **design** (`needs design`) · **breakdown** (`needs
breakdown`) · **execution** (how an agent organizes a large task and records internal subtasks —
internal, but structured so `quirks report` can render them) · **source-conflict** and **scope**
(the brief's judgment) · plus rewrites of v1's six task/campaign skills against the new verbs.

## Bootstrap: dogfood Quirks with Quirks

The order exists so the system can hold its own intent as early as possible:

1. **Store + goals + tasks.** A plain JSON store, `quirks goal`, `quirks task` — all verbs
   non-interactive, flags in, JSON out. Timestamps from day one.
2. **The brainstorm skill.** The moment this works, *stop writing prose specs by hand* and use it.
3. **Load this document's own decisions in as goals and tasks.** First real dogfood: v2's
   backlog should be created by v2.
4. **The service.** Bun + Hono; the CLI becomes an HTTP client with autostart.
5. **Runs.** Dispatch, the parent agent, failure policy, resume.
6. **`quirks report`.**
7. **Harness + model tables.**
8. **The native app.**

## Reference

**In this repo** — the documents are the asset; they are all that was carried from v1.

| | |
|---|---|
| `docs/DECISIONS.md` | All 33 decisions, with where each is recorded |
| `docs/specs/runs-goals-and-reports.md` | Runs, goals, the brief, the report, the execution model — the deepest source |
| `docs/specs/native-app-and-service.md` | Native app, Bun service, wire format, credentials |
| `docs/specs/managing-agent-runner.md` | The managing-agent layer and its honesty properties |
| `docs/specs/daemon-lifecycle.md` | Bind-or-attach, socket-not-pid liveness, rotated logs |
| `docs/evidence/v1-audit.md` | The audit numbers and the gotchas found by doing |
| `docs/evidence/managing-agent-probe.md` | Real-CLI evidence for the runner |
| `docs/evidence/runner-boundary-probe.md` | Runner boundary findings |
| `docs/evidence/host-matrix.md` | Real host×runner matrix (best run 4/9) |

**In v1, for code reference only** — `~/code/quirks`, and `origin/v1` on the remote:

| | |
|---|---|
| `src/runner/{claude,codex,cursor}.ts` | **Read before rewriting.** cursor was sent a `--file` flag that does not exist; claude's brief was swallowed by a variadic `--add-dir`; claude depended on a machine-local `verbose` setting |
| `hosts/{claude,codex,cursor}/discover.mjs` | Harness discovery, for `quirks harness` |
| `skills/` | Six skills to **rewrite, not copy** |

**Outside both** — the behavior named as the target:
`~/code/game/pilot/.claude/skills/overnight-orchestration` and `overnight-issue-worker`
(gate sequence, PARTIAL bar, phase boundary).

### Measured facts, so v2 does not re-derive them

| | |
|---|---|
| `Cmd.fetch` body ceiling (Native SDK) | 262,144 bytes — v1's real ledger is at 82% of it |
| Widget nodes per view (Native SDK) | 1,024 — a task row is ~8 nodes |
| `bun build --compile` of a trivial server | 58 MB |
| Native SDK ReleaseFast binary | 5.1 MB |
| Managing agent, restricted vs not | $0.0049 vs $0.145 per call |
| Goal ids | Already encoded in task-id prefixes — v1 grew 20 across 138 tasks |

## Working agreements

- **Brainstorm with the operator.** Delegated brainstorming is only for agent flows with no
  human guiding.
- Explain, recommend, ask one question at a time in prose. Option menus get declined.
- Voice transcription garbles technical terms — read the architecture back before building on it.
- Nothing is pushed to any remote without the owner's say.
