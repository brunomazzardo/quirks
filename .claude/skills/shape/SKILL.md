---
name: shape
description: Shape intent into Quirks' ledger — use when the operator wants to turn an idea into goals and tasks, refine or grow an existing goal, or split something complex into several goals. Interactive, with the operator, ends in recorded goals and tasks via the quirks CLI — never a plan document. Not for executing tasks or reading runs.
---

# Shape — intent becomes goals and tasks

You are shaping what the operator wants built, **with the operator**, into Quirks'
ledger. The conversation is the tool; the ledger is the artifact. Nothing the session
decides may live only in prose — that is the intent loss this product exists to prevent.

**Terminal state: goals and tasks recorded through the `quirks` CLI.** Never a plan
document. If you feel the pull to write one, the content belongs on the tasks
themselves — deliverables, acceptance criteria, verification, `dependsOn`.

## How to converse

- One question at a time, in prose. Explain, then recommend.
- **Lead with a direction** — your single recommended answer and why. Never lay out
  2/3/4 options across a question; an alternative gets one sentence, only when it is
  genuinely live, and the recommendation still comes first.
- The operator's voice transcription garbles technical terms. Read names and
  architecture back before building on them.
- Refine purpose, constraints, and done-criteria — not implementation. Implementation
  belongs to the agent that claims the task.

## The flow

### 1. Orient

Before the first question:

- `pnpm quirks goal list` and `pnpm quirks task list` — the declared state.
- Read what the conversation points at: the README, `docs/`, an existing goal's why-ref.

Place the session as one of:

- **new intent** — ends in `goal new` plus tasks under it
- **growth** — "more under QK-X", "refine QK-X" — tasks under the existing goal
- **split** — too big for one goal — several goals, each with its own why

Read the placement back and get it confirmed before going deeper.

### 2. Converse

Ask until you can state without guessing: why this matters (the `why`), what done
means (`doneWhen` — asserted criteria, never "all tasks completed"), what the pieces
of work are, and their order (`dependsOn`).

### 3. Flags: ask, don't impose

When a piece of work turns out not yet knowable, or clearly too big as one task,
say so and ask one question — **flag it and move on (the default), or dig in now?**
The operator decides per task.

- We don't know *what* to build → `--needs-design`
- We know what, it's too big as one task → `--needs-breakdown`

A flagged task still records everything the session did learn. The design and
breakdown skills own the follow-up conversations; do not become them mid-session.

### 4. Spec when it earns it

A small goal needs `--why "one sentence"` and `--why-ref <existing doc>`. Only when
the why outgrows a sentence plus pointers to sources that already exist: write a spec
to `docs/specs/` and point `--why-ref` at it. Never copy a body into the ledger.

### 5. Record

All headless — flags in, JSON out:

```
pnpm -s quirks goal new QK-XYZ --title "…" --why "…" --why-ref docs/specs/xyz.md \
  --done-when "criterion" --done-when "another criterion"

pnpm -s quirks task propose --goal QK-XYZ --title "…" \
  --deliverable "…" --criterion "…" --verify "command" \
  --source docs/… --depends-on QK-XYZ-001 \
  [--needs-design | --needs-breakdown] [--effort "…"] [--risk "…"]
```

- Propose in dependency order — a dependency must exist before it is referenced.
- Pin every document the task rests on with `--source`; the pin is the baseline that
  makes "this changed" computable later.
- Growing a goal: skip `goal new`. Touch the goal's `doneWhen` only with the
  operator's explicit say-so — and note there is no goal-edit verb yet: surface the
  change to the operator rather than hand-editing `.quirks/goals.json`.
- A goal-less chore: omit `--goal`; the id mints bare (`QK-014`).

### 5b. The companion, when seeing beats reading

A browser surface is available for moments a question is clearer shown than told — a
proposed goal/task tree before recording, two decompositions side by side, an
architecture sketch. Read `companion.md` in this skill's directory before first use.
Offer it just-in-time (its own message, first visual-worthy question, never upfront);
decide per question — conceptual and scope questions stay in the terminal; and every
choices screen leads with the recommended option marked, never a flat menu. The
terminal stays primary: the operator always answers there.

### 6. Read back and close

Show the operator `pnpm quirks goal show QK-XYZ` (or `pnpm quirks task list --goal …`) and walk
through what got recorded. If anything the session decided is not visible there,
it is not recorded — fix that before ending the session.
