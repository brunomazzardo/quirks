# Runs, not campaigns — removing the permission layer (QK-RBT-001)

Status: proposed, owner-directed (Bruno, 2026-07-27). Revises parts of
`specs/native-app-and-service.md` — see "Amendments" at the end.

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
quirks goal list | show | new | done | abandon
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
and answering — a sanity check before an overnight run leans on them.

> **Corrected 2026-07-28 while building `QK-HARN-001`.** This paragraph originally claimed
> `hosts/{claude,codex,cursor}/discover.mjs` "already probe this" and that `RoutableProfile`
> "already carries `healthy` and `remainingAllocation`". Both were wrong, and each sent the
> port at the wrong file:
> - Those three `discover.mjs` files are **skill-id discovery** (`discoverClaudeSkills({layoutRoot})`
>   and siblings). They contain no availability probe. v1's real probes were in
>   **`src/smoke/host-runner.ts`** — `resolveExecutable` (PATH + `~/.local/bin` + `~/bin`, `X_OK`)
>   and `probeVersion` (`--version`, first line). `probeVersion` ended in
>   `catch { return "unknown" }`, collapsing not-found, `EACCES`, non-zero exit, and a hung
>   binary into one benign string — the carried-defect class in `DECISIONS.md`, so it was
>   **rewritten rather than ported**.
> - `RoutableProfile` carried those two *fields*, but nothing ever computed them: they were read
>   from a hand-written `~/.config/quirks/profiles.json`. Refreshing quota state was aspiration,
>   not existing code — which is why "where liveness comes from" was still an open question here.
>
> v1 source is only on the **`origin/v1`** branch of `~/code/quirks` (`git show origin/v1:<path>`);
> that checkout's working tree is post-reboot and nearly empty.

**Model and tier table.** Which model and effort each judgment tier resolves to
(`mechanical → standard → high → principal`), and therefore what an overnight run will dispatch
to. `requiredTierForRole` already decides this; it is simply invisible today.

> **Also corrected.** `requiredTierForRole` (v1 `src/campaign/routing.ts`) decides the *tier*,
> not the model — no tier→model table existed anywhere in v1. Real per-runner model ids came from
> `docs/evidence/runner-boundary-probe.md`, not from source. The independence rule worth porting
> alongside it is `deriveModelFamily` / `selectIndependentReviewer` (v1
> `src/prompt/model-selection.ts`), which refuses to label a same-family fallback independent.

Both are live in the native app and available as `quirks harness`. This also retires a real
smell: v1's `CLAUDE.md` carried *"codex is usage-limited until Jul 28 2026 2:02 PM"* as prose in a
checked-in document. Quota state belongs in a table that refreshes, not in doctrine.

**Resolved 2026-07-28 (`QK-HARN-001`):** liveness is **derived from the run record, never a live
probe** — each dispatch persists its runner, model, timestamp, exit code, and the runner's own
failure text, so the newest dispatch per runner *is* the answer and a quota refusal arrives dated.
`quirks harness --probe` is the explicit opt-in for a real `--version` round trip.

## The intent model

Problem A got one line in the first draft of this spec — "a unit of work with intent captured"
— while problem B got an execution model. This is the correction.

### D15 — A goal is the object above a task, and it already exists

The task schema has **no** grouping field: `id, title, kind, priority, status, source,
nativeRevision, dependsOn, workflow, execution, sourceRefs, deliverables, acceptanceCriteria,
verification, provenance, coordination, statusDetail`. No epic, no feature, no parent.

So one grew anyway. 138 tasks carry **20 distinct id prefixes** — `QK-HOST` (22), `QK-UI` (20),
`QK-CTL` (18), `QK-RUN` (15), `QK-FND` (13) — doing the schema's job in a naming convention.
`QK-SRV-001` is titled like an epic ("Always-on local workspace server with stable address")
and sits as a flat peer of `QK-SRV-002` through `007`.

**The prefix becomes the goal id.** Formalize what is already there rather than inventing a
parallel scheme: `QK-SRV-003` belongs to goal `QK-SRV`. Migration for 138 existing tasks is
nothing — the grouping is already encoded in every id.

```
Goal
  id         QK-SRV                    ← the existing prefix
  title      Always-on local workspace server
  why        one sentence + a sourceRef to the spec (never a copied body)
  doneWhen   explicit criteria — NOT "every task is completed"
  tasks      derived: every task whose id carries this prefix
  state      derived from members, except `done` and `abandoned`
```

Three properties that make it answer "I lost track of what I wanted to build":

- **`doneWhen` is asserted, not derived.** Every member task can be `completed` while the thing
  is not built. A goal reaches `done` when its criteria are met, and that is a judgment
  someone records — the one place in this design where "all the parts finished" is not accepted
  as evidence the whole finished.
- **`abandoned` is a real state with a reason.** Today a direction you dropped leaves its tasks
  sitting `ready` forever — `QK-ADP` has five tasks and zero done, `QK-SRV` has seven and zero
  done. Nothing distinguishes "not yet" from "not any more", so the backlog quietly lies.
  Abandoning a goal is how you stop lying to yourself, and it is cheap to reverse.
- **A goal outlives its runs.** Goals are months of intent; runs are one night of execution. One
  goal produces many runs. **A goal is never executable** — the moment you can "run a goal", it
  collapses into a run and the long-lived intent is lost again, which is the failure this
  object exists to prevent.

### D16 — `quirks goal`, and runs created from goals

```
quirks goal list                       → the rollup below
quirks goal show QK-SRV                → why, doneWhen, member tasks, state
quirks goal new QK-NAT --title "…" --why docs/…/design.md
quirks goal done QK-SRV                → asserts doneWhen is met
quirks goal abandon QK-ADP --reason "…"

quirks run --goal QK-SRV --name "server work"
```

That last line is the payoff. `quirks run QK-A QK-B` assumes you can find the right eight ids
among 138 across 20 prefixes; `--goal` takes every ready task in the goal, in dependency order.

`quirks goal list` is the instrument against intent loss, and it needs no new data — this is
the repository's real state today, computed from existing ids and statuses:

```
goal         total  done  open  blocked   state
QK-HOST         22    13     9        5   in progress
QK-UI           20    12     8        1   in progress
QK-RUN          15     8     7        1   in progress
QK-SRV           7     0     7        0   not started      ← planned, never begun
QK-CTL          18    13     5        0   in progress
QK-ADP           5     0     5        0   not started      ← planned, never begun
QK-GIT           6     4     2        0   in progress
QK-RELEASE       1     0     1        1   not started
… 12 complete goals omitted
```

No command produces this today. Twelve tasks across two goals were planned and never started,
and nothing in the product says so.

The native app's Tasks view groups by goal, which is the same structure made visible rather
than a second one.

**Naming.** `goal` is chosen over `epic` (agile freight), `feature` (a runner repair is not
one), and `workstream` — which `AGENTS.md` already uses in prose and remains the honest
alternative if the longer word reads better. The system is then **goal → task → run**: what I
am trying to achieve, what needs doing, and when agents did it.

### D18 — Where tasks come from: a skill brainstorms, the CLI records

The flow collapses from four artifacts to two.

```
before   idea → brainstorm → spec → PLAN → tasks
after    idea → brainstorm SKILL (interactive, with the operator)
              → spec  →  quirks goal new  →  quirks task propose ×N
```

#### Nothing on the execution path is interactive

**Agents run this CLI, and an interactive prompt is a hung overnight run.** The rule is drawn
by path, not by command:

- **The execution path is never interactive.** `run`, `status`, `report`, and every `task`
  verb work headless — flags and files in, JSON out, no question they wait on. A task
  executing inside a run must never be able to block on a human.
- **Goal creation may converse.** `quirks goal new` run bare by a human can ask; given flags it
  is fully headless, so the brainstorm skill can call it. Interactive when a human is there,
  silent when one is not — the `npm init` / `npm init -y` shape.

The CLI is **agent-first in goal, scope, and shape** — a human using it directly is the
secondary case, not the design centre.

So the interactivity lives where a human already is: **in the skill**, running inside a session.
The skill asks the questions, writes the spec, and then calls the CLI to record the outcome —
`quirks goal new --title … --why <spec-path>`, then `quirks task propose` per task. No new
top-level verb: `goal new` is the recording step, not a conversation.

This has one consequence the spec must not gloss: **`quirks run`'s `[y/N]` is itself
interactive.** An agent dispatching a run would hang on it. It takes `--yes`, and an agent
passing `--yes` is exercising the operator's delegation, not approving on its own authority —
the approval happened when the operator said to run it, or in the run planner.

**The plan document goes.** It numbered work that tasks already carry — `deliverables`,
`acceptanceCriteria`, `verification`, `dependsOn` — written twice in two places that then
drift, which is why `sourceRefs` pins a plan commit in the first place. The ledger becomes the
plan.

The evidence that this was already happening: the two most recent per-task plans are **38 and
28 lines**, against 1,537 and 2,037 for the founding ones. Nobody decided to stop writing
plans; they became stubs because the tasks carried the content.

**Quirks owns its own brainstorm.** Superpowers' brainstorming skill states its terminal
state as *"The ONLY skill you invoke after brainstorming is writing-plans"* — it is hardwired
to end in a plan document. Ours ends in **tasks**: it asks the questions, writes the spec,
creates the goal with that spec as its `why`, and derives the tasks under it.

**The task schema stops being Superpowers'.** `workflow.family` is `"const": "superpowers"`
today and `workflow.phase` includes `plan`. Both change: Quirks owns the family, and `plan`
leaves the phase list.

#### Two flags and one behavior — three different things

| | What it means | Who acts |
|---|---|---|
| **needs design** | We do not yet know *what* to build. | Routes to the design skill, with the operator. |
| **needs breakdown** | We know what, but it is too big as one task. | Routes to the breakdown flow, with the operator. |
| *(agent subtasks)* | The agent finds the work is bigger than it looked, mid-execution. | The agent, alone. No flag. |

Both flags may be set by the agent while deriving tasks from a spec, or by the operator by hand.
`workflow.designGate` already exists for the first; the second is new.

The third is deliberately **not** a flag and deliberately **not** ledger tasks. An agent that
created real tasks mid-run would turn a run you approved for eight into fourteen while you
slept, and "approve the plan you can see" would quietly stop being true. Instead the breakdown
is **internal but structured** — recorded in the run record in a shape `quirks report` renders,
so the morning view can show that the agent split a task, into what, and how each part went.
The execution skill tells the agent it has this freedom and how to record it.

#### Skills Quirks must own

These carry discipline that used to be code (D17), so they are deliverables, not documentation:

- **brainstorm** — interactive question-asking that ends in a spec, not a plan.
- **design** — the `needs design` flow.
- **breakdown** — the `needs breakdown` flow.
- **execution** — how an agent organizes a large task and records its internal subtasks.
- plus the source-conflict and scope skills D17 depends on.

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

### D17 — The brief: the CLI supplies facts, skills supply judgment

The brief is how intent reaches the agent — the join between problem A and problem B. It is
split along one line, and that line is the whole design:

> **The CLI supplies verifiable facts. Skills supply judgment. Only honesty properties get code.**

The previous product encoded its discipline as code — envelopes, digests, gates — and that
became the bloat this spec removes. The discipline here is real and stays; it lives in skills
and prompts the agents read, not in enforcement machinery.

**What the CLI assembles** (deterministic, testable, reproducible — every item verifiable):

```
task        id, title, goal, deliverables, acceptanceCriteria, verification,
            dependsOn, effort, risk, nativeRevision
goal        title, why, doneWhen
git         base commit, candidate commit, worktree path
sources     each sourceRef with BOTH its pinned commit and current HEAD,
            the diff between them, and the last-changed date of each
operator    per-task notes written in the run planner
skills      the instruction set, plus computeInstructionsHash — so a report can
            say exactly which instructions the agent held
```

**What the skill governs** (judgment, no code behind it):

- Reading the pin→HEAD diff and deciding whether it invalidates anything the task asks for.
- Resolving conflicts between sources.
- Scope: which files are in, which are explicitly out.
- When to stop and surface something rather than decide.

#### Precedence is recency, and it is a default rather than a rule

The most recently changed source wins. It self-maintains, needs no curated ladder, and on the
repository's real dates it orders correctly where a fixed ladder does not:

```
2026-07-27 11:57  runs-not-campaigns spec   "the browser client is deleted"
2026-07-27 11:25  the task                  "build esbuild watch"
2026-07-25 01:15  AGENTS.md                 "browser stack ratified"    ← stalest, loses
2026-07-23 18:00  the spec at the pin       (what the task was written against)
```

Pilot's fixed ladder puts repository instructions on top, which here would elevate the stalest
source. Recency gets it right.

**Prerequisite: tasks must carry timestamps.** The task schema has no date field at all, and
`.quirks/tasks.json` holds one commit date for 138 tasks — parking a single task makes the whole
ledger look freshly changed. `createdAt`/`updatedAt` per task, and the same on goals, must land
before recency means anything.

#### The escalation, and why the judgment pass finds conflicts rather than only settling them

Ordering only helps once a conflict is known. In the worked example the diff shows a
supersession header was added to a spec; concluding *"therefore this deliverable is moot"* is
inference, not diffing — nothing in the text links that header to esbuild watch. So detection is
itself the judgment pass.

```
1. supervisor      diffs pin → HEAD; something moved
2. judgment pass   a higher-tier model, holding the conflict skill:
                   does this change invalidate anything I was told to do?
3. recency         orders whatever it flagged as conflicting
4. the operator     only when the judgment pass cannot call it
```

Step 2 uses the tier ladder that already exists (`requiredTierForRole`, `mechanical → standard
→ high → principal`) — the first real consumer of D7's model table.

#### The pin, kept for the reason that is not obvious

`sourceRefs` records the commit a task was written against. Today it is **written and never
read** — `task-brief.ts` renders it, `materialize.ts` writes it, and nothing compares it to
anything. Meanwhile drift detection exists in `circuit-breakers.ts` and `recovery.ts` and points
at *envelopes*, guarding a digest against itself. Drift detection was built for the thing that
did not matter and not for the thing that did — and it is inside the layer being deleted, so
repointing it at sources is not optional.

The pin is not an alternative to reading the current document. **It is the baseline that makes
"this changed" computable at all**: pin as recorded, HEAD as read, the diff as the signal. This
is Pilot's freshness baseline, which records `{id, updated_at}` per source and re-checks before
landing.

#### Links are bidirectional and the reverse side is written, not derived

A task cites its sources through `sourceRefs`. A document carries a written list of the tasks
that cite it, visible when the document is open in an editor rather than only through a query.
**It may go stale, and that is accepted** — a stale list is fixed when noticed, and visibility
where the reader already is beats a guarantee they have to run a command to see.

#### Ground rules the brief always carries

Adapted from Pilot's, where each was learned by losing a night to it:

- **The workspace is already decided** — the task's worktree. Do not ask; begin. Repository
  rules that say "ask the operator" otherwise make an agent stop and wait until morning.
- Read the repository instructions and the goal's `why` before the deliverables.
- Smallest complete change; the task's own commit message; never push.
- Report in the D14 shape — verbatim test tails, not a summary of them.
- Name the ratified contracts this task must extend rather than fork.

#### Dry-run

`quirks run --goal X --dry-run` assembles every brief and prints them without dispatching. The
run planner shows the operator exactly what each agent will read before approval — which is
what makes the planner a workspace rather than a rubber stamp (D6).

### D14 — `quirks report <run-id|slug>`: what needs you, first

The report answers one question — **what needs me now?** — and only then explains the night.
It is ordered by what the operator must act on, never chronologically, because a chronological
log of eight tasks is the wall of text this is meant to replace.

Sections, in this fixed order: **NEEDS YOU** (rejected, and held-after-land) → **PARTIAL** →
**ACCEPTED**. An empty section is omitted. The default output is one screen for a normal night.

```
$ quirks report native-app

native-app · 8 tasks · 00:12 → 06:41 · $4.82

NEEDS YOU (2)
  ✗ QK-SRV-004   rejected · claude/sonnet · 3 attempts
      "I could not make the multi-repo scoping test pass without changing
       the registry contract, which the brief forbids."
      tests: 14 passed, 2 failed (registry-scope.test.ts)
      worktree kept: .worktrees/QK-SRV-004
  ⚠ QK-SRV-007   held after land · post-land verify failed
      landed a1b2c3d — NOT released, verified work stays assigned

PARTIAL (1)
  ◐ QK-SRV-002   2 of 5 criteria · continuation brief written
      done:      bind-or-attach, EADDRINUSE attach
      remaining: rotated logs, launchd, torn-safe reload

ACCEPTED (5)
  ✓ QK-RBT-002   cursor/composer   d4e5f6a   +412 −1,203
  …

  quirks report native-app --task QK-SRV-004     full transcript and diff
```

**Per task, the report carries** — lifted from the Pilot brief contract, which the owner named
as the behavior to reproduce: files changed, the runner's own reasoning, **verbatim test
tails** (not a summary of them), risks, acceptance-criteria mapping, and `git status
--porcelain` for the worktree.

**Three rules that make it trustworthy rather than merely tidy:**

- **Every quoted sentence is quote-verified.** The runner's words in the report are the same
  bytes checked against the retained transcript. The report never paraphrases a verdict.
- **`indeterminate` is its own outcome, printed under NEEDS YOU.** Absence fails closed
  everywhere else in this product; a report that silently omitted an unreadable result would
  be the one place it did not.
- **PARTIAL has the objective definition, not a vibe.** All three of: commits individually
  reviewed as scope-correct; the completed subset passes its stated verification verbatim; and
  an explicit written list of remaining criteria. Failing tests, no commit, or "mostly done" is
  a rejection, not a partial — and gets no partial-credit framing.

**Depth on demand.** Default is the summary above. `--task <id>` gives one task in full —
transcript, diff, every attempt. The native app's run-detail view renders the same data live
during a run and retrospectively after it, so there is one shape, not two.

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
| **Goals** | What you set out to build, and which of it stalled (D15/D16). Problem A. |
| **Tasks** | The backlog, grouped by goal. |
| **Run planner** | A run being shaped — order, lanes, notes, brainstorm — then approved (D6). |
| **Runs** | Every run, live and past. |
| **Run detail** | One run, live *and* retrospective. The morning report. |
| **Harnesses & models** | Availability sanity check and the tier/model table (D7). |

## Amendments to the native app and service split design

That spec (`specs/native-app-and-service.md`) stands except where it now
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
- **Discipline in skills is not enforcement, and that is the deliberate trade.** D17 puts
  source-conflict judgment, precedence, and scope in prompts rather than code. A skill can be
  ignored in a way a gate cannot, and nothing will stop an agent that skips the diff. This is
  the same trade as deleting the capability model, made knowingly: the alternative is the
  ceremony this spec exists to remove. The boundary is fixed — **only honesty properties get
  code** (quote verification, retained transcripts, absence failing closed). Everything else is
  instruction, and if that proves too loose the answer is a better skill, not a new gate.
- **The rewrite can reintroduce every bug the audit found.** Deleting the code that holds a
  defect also deletes the test that would have caught its return. The named defects are
  bare-`catch`-swallows-distinction and success-reported-before-it-is-durable; both are easy to
  write fresh in new code and neither announces itself. Every declined in-place fix must carry
  an acceptance criterion onto its replacement (see step 0b), and that is the only mechanism
  proposed here — there is no reviewer gate behind it.
- **`quirks report`'s shape is designed (D14); its summarization is not proven.** The section
  ordering and per-task contract are settled. What is untested is whether a real eight-task
  night fits one screen without hiding something that mattered — the failure mode is a report
  that reads cleanly and omits the thing you needed. First real overnight run is the test.

## Implementation order

0a. **QK-RBT-001a — the authoring skills, first of everything.** Brainstorm, design, and
   breakdown (D18), plus `quirks goal new` and non-interactive `task propose`. This is the
   bootstrap: until decisions become goals and tasks, every later step is designed in prose
   that nothing tracks — which is the failure this whole product exists to prevent, and which
   this specification is currently an instance of. Build the thing that remembers, first.

0. **QK-RUN-012 — its code survives the reboot.** `src/runner/watchdog.ts` carries **zero**
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
1b. **QK-RBT-002a — goals (D15/D16).** The goal object, `quirks goal`, and `run --goal`. Small,
   independent of the ceremony removal, and the only piece here that serves problem A — which
   is reason enough not to let it queue behind the execution work again.
2. **QK-RBT-003 — delete the permission layer.** Envelopes, digests, tokens, capabilities,
   leases, claims, circuit breakers, budgets, and their tests. Separate commits per concern.
3. **QK-RBT-004 — failure policy and resume.** D3 and D4.
4. **QK-RBT-005 — `quirks report`.** Build D14: section ordering, the per-task contract, and
   `--task` depth, over the provenance record. The native run-detail view renders the same data.
5. **QK-RBT-006 — harness and model tables.** `quirks harness`, backed by the existing
   discover scripts and routing. *(Corrected 2026-07-28: not the discover scripts — see D7 above.
   Shipped as `QK-HARN-001`; the probe was rewritten, and the tier table built from
   `runner-boundary-probe.md` evidence rather than ported.)*
6. **QK-RBT-007 — doctrine and the judgment skills.** Rewrite `CLAUDE.md`/`AGENTS.md`: drop the
   TDD requirement, the capability language, the approval ceremony, and the hardcoded quota
   prose. Rewrite all six skills against the five-verb CLI. **Author the brief skills D17
   depends on** — source-conflict judgment, scope, and the ground rules. These carry the
   discipline that used to be code, so this step is load-bearing rather than cleanup.
7. **QK-RBT-008 — task and goal timestamps.** `createdAt`/`updatedAt` on both. Small, and D17's
   recency ordering is meaningless without it.

Steps 1 and 2 are the ones that need care; the rest are additive.
