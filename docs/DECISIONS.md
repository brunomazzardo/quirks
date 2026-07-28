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
| D1 | Native-rendered app, not a WebView shell | spec | `QK-NAT` |
| D2 | TypeScript app core, not Zig | spec | `QK-NAT-001` |
| D3 | One Bun binary is both service and CLI; Hono for routing | spec | `QK-SRV` |
| D3a | One shared wire contract, imported type-only by the core | spec | `QK-NAT-001` |
| D4 | The CLI is an HTTP client; fails loudly, with autostart | spec | `QK-SRV-004` |
| D5 | Spawn the runtime from PATH now; bundle when packaging for others | spec | `QK-NAT` |
| D6 | Paginated JSON on the wire; projections reshape server-side | spec | `QK-SRV-001` |
| D7 | Client credential is a mode-0600 token file, not a pairing cookie | spec | `QK-SRV-003` (future) |
| D8 | ~~CLI command surface frozen~~ **withdrawn** — the surface is deliberately redesigned | spec | — |
| D9 | Rust considered and rejected (~17,700 + ~23,700 lines, 3 languages) | spec | — |

## 2026-07-27 — Runs, goals, and reports

Spec: [`specs/runs-goals-and-reports.md`](specs/runs-goals-and-reports.md)

| | Decision | Where | Ledger |
|---|---|---|---|
| D1 | A run replaces a campaign and is the only thing approved | spec | `QK-RUN-001` |
| D2 | Five verbs; task status becomes flags, not request files | spec | ✔ goal/task built · `QK-RUN-001` |
| D3 | Failure policy: continue, block dependents, lead the report with it | spec | `QK-RUN-005` |
| D4 | The run is the unit of resumability | spec | `QK-RUN-006` |
| D5 | TDD dropped as a blanket rule; kept for the runner and the report | spec | `QK-RUN-004` |
| D6 | Preflight survives as a planning workspace, not an approval gate | spec | `QK-RUN-001` |
| D7 | Harness and model tables surface state the system already computes | spec | `QK-HARN-001` |
| D11 | One live parent agent per task; it dispatches reviewers, never reviews | spec | `QK-RUN-005` |
| D12 | Quirks imposes no tool/MCP/skill restrictions on agents (~30× cost, accepted) | spec | `QK-RUN-005` |
| D13 | Autonomy is a per-run mode: `autonomous` or `park-on-issue` | spec | `QK-RUN-005` |
| D14 | `quirks report <id\|slug>` — NEEDS YOU first, never chronological | spec | `QK-REP-001` |
| D15 | **Goals**: the object above a task; a goal is never executable | spec | ✔ built (step 1) |
| D16 | `quirks goal` verbs; `quirks run --goal` | spec | ✔ built · `run --goal` → `QK-RUN-001` |
| D17 | The brief: CLI supplies facts, skills supply judgment | spec | `QK-RUN-002` |
| D17 | Precedence is recency; conflicts escalate to a higher-tier model | spec | `QK-SKILL-003` |
| D17 | The pin stays — it is the baseline that makes "this changed" computable | spec | `QK-RUN-002` |
| D17 | Doc→task links are written into the doc; staleness accepted | spec | `QK-SKILL-003` |
| D18 | No plan document; the ledger is the plan | spec | ✔ shape skill built |
| D18 | The execution path is **never interactive**; goal creation may converse | spec | `QK-RUN-001` |
| D18 | `quirks goal new` records; the brainstorm skill converses | spec | ✔ built (step 2) |
| D18 | `needs design` / `needs breakdown` are flags; agent subtasks are neither | spec | ✔ built (step 1) |
| D18 | Quirks owns its task schema and its own brainstorm skill | spec | ✔ built (steps 1–2) |

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
| S8 | **`future` is a task flag, distinct from `blocked`.** Blocked means cannot proceed; future means deliberately not now. Excluded from the rollup's open count, own column, advisory (claiming is not gated). First uses: `QK-SRV-003` (auth/token — loopback carries the interim) and `QK-SRV-005` (multi-repo). | `src` | ✔ built |
| S9 | **The native workbench moves ahead of runs** (was bootstrap step 8). Left: ledger. Center: the agents' terminal. Right: webview for previews and companion screens — modeled on vercel-labs/native `examples/workbench`. The SDK grew TS-tier pty + `<terminal>` (both authoring tiers) since the spec, so D2's "no terminal in the TS core" accepted cost is obsolete; `QK-NAT-001` spikes the one remaining unknown (`terminal_sessions` in a transpiled core). | — | `QK-NAT` |

## 2026-07-28 — Shaping the judgment skills (`QK-SKILL`)

| | Decision | Where | Ledger |
|---|---|---|---|
| S10 | **`.agents/skills` is a single directory symlink to `.claude/skills`**, not a directory of per-skill symlinks. Parity then holds for every future skill with no per-skill bookkeeping, and a skill added on either side is immediately reachable from both. Git stores it as mode `120000`. **`quirks setup` must create this symlink** — that is part of "installs the skills" and it is the reason this row exists rather than a ledger entry: `QK-001` is the right home, but there is no `quirks task` verb to append a deliverable to a recorded task, so the detail would otherwise be lost. Fold it into `QK-001` when that task is designed. | `.agents/skills` | `QK-001` |
| S11 | **The brief becomes a rendered Markdown document** with the assembled facts embedded, replacing the raw `JSON.stringify` an agent receives today. It is the artifact an agent *reads*, and the ground rules — each bought with a lost night — must not be string entries inside an object. This also fixes `buildClaudeArgv` passing a bare file path as claude's entire prompt, with nothing instructing it to read the file. | `src/ops/brief.ts`, `src/runner/*` | `QK-SKILL` |
| S12 | **Judgment reaches non-claude runners by length and stakes: ground rules inlined, judgment skills referenced by path.** `.claude/skills/` is discovered only by claude, while the brief goes to all three runners and cross-vendor review is deliberate. The four ground-rule imperatives are short enough to inline for free and too costly to risk on a pointer; source-conflict and scope are multi-step procedures that would bloat every brief and change as we learn, so the brief instructs the agent to read them at a vendor-neutral path. Matches v1's approach recorded in `docs/evidence/host-matrix.md`. | `src/ops/brief.ts`, `.claude/skills/` | `QK-SKILL` |
| S13 | **Source-conflict judgment escalates per task at execute time, gated on a changed source, and fails closed.** Invalidation is task-specific, so the verdict is per task; `sourceFact`'s existing `changed` flag is the free gate, so an unchanged task costs no dispatch. The supervisor's own claim is quote-verified through `resolveVerdict`, and **both `invalidated` and `indeterminate` block the task in *either* run mode** — autonomy means not waiting for approval, not ignoring a finding, and absence never means accept. `block`, never `release`, because a released task re-escalates and loops. `--skip-escalation` is the operator's explicit, recorded override. | `src/run/`, `src/ops/brief.ts` | `QK-RUN-008` |
| S14 | **Mutation and history are complementary: `task update` is bounded to un-started tasks, supersede carries anything already done.** Update refuses `completed` (that is history — an agent was already judged against those promises) and refuses `claimed` (something is working against that brief right now; changing it mid-flight is the source-changed-under-me problem, self-inflicted). That boundary is what makes it safe to keep **no** revision history: nothing editable has been acted on. Arrays replace wholesale when passed, untouched when omitted. Clearing `--no-needs-design` requires at least one deliverable — a task cannot be declared designed while it has nothing to build. `--supersedes` becomes real data rather than free text inside `--evidence`. | `src/ops/tasks.ts`, `src/cli/task.ts` | `QK-SRV-007` |
| S15 | **Breakdown is ONE skill with two callers, and the decomposition is recorded up front.** The judgment — what the parts are, their order, when a task is small enough not to split — is identical whoever asks; only the terminal state differs. Operator caller: a `needs breakdown` ledger task becomes several ledger tasks. **Executor caller mid-run: the parts become run-record subtasks, never ledger tasks.** FOUNDING describes both flags as routing to "an interactive flow with the operator", which is the flagged-task path specifically, not a claim that decomposition is only ever operator-facing. This is why `QK-SKILL-002` felt thin — half of it was already sitting in `QK-SKILL-004`. The subtasks are written **before** work starts, not appended as it completes: an append-as-you-go log cannot distinguish "did 3 of 3" from "died after 3 of 7", so a crashed overnight run must still show the denominator. The agent writes through the daemon via a `quirks run subtask` verb, because an agent subprocess must not become a second writer into `.quirks/`. | `.claude/skills/`, `src/run/` | `QK-SKILL-007`, `QK-RUN-009` |

## Sequencing

From [`FOUNDING.md`](FOUNDING.md). The order exists so the system can hold its own intent as
early as possible.

Reordered 2026-07-27 (S9): the native workbench moves ahead of runs — owner call.

| | Work | Ledger | Why |
|---|---|---|---|
| 1 | ✔ Store + goals + tasks (2026-07-27) | built | Until decisions become goals and tasks, everything after is prose nothing tracks |
| 2 | ✔ The shape skill + companion (2026-07-27) | built, `QK-COMP` | The moment it works, stop writing prose specs by hand |
| 3 | ✔ **This index's decisions loaded as goals and tasks** (2026-07-27) | the columns above | First real dogfood: v2's backlog created by v2 |
| 4 | The service — Bun + Hono; the CLI becomes an HTTP client | `QK-SRV` | The workbench's ledger pane is its client |
| 5 | The native workbench — ledger, terminal, preview | `QK-NAT` | Owner reprioritized from last (was step 8): the daily driver, so later pieces land inside a surface already lived in |
| 6 | Runs: dispatch, the parent agent, failure policy, resume | `QK-RUN` | |
| 7 | `quirks report` | `QK-REP` | |
| 8 | Harness + model tables | `QK-HARN` | |

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

- **The setup flow** — skills live in this repo for now (decided 2026-07-27); later the CLI
  gets a setup command that installs them and everything else a new repo needs. Needs design.
  **Ledger: `QK-001`** — the first open question tracked by the product instead of this file.
- **MCP** — named, deferred, no shape.
- **Multi-repo × runs** — whether a run can span repositories.
- **`--yes`** — an agent holding it can start any run, and nothing distinguishes the operator's
  delegation from an agent deciding on its own.
- ~~**Task ids**~~ — **resolved 2026-07-27 (S1):** the prefix *is* the goal id; goal-less
  tasks are bare numbers under the plain `QK-` namespace.
- ~~**Harness liveness**~~ — **resolved 2026-07-28 (`QK-HARN-001`):** liveness is **derived from
  the run record, never a live probe.** Every dispatch persists its runner, model, timestamp,
  exit code, and the runner's own failure text (`RunDispatchRecord`), so the newest dispatch per
  runner *is* the answer — a quota refusal arrives dated and attributable instead of as prose.
  It therefore refreshes exactly when a run dispatches, which costs nothing. `quirks harness
  --probe` is the explicit opt-in for a real `--version` round trip before an overnight run.
  Availability has **three** states, not two: a harness nobody has dispatched is `unproven`,
  never `yes`.

## The chicken and egg

The session that produced this index designed a system for not losing intent, and produced 34
decisions that exist only as prose. That is not irony to be enjoyed — it is the measurement.
Until step 3 above lands, every decision here depends on someone re-reading a markdown file,
which is precisely the mechanism that failed and produced the need for this product.

**Step 3 is not a preference about ordering. It is the exit from this condition**, and the
moment the `Ledger` column above stops reading `—` is the moment Quirks starts working.

**2026-07-27, evening: step 3 landed.** The columns above now point at recorded goals and
tasks; from here, intent changes go to `quirks goal` / `quirks task` first and this file only
follows.
