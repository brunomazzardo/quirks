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
quirks task propose | list | show
quirks run QK-A QK-B --name "native app"     → prints plan → [y/N] → executes
quirks status                                 → what is happening now
quirks report last-night | <name> | <id>      → what happened
quirks harness                                → is each harness working
```

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
- **Some ceremony may be load-bearing in ways the audit did not see.** `supervisor.ts` is 971
  lines and its wave/lane scheduling is entangled with claims and budgets; separating "what
  schedules work" from "what guards work" is the risky part of this change.
- **Dropping TDD is easy to over-apply.** The rule being removed is the blanket one. If runner
  or provenance regressions start appearing, that is the signal it was cut too far.
- **`quirks report` has no design yet.** It is named here as the answer to problem B, but what
  it prints — and how it summarizes a night of transcripts without becoming a wall of text — is
  undesigned and is the next thing that needs a real answer.

## Implementation order

1. **QK-RBT-002 — the run model.** Rename campaign to run; collapse preflight/approve/start
   into `quirks run`. Ceremony still present but unused.
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
