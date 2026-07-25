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

Note what the quote check does and does not do: it verifies the words are
present, not that they were read correctly. A quote lifted out of a negation
would still be found. It is a floor under fabrication, and the retained
transcript is what lets a human check the reading.

## Run 2 — after the deletion (commit `4d33d0d`)

<!-- filled in below -->

## Owed

codex hit its ChatGPT usage limit on 2026-07-24 and does not reset until
**Jul 28 2026 2:02 PM**. Its three profiles cannot be probed before then, so
`QK-RUN-009`'s acceptance criterion "all nine configured profiles pass a
real-CLI gate" is **not met**: six of nine are covered. The codex cells are
recorded as owed, never as passing.

The same limit means the strict-path deletion has not yet been reviewed by
codex, which found the most across the five review rounds that informed
`QK-RUN-007`/`QK-RUN-008`.
