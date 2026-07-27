# Decision index

Every decision that shapes Quirks, where it is recorded, and whether it has become work yet.

**Why this file exists.** Quirks is being built because intent gets lost on long projects. The
2026-07-27 design session produced 34 decisions and nothing in any ledger — the exact failure
the product exists to prevent, happening while designing the fix. This index is the stopgap
until `quirks goal` can hold it properly, and it is a stopgap, not the answer: a markdown file
nobody is required to read is how intent gets lost in the first place.

**Status legend.** `spec` = recorded in a design document. `ledger` = exists as a goal/task.
`—` = decided in conversation and recorded here only.

---

## 2026-07-27 — Build fresh

| | Decision | Where | Ledger |
|---|---|---|---|
| **D0** | **Build v2 from scratch rather than convert v1.** 42% of v1's source files touch the layer being deleted; the ceremony is its best-tested code while `provenance` — the only thing serving problem B — is its worst. The knowledge is the asset, not the implementation. | [`FOUNDING.md`](FOUNDING.md) | — |

Every decision below was made against v1 and still holds. What changed is the implementation
they apply to. v1's code lives on the `v1` branch of this remote and at `~/code/quirks`.

## 2026-07-27 — Native app and service split

Spec: [`specs/native-app-and-service.md`](specs/native-app-and-service.md)

| | Decision | Where | Ledger |
|---|---|---|---|
| D1 | Native-rendered app, not a WebView shell | spec | — |
| D2 | TypeScript app core, not Zig | spec | — |
| D3 | One Bun binary is both service and CLI; Hono for routing | spec | — |
| D3a | One shared wire contract, imported type-only by the core | spec | — |
| D4 | The CLI is an HTTP client; fails loudly, with autostart | spec | — |
| D5 | Spawn the runtime from PATH now; bundle when packaging for others | spec | — |
| D6 | Paginated JSON on the wire; projections reshape server-side | spec | — |
| D7 | Client credential is a mode-0600 token file, not a pairing cookie | spec | — |
| D8 | ~~CLI command surface frozen~~ **withdrawn** — the surface is deliberately redesigned | spec | — |
| D9 | Rust considered and rejected (~17,700 + ~23,700 lines, 3 languages) | spec | — |

## 2026-07-27 — Runs, goals, and reports

Spec: [`specs/runs-goals-and-reports.md`](specs/runs-goals-and-reports.md)

| | Decision | Where | Ledger |
|---|---|---|---|
| D1 | A run replaces a campaign and is the only thing approved | spec | — |
| D2 | Five verbs; task status becomes flags, not request files | spec | — |
| D3 | Failure policy: continue, block dependents, lead the report with it | spec | — |
| D4 | The run is the unit of resumability | spec | — |
| D5 | TDD dropped as a blanket rule; kept for the runner and the report | spec | — |
| D6 | Preflight survives as a planning workspace, not an approval gate | spec | — |
| D7 | Harness and model tables surface state the system already computes | spec | — |
| D11 | One live parent agent per task; it dispatches reviewers, never reviews | spec | — |
| D12 | Quirks imposes no tool/MCP/skill restrictions on agents (~30× cost, accepted) | spec | — |
| D13 | Autonomy is a per-run mode: `autonomous` or `park-on-issue` | spec | — |
| D14 | `quirks report <id\|slug>` — NEEDS YOU first, never chronological | spec | — |
| D15 | **Goals**: the object above a task; a goal is never executable | spec | — |
| D16 | `quirks goal` verbs; `quirks run --goal` | spec | — |
| D17 | The brief: CLI supplies facts, skills supply judgment | spec | — |
| D17 | Precedence is recency; conflicts escalate to a higher-tier model | spec | — |
| D17 | The pin stays — it is the baseline that makes "this changed" computable | spec | — |
| D17 | Doc→task links are written into the doc; staleness accepted | spec | — |
| D18 | No plan document; the ledger is the plan | spec | — |
| D18 | The execution path is **never interactive**; goal creation may converse | spec | — |
| D18 | `quirks goal new` records; the brainstorm skill converses | spec | — |
| D18 | `needs design` / `needs breakdown` are flags; agent subtasks are neither | spec | — |
| D18 | Quirks owns its task schema and its own brainstorm skill | spec | — |

## 2026-07-27 — Step 1 build session (v2, this repo)

Decisions made brainstorming the store and the `goal`/`task` verbs. Recorded here only until
step 3 loads them in.

| | Decision | Where | Ledger |
|---|---|---|---|
| S1 | **The task-id prefix is the goal id.** `QK-SRV-003` belongs to goal `QK-SRV`; a goal-less task is a bare number (`QK-014`). Closes the "Task ids" open question below. | — | — |
| S2 | **`task propose` creates a live task; there is no acceptance state.** Lifecycle: `open → claimed → completed`, plus `blocked` from any non-terminal state. `blocked` remembers the status it interrupted; `release` restores it (claimed → open; blocked → what it interrupted). `complete` is permissive — any non-completed state, so a hand-finished task never needs ceremony. | — | — |
| S3 | **Task schema trimmed.** v1's `kind`, `priority`, `source`, `workflow`, `execution`, `provenance`, `coordination` are dropped; `effort`/`risk` stay as optional free text; `revision` is CLI-derived and bumped on every write, never operator-supplied. Ordering is `dependsOn` plus the run planner — priority fields go stale and lie. | — | — |
| S4 | **Output is TTY-sensitive on reads, JSON everywhere else.** `list`/`show` render tables on a TTY; JSON when piped or under `--json`; write verbs always emit the resulting object as JSON. Nothing prompts, ever. | — | — |
| S5 | **Store: `.quirks/goals.json` + `.quirks/tasks.json`**, versioned envelopes, temp+rename writes. Corrupt is distinguished from absent and reported loudly — the carried defect lands as a test from day one. | — | — |
| S6 | **Steps 1–3 the CLI opens the store directly**, behind the one module boundary the Hono routes take over at step 4. Not the forbidden fallback — there is no daemon to race yet — and no second path in is ever added. | — | — |
| S7 | **The founding doc's "brainstorm skill" is named `shape`** (create a goal, grow one, or split into several — one skill, orientation first). It converses lead-with-one-direction, never option menus; flags are asked, not imposed; spec only when the why earns it. | `.claude/skills/shape/` | — |

## Sequencing

From [`FOUNDING.md`](FOUNDING.md). The order exists so the system can hold its own intent as
early as possible.

| | Work | Why |
|---|---|---|
| 1 | Store + goals + tasks, all verbs non-interactive, timestamps from day one | Until decisions become goals and tasks, everything after is prose nothing tracks |
| 2 | The brainstorm skill | The moment it works, stop writing prose specs by hand |
| 3 | **Load this index's decisions in as goals and tasks** | First real dogfood: v2's backlog created by v2 |
| 4 | The service — Bun + Hono; the CLI becomes an HTTP client | |
| 5 | Runs: dispatch, the parent agent, failure policy, resume | |
| 6 | `quirks report` | |
| 7 | Harness + model tables | |
| 8 | The native app | Requires a stable CLI, service, and skills first |

## Carried defects — acceptance criteria, not memories

v1 bugs that must not be rewritten into v2. **Carrying a bug class across a rewrite is a test,
not vigilance** — each belongs as an acceptance criterion on the component that replaces it.

| Defect | Criterion for v2 |
|---|---|
| A non-zero runner exit recorded as durable terminal success | A non-zero exit is never a terminal success |
| A PID probe failing on `EPERM` read as "process died" | A permission failure is not evidence of death |
| A corrupt registry silently replaced with an empty one | Corrupt is distinguished from absent, and reported |
| Completion held in memory only | A run reported `completed` has actually transitioned its tasks, or it is not reported completed |
| `sourceRefs` pinned and never diffed | The pin is compared against HEAD, and the diff reaches the agent |

## Known open, not yet decided

- **Harness liveness** — where "is codex working" comes from at runtime, and how often it
  refreshes. In v1 that fact was prose in a checked-in doc with a hardcoded date.
- **The setup flow** — skills live in this repo for now (decided 2026-07-27); later the CLI
  gets a setup command that installs them and everything else a new repo needs. Needs design.
  **Ledger: `QK-001`** — the first open question tracked by the product instead of this file.
- **MCP** — named, deferred, no shape.
- **Multi-repo × runs** — whether a run can span repositories.
- **`--yes`** — an agent holding it can start any run, and nothing distinguishes the operator's
  delegation from an agent deciding on its own.
- ~~**Task ids**~~ — **resolved 2026-07-27 (S1):** the prefix *is* the goal id; goal-less
  tasks are bare numbers under the plain `QK-` namespace.

## The chicken and egg

The session that produced this index designed a system for not losing intent, and produced 34
decisions that exist only as prose. That is not irony to be enjoyed — it is the measurement.
Until step 3 above lands, every decision here depends on someone re-reading a markdown file,
which is precisely the mechanism that failed and produced the need for this product.

**Step 3 is not a preference about ordering. It is the exit from this condition**, and the
moment the `Ledger` column above stops reading `—` is the moment Quirks starts working.
