# Managing-agent runner layer — real-CLI probe, 2026-07-25

Evidence for `QK-RUN-009`. Every configured runner profile is dispatched against
the **real** agent CLI through the production `CliRunnerPort` and the production
`ManagingAgentInterpreter`, and the assertions are on the *body* of the result:
the verdict, the quote behind it, whether that quote is really in the retained
transcript, and whether findings survived.

Reproduce with:

```bash
pnpm build && node scripts/quirks-runner-probe.mjs --concurrency 3 --out report.json
```

Each cell gets a scratch git repository containing a `sum.js` whose loop bound
reads one element past the end. Read-only profiles review it; write-capable
profiles fix it. **No brief states a result-envelope contract** — that is the
whole point of the change.

## What the managing agent costs, measured

Two probes of `claude -p --json-schema` on 2026-07-25, same job, same model:

| Launch | Tools loaded | Input tokens | Cost |
|---|---|---|---|
| Default `claude -p` | `StructuredOutput` + 29 MCP tools, 5 MCP servers, 35 skills, plugins | 23,174 cache-creation | **$0.145** |
| `--tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disable-slash-commands --setting-sources "" --no-session-persistence --system-prompt <brief>` | `StructuredOutput` only | 839 | **$0.0049** |

A default launch inherits whatever the operator happens to have installed —
30× the cost, plus an MCP and plugin surface an interpreting agent has no
business carrying. The minimal launch is what production uses, and disabling
every tool is also what makes the read-only posture mechanical: the agent has no
means to touch the repository, the task ledger, or campaign state.

Interpretation of a real 33 KB reviewer transcript cost **$0.14** — the transcript
dominates, and it is still small beside the job it interprets.

## Run 1 — before the strict envelope paths were deleted (commit `dd6566e`)

Establishes that the agent path carries real traffic, which is the condition the
owner's decision 3 attaches to the deletion.

| Profile | Runner | Model | Role | Status | Verdict | Findings | Quote in transcript | Result |
|---|---|---|---|---|---|---|---|---|
| `personal-claude-sonnet-impl` | claude | sonnet | implementer | success | — | 0 | n/a | **PASS** |
| `personal-claude-opus-review` | claude | opus | reviewer | success | revise | 6 | yes | **PASS** |
| `work-claude-sonnet-impl` | claude | sonnet | implementer | success | — | 0 | n/a | **PASS** |
| `work-claude-opus-review` | claude | opus | reviewer | success | revise | 5 | yes | **PASS** |
| `personal-codex-gpt55-impl` | codex | gpt-5.5 | implementer | failure | — | 0 | n/a | **OWED** — usage limit until Jul 28 2:02 PM |
| `personal-codex-terra-review` | codex | gpt-5.6-terra | reviewer | failure | indeterminate | 0 | no | **OWED** — usage limit until Jul 28 2:02 PM |
| `personal-codex-sol-review` | codex | gpt-5.6-sol | reviewer | failure | indeterminate | 0 | no | **OWED** — usage limit until Jul 28 2:02 PM |
| `personal-cursor-composer-impl` | cursor | composer-2.5 | implementer | timeout | — | 0 | n/a | **FAIL** — 30-minute wall clock, no transcript retained |
| `personal-cursor-grok-review` | cursor | cursor-grok-4.5-high | reviewer | success | revise | 3 | yes | **PASS** |

**5/9 passed, 3 owed, 1 failed.**

### What this run found

**The launcher discarded the transcript of a timed-out run.** The cursor
implementer hit its wall clock and its result carried no transcript at all:
retention happened after the early return for timeout. A killed run is exactly
the one an operator needs to read, and "the raw transcript is always retained"
is the constraint the interpretation layer rests on. Fixed in `4d33d0d`, for
output overflow as well.

The timeout itself was **not** a dispatch defect. Re-probed against the same
profile with a 4-minute bound: cursor read the brief, fixed the loop bound, and
committed `fix: correct the loop bound` in **29 seconds**. Under the fix, a
recurrence would leave a transcript saying where it got stuck.

**Interpretation held on every reachable cell.** Four claude cells and one
cursor cell returned `revise` on a file with a real off-by-one, each quoting the
reviewer's own words, each quote verified present in the retained transcript,
with 3–6 findings carried through. No reviewer returned `accept`, and no
implementer job carried a verdict.

### The negation trap, measured

The committed revise fixture contains a reviewer writing:

> **Revise.** I don't think this should be accepted as it stands.

A keyword scan for "accepted" reads that backwards. Sonnet returned `revise`
against exactly that transcript. This is the case that argues for a model rather
than a parser at this boundary, and it is why the interpreter is sonnet rather
than haiku (owner decision 1).

Note what the quote check did and did not do *at this point*: it verified the
words were present, not that they were read correctly, and a quote lifted out of
a negation would still be found. The independent review took that limitation
apart — see run 3, where lifting was closed and the remaining limits are stated
as they now stand.

## Run 2 — after the deletion (commit `4d33d0d`)

| Profile | Runner | Model | Role | Status | Verdict | Findings | Quote in transcript | Result |
|---|---|---|---|---|---|---|---|---|
| `personal-claude-sonnet-impl` | claude | sonnet | implementer | success | — | 0 | n/a | **PASS** |
| `personal-claude-opus-review` | claude | opus | reviewer | success | revise | 6 | yes | **PASS** |
| `work-claude-sonnet-impl` | claude | sonnet | implementer | success | — | 0 | n/a | **PASS** |
| `work-claude-opus-review` | claude | opus | reviewer | success | revise | 6 | yes | **PASS** |
| `personal-codex-*` (3 profiles) | codex | gpt-5.5 / terra / sol | — | usage_limit | — | 0 | n/a | **OWED** |
| `personal-cursor-composer-impl` | cursor | composer-2.5 | implementer | success | — | 0 | n/a | **PASS** |
| `personal-cursor-grok-review` | cursor | cursor-grok-4.5-high | reviewer | success | revise | 2 | yes | **PASS** |

**6/9 passed** — every reachable cell. The cursor implementer that timed out in
run 1 fixed the defect and committed normally here.

### Model variance in transport status, and what fixed it

The same codex usage-limit transcript came back as `status: "failure"` in run 1
and `status: "usage_limit"` in run 2. Transport classification is a model
judgment now, and `usage_limit` is the one the campaign acts on: it pauses and
retries after the reset instead of spending the next attempt against a quota
that is still out.

The brief now names the specific values and says why they matter. Measured
after that change, against the real codex usage-limit fixture:

| Runs | `status` | `verdict` |
|---|---|---|
| 5 of 5 | `usage_limit` | `indeterminate` |

Worth remembering for anything else delegated to this layer: a model reading a
transcript is not a parser, and its consistency is something to measure rather
than assume.

## Run 3 — after the independent review's Criticals were fixed (commit `9deb268`)

The cursor review of this change found two ways to authenticate a verdict the
reviewer never gave. Both were confirmed against the committed real transcripts
before being fixed:

1. **Brief text counted as the reviewer's own words.** A reviewer opens its
   brief with a tool, so the brief is in the transcript. The quote check
   collected every string it could find, so `"Report every defect you find, with
   file and line references."` — an instruction — passed as evidence. Evidence
   is now restricted to runner-authored channels.
2. **A fragment lifted from mid-sentence passed.** `"this should be accepted as
   it stands"` is a contiguous span inside `"I don't think this should be
   accepted as it stands"`. A match must now begin where a sentence begins.

The risk in fixing this was making *correct* verdicts unverifiable, so the gate
was re-run against the real CLIs:

| Profile | Runner | Model | Role | Status | Verdict | Findings | Quote in transcript | Result |
|---|---|---|---|---|---|---|---|---|
| `personal-claude-sonnet-impl` | claude | sonnet | implementer | success | — | 0 | n/a | **PASS** |
| `personal-claude-opus-review` | claude | opus | reviewer | success | revise | 4 | yes | **PASS** |
| `work-claude-sonnet-impl` | claude | sonnet | implementer | success | — | 0 | n/a | **PASS** |
| `work-claude-opus-review` | claude | opus | reviewer | success | revise | 5 | yes | **PASS** |
| `personal-codex-*` (3 profiles) | codex | gpt-5.5 / terra / sol | — | usage_limit | — | 0 | n/a | **OWED** |
| `personal-cursor-composer-impl` | cursor | composer-2.5 | implementer | success | — | 0 | n/a | **PASS** |
| `personal-cursor-grok-review` | cursor | cursor-grok-4.5-high | reviewer | success | revise | 1 | yes | **PASS** |

**6/9 passed** — three real reviewers across two vendors still produced quotes
that verify under the tightened rule.

### What the quote check still does not do

It checks that the runner said those words, in that order, starting where a
sentence starts. It does not check that they were *read* correctly: a model that
quotes a whole negated sentence and calls it an accept would pass. That reading
is the model's job — measured above, on a reviewer who wrote "I don't think this
should be accepted as it stands" — and the retained transcript is what lets a
human check it afterwards.

Findings are likewise not verified against the transcript. They do not drive
acceptance; they are reported evidence, and an invented one would pollute the
audit record without landing any work.

## Run 4 — the merge candidate (commit `77fc37f`)

The reviews above were each read against a range that the next round of fixes
then changed, so this is the run against the code that would actually merge.

| Profile | Runner | Model | Role | Status | Verdict | Findings | Quote in transcript | Result |
|---|---|---|---|---|---|---|---|---|
| `personal-claude-sonnet-impl` | claude | sonnet | implementer | success | — | 0 | n/a | **PASS** |
| `personal-claude-opus-review` | claude | opus | reviewer | success | revise | 3 | yes | **PASS** |
| `work-claude-sonnet-impl` | claude | sonnet | implementer | success | — | 0 | n/a | **PASS** |
| `work-claude-opus-review` | claude | opus | reviewer | success | revise | 7 | yes | **PASS** |
| `personal-codex-*` (3 profiles) | codex | gpt-5.5 / terra / sol | — | usage_limit | — | 0 | n/a | **OWED** |
| `personal-cursor-composer-impl` | cursor | composer-2.5 | implementer | success | — | 0 | n/a | **PASS** |
| `personal-cursor-grok-review` | cursor | cursor-grok-4.5-high | reviewer | success | revise | 2 | yes | **PASS** |

**6/9 passed** — every reachable cell, with three real reviewers across two
vendors quoting themselves through the final boundary rule.

## Run 5 — the merge candidate, both verdicts (commit `1b2dde6`)

Every run above probed reviewers only on code that must be refused, so the
accept path — the one where a false rejection pauses a lane and a false
acceptance lands unapproved work — had never been measured against a real CLI.
Reviewer profiles are now probed twice.

| Profile | Runner | Model | Role | Expected | Status | Verdict | Findings | Quote in transcript | Result |
|---|---|---|---|---|---|---|---|---|---|
| `personal-claude-sonnet-impl` | claude | sonnet | implementer | — | success | — | 0 | n/a | **PASS** |
| `personal-claude-opus-review` | claude | opus | reviewer | revise | success | revise | 4 | yes | **PASS** |
| `personal-claude-opus-review` | claude | opus | reviewer | accept | success | accept | 0 | yes | **PASS** |
| `work-claude-sonnet-impl` | claude | sonnet | implementer | — | success | — | 0 | n/a | **PASS** |
| `work-claude-opus-review` | claude | opus | reviewer | revise | success | revise | 4 | yes | **PASS** |
| `work-claude-opus-review` | claude | opus | reviewer | accept | success | accept | 4 | yes | **PASS** |
| `personal-codex-*` (5 cells) | codex | gpt-5.5 / terra / sol | — | — | usage_limit | — | 0 | n/a | **OWED** |
| `personal-cursor-composer-impl` | cursor | composer-2.5 | implementer | — | success | — | 0 | n/a | **PASS** |
| `personal-cursor-grok-review` | cursor | cursor-grok-4.5-high | reviewer | revise | success | revise | 3 | yes | **PASS** |
| `personal-cursor-grok-review` | cursor | cursor-grok-4.5-high | reviewer | accept | success | accept | 0 | yes | **PASS** |

**9/14 cells passed — every reachable one**, across three vendors and both
verdicts, each verdict quoting words the reviewer actually wrote.

### What adding the accept case found

The first run of it failed a cell that had passed four times: a cursor reviewer
ended with `### Recommendation` / `**Revise it.**`, the managing agent quoted
exactly that, and the minimum-quote-length floor refused it. A correct verdict
became a failed job, and the supervisor counts a failed job as a lane fault.

Two things were wrong, and only one of them was the rule:

1. A reviewer is allowed to be brief. The floor now drops for a quote that is a
   whole statement — beginning where a statement begins and ending where one
   ends — while a torn-out fragment still needs the longer form.
2. Diagnosing it required re-running the model, because the retained record kept
   only *that* an answer had been refused, not the answer. The record now keeps
   refused reports. An audit record that cannot explain a rejection is not doing
   its job.

## What each review round cost and found

Every round found something the round before it missed, which is the same
pattern the runner repair produced across five rounds:

| Round | Reviewer | Found |
|---|---|---|
| 1 | cursor grok-4.5-high | 2 Criticals in the quote check: brief text counted as the reviewer's own words, and a fragment lifted from mid-sentence. Plus the error path that could return without retaining a transcript. |
| 2 | claude opus (work) | The same first Critical, reproduced end to end on the no-judgment fixture. Then: acceptance did not require its evidence; the single-object wire shape was untested; `.quirks/briefs` is shared, so another job's file could be attributed here. |
| 3 | claude opus (personal) | Verified rounds 1–2's fixes were real, then measured what they broke: the boundary rule rejected list items, block quotes, table cells, and em-dash lead-ins — failing a correct verdict into a paused lane. Also: codex's authored channel is unverified, and narrowing made that unknown load-bearing. |
| 4 | cursor grok-4.5-high | No Criticals. The separator rule that fixed round 3 re-admitted a mid-clause lift whenever punctuation sat inside the negation ("I don't think — this should be accepted"). Fixed by binding polarity rather than narrowing the boundary again, since narrowing is what round 3 was about. |

The gate did its own share, and kept doing it: run 1 caught a timed-out run
whose transcript was discarded, comparing runs 1 and 2 caught transport status
varying between `failure` and `usage_limit` for the same transcript, and run 5
caught the quote floor refusing a reviewer for being brief.

The pattern is the one the runner repair produced across five rounds, and it is
the argument for the owed codex pass rather than against it: **every round
found something the round before it missed.**

## Independent review

| Reviewer | Vendor | Verdict | Outcome |
|---|---|---|---|
| `cursor-grok-4.5-high` | cursor | **revise** | 2 Criticals, 4 Importants, 2 Minors. Both Criticals confirmed and fixed in `9deb268`; Importants 3–5 fixed in the same commit; Important 6 (gate incomplete) is this document's own owed record. |
| claude opus (work) | claude | **revise** | 1 Critical (the same one), 5 Importants, 6 Minors. All resolved except the owed codex coverage, which is this document's own record. |
| claude opus (personal) | claude | **revise** | 0 Criticals. 4 Importants on what the fixes broke; all resolved. |
| codex | codex | **owed** | Usage-limited until Jul 28 2026 2:02 PM. |

## Owed

codex hit its ChatGPT usage limit on 2026-07-24 and does not reset until
**Jul 28 2026 2:02 PM**. Its three profiles cannot be probed before then, so
`QK-RUN-009`'s acceptance criterion "all nine configured profiles pass a
real-CLI gate" is **not met**: six of nine are covered. The codex cells are
recorded as owed, never as passing.

The same limit means the strict-path deletion has not yet been reviewed by
codex, which found the most across the five review rounds that informed
`QK-RUN-007`/`QK-RUN-008`. Given that the cursor review of this change found two
Criticals in the one check the design's honesty rests on, that owed review is
worth collecting before this is treated as settled.
