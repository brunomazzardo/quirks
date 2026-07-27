# Decision index

Every decision that shapes Quirks, where it is recorded, and whether it has become work yet.

**Why this file exists.** Quirks is being built because intent gets lost on long projects. The
2026-07-27 design session produced 30+ decisions across two specifications and nothing in the
ledger — the exact failure the product exists to prevent, happening while designing the fix.
This index is the stopgap until `quirks goal` can hold it properly, and it is a stopgap, not the
answer: a markdown file nobody is required to read is how intent gets lost in the first place.

**Status legend.** `spec` = recorded in a design document. `ledger` = exists as a goal/task.
`—` = decided in conversation and recorded here only.

---

## Superseded by the v2 founding document

`FOUNDING.md` (2026-07-27) decides to **build fresh rather than
convert**: 42% of v1's source files touch the layer being deleted, and the knowledge in these
specs — not the code — is the asset. Every decision below still holds; it is the implementation
they were going to be applied to that changes. The founding document is the entry point.

## 2026-07-27 — Native app and service split

Spec: [`specs/native-app-and-service.md`](specs/native-app-and-service.md)

| | Decision | Where | Ledger |
|---|---|---|---|
| D1 | Native-rendered app, not a WebView shell | spec | — |
| D2 | TypeScript app core, not Zig | spec | — |
| D3 | One Bun binary is both service and CLI; Hono for routing | spec | — |
| D3a | One `@quirks/wire` contract, imported type-only by the core | spec | — |
| D4 | The CLI is an HTTP client; fails loudly, with autostart | spec | — |
| D5 | Spawn the runtime from PATH now; bundle when packaging for others | spec | — |
| D6 | Paginated JSON on the wire; projections reshape server-side | spec | — |
| D7 | Client credential is a mode-0600 token file, not a pairing cookie | spec | — |
| D8 | ~~CLI command surface frozen~~ **withdrawn** by QK-RBT-001 | spec | — |
| D9 | Rust considered and rejected (~17,700 + ~23,700 lines, 3 languages) | spec | — |

## 2026-07-27 — Runs, not campaigns

Spec: [`specs/runs-goals-and-reports.md`](specs/runs-goals-and-reports.md)

| | Decision | Where | Ledger |
|---|---|---|---|
| D1 | A run replaces a campaign and is the only thing approved | spec | — |
| D2 | Five verbs; task status becomes flags, not request files | spec | — |
| D3 | Failure policy: continue, block dependents, lead the report with it | spec | — |
| D4 | The run is the unit of resumability | spec | — |
| D5 | TDD dropped as a blanket rule; kept for runner and provenance | spec | — |
| D6 | Preflight survives as a planning workspace, not an approval gate | spec | — |
| D7 | Harness and model tables surface state that already exists | spec | — |
| D9 | Rust rejected (see native spec D9) | spec | — |
| D11 | One live parent agent per task; it dispatches reviewers, never reviews | spec | — |
| D12 | Quirks imposes no tool/MCP/skill restrictions on agents (~30× cost, accepted) | spec | — |
| D13 | Autonomy is a per-run mode: `autonomous` or `park-on-issue` | spec | — |
| D14 | `quirks report <id\|slug>` — NEEDS YOU first, never chronological | spec | — |
| D15 | **Goals**: the object above a task; the id prefix already is one | spec | — |
| D16 | `quirks goal` verbs; `quirks run --goal` | spec | — |
| D17 | The brief: CLI supplies facts, skills supply judgment | spec | — |
| D17 | Precedence is recency; conflicts escalate to a higher-tier model | spec | — |
| D17 | The pin stays — it is the baseline that makes "this changed" computable | spec | — |
| D17 | Doc→task links are written into the doc; staleness accepted | spec | — |
| D18 | No plan document; the ledger is the plan | spec | — |
| D18 | The CLI is **never interactive** — agent-first in goal, scope, and shape | spec | — |
| D18 | `quirks goal new` records; the brainstorm skill converses | spec | — |
| D18 | `needs design` / `needs breakdown` are flags; agent subtasks are neither | spec | — |
| D18 | The task schema stops being Superpowers' (`family`, `phase`) | spec | — |

## Sequencing

| Order | Work | Why |
|---|---|---|
| 0a | Authoring skills + `goal new` + non-interactive `task propose` | Until decisions become tasks, everything after is prose nothing tracks |
| 0 | QK-RUN-012 | Its code survives the reboot; ~12 lines of bare-`catch` defects |
| 0b | QK-CTL-012 split | Budget half deleted; durable-completion half becomes an acceptance criterion |
| 1 | The run model, goals | |
| 2 | Delete the permission layer | |
| 3+ | Failure/resume, report, harness tables, doctrine, native app **last** | Native app requires a stable CLI/server/skills foundation |

## Ledger actions taken

| Date | Action | Commit |
|---|---|---|
| 2026-07-27 | QK-UI-008 parked — React motion work the reboot retires | `f4ab6e7` |
| 2026-07-27 | QK-RUN-011 superseded — capability model deleted, not enforced | `7042105` |
| 2026-07-27 | Three superseded plans moved, reasoning kept | `d54f35b` |

## Known open, not yet decided

- **QK-RUN-007/008/009 are merged but sit at `proposed`.** `complete` from `proposed` returns a
  conflict and `claim` wants a campaign, so there is no path to close them until QK-RBT-002.
- **Task and goal timestamps do not exist.** D17's recency ordering is meaningless without them;
  one commit date currently covers 138 tasks.
- **Migration** — 138 tasks, 4 campaigns, the campaign→run rename.
- **Harness liveness** — where "is codex working" comes from at runtime, and how often it
  refreshes. Today that fact is prose in `AGENTS.md` with a hardcoded date.
- **MCP** — named, deferred, no shape.
- **Multi-repo × runs** — whether a run can span repositories.
- **Push** — everything is local and unpushed; no remote strategy exists.

## The chicken and egg

This session designed a system for not losing intent, and produced 30+ decisions that exist
only as prose. That is not irony to be enjoyed — it is the measurement. Until step 0a lands,
every decision recorded here depends on someone re-reading a markdown file, which is precisely
the mechanism that failed and produced the need for this product.

**Step 0a is therefore not a preference about ordering. It is the exit from this condition.**
