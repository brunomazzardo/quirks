# Managing-agent runner layer — design (QK-RUN-009)

Status: proposed, awaiting owner approval. Direction set by Bruno, 2026-07-24 night: **the vendor CLI stops being responsible for producing a rigid envelope**; a managing agent spawned by Quirks runs the CLI and produces the structured result. Owner picked in-process spawning (a campaign stays one self-contained command) over parent-driven dispatch.

## What this is

Today Quirks demands that codex, cursor, and claude each emit a precisely-shaped JSON envelope, enforced by `--output-schema` where the vendor supports it and by brief-stated contract plus a strict parser where it does not. That demand is the source of most of the runner's bugs.

Under this design the runner splits in two:

1. A **launcher** that knows how to *start* each vendor CLI correctly — argv, env, cwd, sandbox posture, resume flags. Nothing about result shape.
2. A **managing agent**, one per job, spawned by Quirks. It runs the CLI, watches it, reads whatever it actually produced — final message, transcript, files written to the artifact dir, git state — and returns the structured `RunnerJobResult` Quirks needs.

Structure stops being something we beg a third-party model to emit and becomes something we derive from evidence, in a component we own.

## Why — the evidence from 2026-07-24

Six real dispatch defects landed in one night's probing (`docs/smoke/2026-07-24-runner-boundary-probe.md`), and the pattern behind them is a boundary that requires exact conformance from tools that were never built to conform:

- Cursor was sent `--file`, a flag it does not have. Every dispatch died in a second.
- Claude's brief was swallowed by a variadic `--add-dir`.
- Claude's `--verbose` requirement was satisfied only by a machine-local settings key.
- Claude had no result contract at all, so writing the envelope was left to chance.
- A reviewer's "revise" had no channel, so it arrived as `status:"failure"` and was retried as a crash until `BUDGET_EXCEEDED`.
- Two of three codex models wrote `artifactPaths: []` despite the schema asking for the envelope path.

The clinching case came from the independent review of the fix itself. Codex, reviewing under `--output-schema`, had **no room for prose**: its final message *must* be the envelope, so it put a Critical finding into `sessionHandle` — a 256-character field — truncated mid-sentence, and set `artifactPaths: ["/dev/stdout"]`. Cursor escaped only because it has no output schema and could write a findings file.

That is the whole argument. A reviewer had something worth saying and the contract had nowhere to put it. Tightening the schema again would keep losing that content. The fix is to let the CLI speak naturally and put an agent in front of it.

There is precedent in local practice: `~/.claude/skills/dispatching-external-agents` already says never to drive these CLIs directly — spawn a parent subagent that runs them, verifies results, and reports. This brings that proven pattern inside the tool.

## Measured: `--output-schema` suppresses the review entirely

Three review rounds on 2026-07-24 produced a decisive measurement, and it sharpens
the design.

Under `--output-schema`, codex's final message *must* be the envelope. In round one
it smuggled a Critical finding into `sessionHandle`, truncated at 256 characters.
Told in round three not to put prose there, and unable to write a findings file at
all — a reviewer runs `-s read-only` and failed with `permission_denied` when asked
— it returned a bare `verdict: "revise"` with **no reasoning anywhere**. The
retained transcript was 472 KB across 74 events and contained exactly one agent
message: the envelope JSON.

The same brief, same model, same worktree, with `--output-schema` and `-o` removed,
produced **eight substantive messages** including two Critical findings — both real,
both since fixed, one of them a bug that no compiler could see because it lived
inside a generated template string.

So the choice is not "structured or messy". It is **structured or reasoned**. Today's
contract buys machine-readable output by discarding the review that output is
supposed to summarize.

**Design consequence:** the launcher must *not* pass `--output-schema` (or the
cursor/claude equivalents). The vendor CLI is left free to write a normal review,
and the managing agent derives structure from the transcript it produced.

## Architecture

1. **Thin launcher.** Keeps today's `buildClaudeArgv` / `buildCodexArgv` / `buildCursorArgv` and the env/cwd handling — all of it real-CLI-verified as of `f4d31e3` and worth keeping. What it loses is responsibility for result shape: `--output-schema` is **dropped**, not merely made optional, for the reason measured above.

2. **Managing agent per job.** Quirks spawns a claude subprocess with a fixed system brief: *here is the job, its role, its worktree, its artifact dir; run this command; then tell me what happened, in this schema.* It has read access to the artifact dir, the worktree, and the raw transcript. Its own output is structured (`--output-format json` with a declared shape) — one schema, in one place, from a model we control and can re-prompt.

3. **Evidence is retained, not replaced.** The raw transcript and every file the vendor CLI wrote are preserved as job artifacts. The managing agent's structured result *references* them. An operator can always read what the reviewer actually said, in full, rather than a 256-character truncation.

4. **Verdict and findings both get a home.** The managing agent returns `{status, verdict, findings, artifactPaths, sessionHandle, failure}`. Findings are prose plus file/line references, kept as an artifact — no longer squeezed into a transport field.

5. **Deterministic fast path, where it is free.** If a runner still writes a well-formed envelope of its own accord, the managing agent prefers it and confirms it against the transcript rather than re-deriving from scratch. This is opportunistic only — it must never become a reason to reimpose a schema on the CLI.

## Honesty constraints — what this must not become

An interpreting agent is a place where a result could be invented. That risk is the whole reason to be careful here, and it is the part of this design most worth reviewing:

- **The managing agent never judges the work.** It reports what the reviewer said. It has no authority to accept, and its brief says so.
- **A verdict must be traceable.** The agent quotes the reviewer's own words supporting the verdict; the quote is stored with the result. A verdict with no support in the transcript is a runner failure, not an accept.
- **Absence fails closed.** If the agent cannot determine a reviewer's verdict, the result is not "accept" — it is an explicit `indeterminate` that withholds acceptance. This is the surviving half of review finding #1.
- **The raw transcript is always retained**, so any interpretation can be audited after the fact. Interpretation is never the only record.
- **The agent runs read-only** for reviewer jobs and cannot mutate task state, campaign state, or the repository.

## What this dissolves, and what it does not

Dissolved — these were format-strictness patches:

- Codex reviewers having no findings channel (the defect above).
- Claude envelope validation parity: normalization moves to the agent.
- Brief-stated envelope contracts for claude and cursor, and the fake runners that must mimic them.

Not dissolved — these live above the runner boundary and are still real:

- Provenance recording the verdict (`review_failed:success` today, review finding #4).
- Supervisor-level coverage of `verdict:"revise"` (review finding #3).
- Fail-closed on an undetermined verdict (review finding #1, in its new form above).
- `QK-CTL-011`: never dispatch a reviewer against a candidate commit equal to the base.

## Cost

One extra agent invocation per job. Interpretation is mechanical, so the managing agent runs on a cheap tier (sonnet) regardless of how expensive the job's own model is. Against that: tonight's two failed campaigns cost far more than the interpretation would have.

## Out of scope (v1)

- Parent-driven dispatch (the `ParentInterpreter` variant). The seam should stay clean enough not to preclude it, but nothing is built for it now.
- Changing model routing (`QK-RUN-006` owns that).
- Any change to campaign approval, budgets, or circuit breakers beyond the verdict plumbing already described.

## Implementation breakdown

1. **Managing-agent contract** — the result schema it returns, its system brief, and its read-only posture. Tested against recorded real transcripts, not fakes.
2. **Interpreter port** — `RunnerPort` gains a result-interpretation seam; today's schema path becomes one implementation so the change is bisectable.
3. **Agent interpreter** — spawn, structured output, evidence retention, indeterminate handling.
4. **Verdict plumbing above the boundary** — provenance reason, supervisor revise coverage, fail-closed acceptance.
5. **Retire the strict paths** — brief-stated contracts and the fake-runner mimicry they forced, once the agent path carries real traffic.
6. **Real-CLI gate** — the probe from `QK-RUN-007` extended to assert verdict and findings survive interpretation, across all nine profiles.

## Decisions (owner, 2026-07-24) — design gate closed

1. **Sonnet interprets.** One sonnet call per job. The task is to read the retained transcript, extract the verdict, quote the evidence supporting it, and decline when the evidence is absent. Cheap beside the job it interprets. Haiku was rejected for this specific reason: the load-bearing behaviour is *refusing to guess*, and that is where a smaller model drifts invisibly.

2. **Retry once, then fail with the transcript kept.** One retry absorbs a transient API error; a second failure fails the job honestly. There is deliberately **no fallback to the schema path** — with `--output-schema` dropped there is no envelope left to parse, so the spec's original fallback option was vacuous. Re-running the whole job under the schema was rejected: it pays twice and re-imposes the constraint measured above as suppressing the reviewer's reasoning. The raw transcript is retained either way, so a failed interpretation costs automation, never the work.

3. **Delete the strict envelope paths** once the agent path carries real traffic. That removes the brief-stated contracts, the strict parsers, and the fake-runner mimicry they forced — the surface where tonight's defects actually lived, and the mechanism by which the fakes drifted from reality. A flagged comparison baseline was rejected: two live result paths mean two sets of fakes to keep faithful, which is precisely the condition that produced the test/production divergence. Honesty is carried instead by transcript retention plus the requirement that a verdict quote its supporting evidence.

## Sequencing note

Codex hit a ChatGPT usage limit on 2026-07-24 (resets Jul 28). It was the reviewer that found the most across five rounds, so slices touching interpretation honesty are better reviewed once it is back; cursor and claude remain available in the meantime.
