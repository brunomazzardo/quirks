# Handoff — the Quirks reboot, continuing at 0a.3

Written 2026-07-27 at commit `e0f22ef` on `main`. Nothing is pushed to any remote.

## What Quirks is being rebuilt into, and why

Quirks exists for two problems:

- **A.** Structure what you want built on a large project, without losing intent.
- **B.** Let agents run overnight, then understand what happened and what went wrong.

It grew a third job nobody asked for — guarding the operator against themselves — and by
2026-07-27 that job outweighed both real ones. The audit that opened the reboot:

| | |
|---|---:|
| Commands to run one task | **6** + a browser round-trip |
| `envelope`/`approval`/`digest` mentions in `src/` | **1,274** |
| Source files touching them | **60 of 144 (42%)** |
| `ui` test-to-source ratio | 2.5 : 1 |
| `campaign` test-to-source ratio | 2.2 : 1 |
| **`provenance`** test-to-source ratio | **0.57 : 1** — the worst, and the only thing serving problem B |

**The line the whole reboot rests on:**

> **Honesty machinery is code. Permission machinery is deleted. Judgment lives in skills.**

- *Honesty* — a verdict must quote the runner's own words, verified against the retained
  transcript; absence fails closed to `indeterminate`; transcripts always retained. **Kept and
  invested in.** This is what makes a morning report trustworthy.
- *Permission* — envelopes, digests, approval tokens, capabilities, leases, claims, circuit
  breakers, per-invocation budgets. **Deleted.** Two of them the repository already admits do
  not work: capabilities are "not an enforcement boundary", budgets "reset every invocation".
- *Judgment* — source-conflict resolution, precedence, scope, breakdown. **Skills, not code.**
  A skill can be ignored where a gate cannot; that trade is accepted deliberately, and the
  answer to it proving too loose is a better skill, not a new gate.

## The model

**goal → task → run.** What I am trying to achieve, what needs doing, when agents did it.

- **Goal** — the object above a task. Its id *is* the existing task-id prefix (`QK-SRV-003` →
  `QK-SRV`), so there was nothing to migrate. Carries `why`, `doneWhen`, and an asserted state
  (`active`/`done`/`abandoned`, the latter two requiring a reason). **Never executable** — the
  moment you can "run a goal" it collapses into a run and long-lived intent is lost again.
- **Task** — a unit of work. Never approved. Can be flagged `needs design` (we don't know what
  to build) or `needs breakdown` (we know, it's too big) — both route to an interactive flow
  with the operator.
- **Run** — a named parent grouping tasks: a feature. **The only thing approved**, once, over a
  plan you can read.

**The five verbs:**

```
quirks goal list|show|new|done|abandon
quirks task propose|list|show|block|claim|complete|release
quirks run QK-A QK-B --name "…" [--goal X] [--mode autonomous|park-on-issue] [--yes]
quirks status
quirks report <run-id|slug>
quirks harness
```

**Interactivity is drawn by path:** goal creation may converse (a human is there; flags keep it
headless). **The execution path never does** — agents run it, and a prompt is a hung overnight
run. `quirks run`'s `[y/N]` therefore takes `--yes`, and an agent passing it exercises the
operator's delegation rather than approving on its own authority.

## Read these first

| | |
|---|---|
| `docs/superpowers/DECISIONS.md` | **Start here.** All 33 decisions, where each is recorded, whether it has become work. |
| `docs/superpowers/specs/2026-07-27-runs-not-campaigns-design.md` | The reboot: runs, goals, the brief, the report, the execution model |
| `docs/superpowers/specs/2026-07-27-native-app-and-service-split-design.md` | The native app and the Bun service/CLI |
| `docs/superpowers/plans/superseded/README.md` | What was retired and what replaced it |
| `~/code/game/pilot/.claude/skills/overnight-orchestration` | The behavior the owner named as the target |
| `~/code/game/pilot/.claude/skills/overnight-issue-worker` | Its gate sequence, PARTIAL definition, phase boundary |

## Sequencing — the native app is LAST

```
0a.1  quirks goal list|show, derived from ids                       DONE  305a17d
0a.2  goals through TaskSource, metadata, new|done|abandon          DONE  e0f22ef
0a.3  non-interactive task propose (flags, not request files)       ← NEXT
      + task/goal createdAt/updatedAt
0a.4  the brainstorm skill (interactive; ends in goals + tasks)
0     QK-RUN-012 — its code survives the reboot; ~12 lines
0b    QK-CTL-012 split — budget half deleted, durable-completion
      half becomes an acceptance criterion on the new supervisor
1     run model; delete the permission layer
2+    failure/resume, quirks report, harness tables, doctrine+skills
last  the native app
```

The owner accepted the native app last **provided a stable CLI, server, and skills
foundation** — that condition is the reason for this order.

## What is built

- `src/goals/read-model.ts` — goals derived from task-id prefixes; no schema change.
- `src/cli/quirks.ts` — the unified binary the five verbs collapse into. `task`, `run`,
  `status`, `report` migrate in here; `quirks-tasks`/`-campaign`/`-watchdog` stay until they do.
- `src/task-source/json/json-goal-mutations.ts` + four `TaskSource` operations
  (`list-goals`, `show-goal`, `propose-goal`, `update-goal`). Capabilities cap raised 16 → 32.
- Two real goals exist: `QK-RBT` (Runs, not campaigns) and `QK-NAT` (Native app and service
  split), both with `why` pointing at their spec and `doneWhen` criteria.

885 tests pass; lint and typecheck clean.

## Gotchas found by doing, not reading

- **`complete` from `proposed` returns a conflict**, and `claim` wants a campaign. So
  `QK-RUN-007/008/009` are merged to `main` and stuck at `proposed` — there is genuinely no
  path to close work done outside a campaign. 0a.3 must fix this.
- **No mutation reaches `cancelled`.** It is a valid status in fourteen schemas with no verb
  behind it. `QK-RUN-011` is therefore *blocked-as-superseded* rather than cancelled.
- **Setting one task to `blocked` takes five steps** — read `nativeRevision` from a `--json`
  show, hand-author a request against a six-field schema with a nested two-field input, place
  it inside the repository to satisfy a path policy, pass `--request-file`, delete it. This is
  what 0a.3 replaces.
- **Tasks carry no timestamp at all**, and one commit date covers all 138 in `tasks.json`.
  D17's recency-based precedence is inert until `createdAt`/`updatedAt` exist. Make them
  optional so the existing ledger stays valid.
- **A failed mutation leaves a durable conflict counter with no verb to clear it.**
- **Deriving `goal list` from tasks alone hid goals that had no tasks yet** — the intent-loss
  failure reproduced inside its own fix. The rollup is now a union; keep it that way.

## Open, not yet decided

Migration (138 tasks, 4 campaigns, campaign→run) · harness liveness refresh (today it is prose
in `AGENTS.md` with a hardcoded date) · MCP · whether a run can span repositories · push and
remote strategy · whether `--yes` should distinguish operator delegation from an agent deciding.

## Working agreements

- **Brainstorm with the operator, do not delegate it.** Delegated brainstorming is only for
  agent flows with no human guiding.
- Explain, recommend, ask one question in prose. Option menus get declined.
- Voice transcription garbles technical terms — read the architecture back before building on it.
- Nothing is pushed to any remote. That gate is the owner's.
