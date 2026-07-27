# Runs, not campaigns — removing the permission layer (QK-RBT-001)

Status: proposed, owner-directed (Bruno, 2026-07-27). Revises parts of
`2026-07-27-native-app-and-service-split-design.md` — see "Amendments" at the end.

## What this is

Quirks was built to solve two problems. Somewhere along the way it grew a third job nobody
asked for — guarding the user against themselves — and that job now outweighs the two real
ones in code, in tests, and in the number of keystrokes between wanting something and getting
it. This removes it.

**Problem A.** Structure what you want built on a large project, without losing intent.
**Problem B.** Let agents run overnight, then understand what happened and what went wrong.

Everything below is judged against those two and nothing else.

## Evidence

Measured on the repository at `2a09f76`:

| | |
|---|---:|
| Commands to run one task (documented happy path) | **6** + a browser round-trip |
| `envelope` / `approval` / `digest` mentions in `src/` | **1,274** |
| Source files touching envelope, approval, or digest | **60 of 144 (42%)** |
| `src/campaign/supervisor.ts` | 971 lines |
| JSON schemas | 27 |

Test weight, which is where the priorities show:

| Area | src | test | ratio |
|---|---:|---:|---:|
| `ui` | 3,223 | 7,921 | 2.5 : 1 |
| `campaign` | 2,786 | 6,051 | 2.2 : 1 |
| `runner` | 3,894 | 4,181 | 1.1 : 1 |
| **`provenance`** | **819** | **465** | **0.57 : 1** |

The permission layer is the best-tested code in the project. `provenance` — the only thing
that answers problem B — is the least-tested. That inversion is the finding.

## The distinction this rests on

Two kinds of machinery got built and they are not the same thing.

**Honesty machinery — kept, and invested in.** A verdict must quote the runner's own words,
verified against the retained transcript. Only the runner's own messages count, and a quote
must begin where a sentence begins. Absence fails closed to `indeterminate`. Transcripts are
always retained, including on timeout and flood. The managing agent reports what a runner said
and cannot accept on its own authority.

This is what makes a morning report trustworthy. It *is* problem B. It stays, and
`provenance` grows to match it.

**Permission machinery — removed.** Digest-bound envelopes, browser approval, approval tokens,
the capability model, leases, claims, circuit breakers, per-invocation budgets. This is a local
tool where the operator typed the command. The digest guards against an envelope changing
between proposal and approval — a race against yourself, on your own laptop, seconds apart.

The repository already documents that two of these do not work: the capability model "is not an
enforcement boundary" (`repository-write` maps to `--dangerously-skip-permissions`), and
budgets "reset every invocation" (QK-CTL-012, P0). They are ceremony that does not perform
the job it charges for.

## Decisions

### D1 — A run is the unit of intent and the only thing approved

**Task** — a unit of work with intent captured, ordered by `dependsOn`. **Never approved.**
**Run** — a named parent grouping tasks: a feature. **Approved once, before execution.**

"Campaign" is retired as a name. A run is what it is.

Approval happens once per run, either as a terminal `[y/N]` over the printed plan or in the
native app's run planner. It is not a credential, a digest, or a token — it is the operator
saying yes to a plan they can see.

### D2 — Five verbs

```
quirks task propose | list | show | block | claim | complete | release
quirks run QK-A QK-B --name "native app"     → prints plan → [y/N] → executes
quirks status                                 → what is happening now
quirks report <run-id|slug>                   → what happened
quirks harness                                → is each harness working
```

`quirks report` **requires a run id or its slug.** There is no `last-night` shorthand: "last
night" is ambiguous the moment two runs overlap, and `quirks status` already names the recent
ones. A run's `--name` yields the slug, so `quirks report native-app` works.

Task status changes are **direct verbs with flags**, not schema-conforming request files. The
measured cost of the current path — parking one task on 2026-07-27 — was five steps: read
`nativeRevision` from a `--json` show, hand-author a request against a six-field schema with a
nested two-field `input`, place that file inside the repository to satisfy a path policy, pass
it via `--request-file`, then delete it. The replacement is:

```
quirks task block QK-UI-008 --reason "…" --until "…"
```

The revision check, idempotency key, and intent record stay — the CLI derives them. They were
never the operator's job.

The plan printed before `[y/N]` shows: the task set, execution order, the harness and model
chosen per task, and an estimated cost. That is the whole approval surface.

`quirks run --resume <name|id>` continues an interrupted run (D4).

### D3 — Failure policy: continue, block dependents, lead the report with it

A task failing at 3am does not end the run. Tasks that do not depend on it keep going; tasks
that do are marked `blocked`; the morning report leads with what failed and **quotes what the
runner actually said**.

Rejected: halt-on-first-failure. Safer, and it wastes the night — which is the opposite of
what overnight running is for.

### D4 — The run is the unit of resumability

Host dies, laptop sleeps, quota runs out: `quirks run --resume "native app"` picks up where it
stopped. No resume-candidate probing, no attach ceremony, no separate verb — the same command
with a flag.

### D5 — TDD is dropped as a requirement

The blanket "use TDD for behavior changes" rule is removed from the doctrine. It is a personal
tool; the bar was costing more than it returned.

Testing is kept where a silent regression costs a night's work, and nowhere else:

- **`runner`** — the honesty properties. A regression here makes every report a lie. Its
  existing suite stays and is the one place a new behavior still gets a test first.
- **`provenance`** — currently the worst-covered area and about to carry problem B. It gains
  coverage rather than losing it.
- **Everywhere else** — tests when they earn their place, not by rule.

The ~6,000 lines of `campaign` ceremony tests are deleted with the ceremony they cover. The
~7,900 lines of `ui` tests are deleted with the React UI.

### D6 — Preflight survives as a workspace, not as a gate

The old preflight was a digest to rubber-stamp. The replacement is a **run planner**: a run
that exists but has not executed, where the operator can

- review every task the run will perform,
- reorder execution and configure lanes,
- add per-task notes and detail comments that reach the agent's brief,
- launch a brainstorm for one task before committing the run,
- then approve and start.

What dies is approval-as-gate. What survives is planning-as-workspace, because the operator
actually does something in it.

### D7 — Harness and model tables surface state that already exists

Two views, both built on data the system already computes and never shows:

**Harness availability.** Whether `claude`, `codex`, and `cursor` are each present, authorized,
and answering — a sanity check before an overnight run leans on them. `hosts/{claude,codex,
cursor}/discover.mjs` already probe this. `RoutableProfile` already carries `healthy` and
`remainingAllocation`.

**Model and tier table.** Which model and effort each judgment tier resolves to
(`mechanical → standard → high → principal`), and therefore what an overnight run will dispatch
to. `requiredTierForRole` already decides this; it is simply invisible today.

Both are live in the native app and available as `quirks harness`. This also retires a real
smell: `CLAUDE.md` currently carries *"codex is usage-limited until Jul 28 2026 2:02 PM"* as
prose in a checked-in document. Quota state belongs in a table that refreshes, not in doctrine.

## The execution model

Adapted from the pattern in `~/code/game/pilot/.claude/skills/overnight-orchestration`, which
the owner named as the behavior to reproduce with Quirks' CLI.

### D11 — One parent agent per task, live and in control

Every task gets its own parent agent, spawned on the harness that task runs on. It is not a
post-hoc reader; it is in charge for the duration:

```
quirks run QK-A QK-B --name "native app" --mode autonomous
  │
  └── per task, one PARENT AGENT on the task's harness
        ├── reads the brief
        ├── quirks task claim <id>
        ├── dispatches the implementer through the CLI
        ├── watches output; handles issues as they arise
        ├── if the task carries review:
        │     quirks review <id> --model <different-model>
        │         → a reviewer on a DIFFERENT model, dispatched BY the parent
        ├── writes a continuation brief into the same worktree on an honest partial
        └── quirks task complete <id> --evidence …   (verdict quote-verified)
```

The parent never reviews its own task's work. When review is part of completion, the parent
**dispatches** a reviewer on a different model through the CLI. Quirks keeps two agents where
the judge never touched the code — Pilot's single-reviewer shape is rejected here.

The continuation-brief behavior is taken directly from Pilot and is the highest-value part of
it: on an honest partial, the parent writes what exists, numbers the remaining scope, and
states "do not redo groundwork" — into the **same worktree**, so the next attempt resumes
rather than restarts.

### D12 — Quirks adds no restrictions to the agents it launches

The managing agent's `--tools ""`, no-MCP, no-settings, no-skills launch is removed. Agents get
their normal environment.

This reverses a documented property, so the reasoning is recorded rather than assumed:

- **It was right for the old role and is incoherent for the new one.** A read-only transcript
  reader needs no tools. A parent that drives the CLI, spawns reviewers, and writes
  continuations cannot function without them.
- **It costs ~30×.** `AGENTS.md` measured $0.0049 restricted against $0.145 a call
  unrestricted. That is real and it belongs in the plan the run prints before `[y/N]`, not
  hidden.
- **The honesty property does not depend on it.** "Read-only is mechanical rather than
  promised" was belt-and-braces over a check that already carries the weight: a verdict must
  quote the runner's own words, and **Quirks verifies that quote against the retained
  transcript in its own code**. An agent with every tool in the world still cannot fabricate an
  accept, because the quote check does not ask the agent's permission.

What is explicitly NOT relaxed: quote verification, absence failing closed to `indeterminate`,
and always-retained transcripts. Those are the product.

### D13 — Autonomy is a run mode, not a global rule

Chosen per run at `quirks run` time, because an unattended overnight sweep and a supervised
afternoon run want opposite defaults:

| Mode | Behavior on something needing judgment |
|---|---|
| `--mode autonomous` | The parent decides and continues. Nothing waits for a human. |
| `--mode park-on-issue` | The parent stops that task, records why, and leaves it for the operator. Other tasks continue. |

`park-on-issue` uses Pilot's phase boundary, which is worth stealing verbatim: **before a
landing commit exists, a failure releases the work; once a verified landing commit exists, a
failure holds it for the operator and never unassigns verified work.** Losing a night's
finished work to an automatic release is worse than parking it.

## What is deleted

Digest-bound envelopes · preflight-as-a-separate-command · approval tokens and the vault ·
the capability model · leases · claims · circuit breakers · per-invocation budgets ·
resume-candidate/attach ceremony · the TDD requirement · ~6,000 lines of campaign ceremony
tests · the word "campaign".

## What grows

`src/provenance/` — from the worst-covered area in the repository to the foundation of both
`quirks report` and the native run view. Problem B has been the underserved half of this
product since the beginning; this is the correction.

## Native app views (revised)

| View | Purpose |
|---|---|
| **Tasks** | The backlog. Problem A: structure intent. |
| **Run planner** | A run being shaped — order, lanes, notes, brainstorm — then approved (D6). |
| **Runs** | Every run, live and past. |
| **Run detail** | One run, live *and* retrospective. The morning report. |
| **Harnesses & models** | Availability sanity check and the tier/model table (D7). |

## Amendments to the native app and service split design

That spec (`2026-07-27-native-app-and-service-split-design.md`) stands except where it now
disagrees:

1. **D8's "the CLI's command surface is frozen" is withdrawn.** It was written to protect the
   skills from D4's rewrite. The surface is now deliberately redesigned to five verbs, so the
   skills change with it — all six, not the two that section named. `pnpm validate:skills`
   remains the gate.
2. **The Preflight view is not retired.** It becomes the run planner (D6 above).
3. **The view list is replaced** by the table above. QK-NAT-006 covers the new set.
4. **QK-SRV-005 ("campaign approval end-to-end")** collapses into the run planner's approve
   action. There is no separate approval subsystem to build.
5. **D7 (mode-0600 token) is unchanged** and is now the only client credential in the product.

## Risks and honest unknowns

- **Deleting 42% of the source files' concerns is a large, wide change.** It should land as
  several reviewable commits, not one. The runner and provenance layers must not be touched in
  the same commits as the ceremony removal.
- **`supervisor.ts` gets smaller because judgment moves to the parent agents.** 971 lines today,
  with scheduling entangled in claims and budgets. The guards leave, and most of what looks like
  supervision becomes the parent agent's job (D11). What remains is a scheduler with one
  sentence of purpose: run these tasks in dependency order across available harnesses, keep
  going when one fails, and record what happened. Do it carefully and let the agent doing the
  work use its judgment — this does not need a ceremony of its own.
- **Dropping TDD is easy to over-apply.** The rule being removed is the blanket one. If runner
  or provenance regressions start appearing, that is the signal it was cut too far.
- **The rewrite can reintroduce every bug the audit found.** Deleting the code that holds a
  defect also deletes the test that would have caught its return. The named defects are
  bare-`catch`-swallows-distinction and success-reported-before-it-is-durable; both are easy to
  write fresh in new code and neither announces itself. Every declined in-place fix must carry
  an acceptance criterion onto its replacement (see step 0b), and that is the only mechanism
  proposed here — there is no reviewer gate behind it.
- **`quirks report` has no design yet.** It is named here as the answer to problem B, but what
  it prints — and how it summarizes a night of transcripts without becoming a wall of text — is
  undesigned and is the next thing that needs a real answer.

## Implementation order

0. **QK-RUN-012 first — its code survives the reboot.** `src/runner/watchdog.ts` carries **zero**
   mentions of envelope, approval, digest, budget, or capability; it is process monitoring, and
   the reboot makes it more central, not less. Both defects are bare `catch` blocks collapsing
   distinct failures into a benign default — `processAlive` reporting an `EPERM` probe as a dead
   process, and `loadStore` returning an empty registry for a corrupt or unreadable one. Roughly
   twelve lines, in code that stays. Fix them now.

0b. **QK-CTL-012 splits — do not fix it in place.**
   - Its **budget and retry accounting** half is deleted, not fixed: budgets go with the
     permission layer, and repairing double-counting in code being removed is waste.
   - Its **durable completion** half is a *requirement of the new supervisor*, not a repair of
     the old one. `supervisor.ts` is being rewritten; fixing and then rewriting is doing the work
     twice. Lift its acceptance criterion verbatim into QK-RBT-002's: *"A run reported as
     completed has actually transitioned its tasks and its campaign, or it is not reported as
     completed."*

   **Carrying a bug class across a rewrite is a test, not vigilance.** "Be on the lookout" does
   not survive a long night of implementation. Every defect this spec declines to fix in place
   must land as an acceptance criterion on the component that replaces it — otherwise the
   rewrite reintroduces it and the audit that found it is wasted.
1. **QK-RBT-002 — the run model.** Rename campaign to run; collapse preflight/approve/start
   into `quirks run`. Add the task-status verbs and close QK-RUN-007/008/009, which cannot be
   closed today: `complete` from `proposed` returns a conflict, and `claim` wants a campaign.
2. **QK-RBT-003 — delete the permission layer.** Envelopes, digests, tokens, capabilities,
   leases, claims, circuit breakers, budgets, and their tests. Separate commits per concern.
3. **QK-RBT-004 — failure policy and resume.** D3 and D4.
4. **QK-RBT-005 — `quirks report`.** Design it first; it is the answer to problem B and it is
   currently a name without a shape.
5. **QK-RBT-006 — harness and model tables.** `quirks harness`, backed by the existing
   discover scripts and routing.
6. **QK-RBT-007 — doctrine.** Rewrite `CLAUDE.md`/`AGENTS.md`: drop the TDD requirement, the
   capability language, the approval ceremony, and the hardcoded quota prose. Rewrite all six
   skills against the five-verb CLI.

Steps 1 and 2 are the ones that need care; the rest are additive.
