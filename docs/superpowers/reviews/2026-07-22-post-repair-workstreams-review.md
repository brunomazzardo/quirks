# Post-repair workstreams — independent review record

Date: 2026-07-22. Process: each branch was implemented TDD-first by a dedicated worker in an isolated worktree, then independently reviewed by a separate reviewer over the complete branch range, with review findings resolved on-branch and re-verified by the same reviewer before merge. Reviewers verified test honesty by falsification/mutation (stubbing compiled output and observing the discriminating test fail), *not* by trusting green suites.

## QK-RUN-003 — Codex runner correctness (`merge 2efb791`)

- First pass: ACCEPT with 3 Important findings — missing `--` argv separator before the prompt positional; profile effort enum passed verbatim where codex-cli 0.144.1 accepts `minimal|low|medium|high`; brief-inlining glue mutation-survivable (neutering `readBriefContents` passed the whole suite).
- Fix round resolved all three plus: resume `--output-schema` (declared plan amendment), per-job `codex-result-<jobId>.json` paths, validator generation filtered to versioned schemas.
- Re-review: ACCEPT. Every mutation caught; validator exports byte-identical apart from the intended exclusion. Branch gate: 513 tests, 509 pass, 0 fail, 4 gated skips.
- Ledgered debt: hardcoded `codex/qk-dgf-002` ref in `src/audit/task-truth.ts` (local branch recreated at `9455858` to keep the suite green); codex nested-skill discovery layout unverified against real codex discovery; `--add-dir` write-grant to the shared briefs dir.

## QK-CTL-005 — Autonomous campaign progression (`merge 020f71f`)

- First pass: NEEDS-FIXES — Critical: sessions.json lost-update race under concurrent dispatch; Critical: reviewer verdict decorative (failed review still recorded provenance `completed`/`accepted-commit`); Important: retries fatal under default budgets, lane-pause starving later waves, supervisor-side exceptions swallowed as retryable task failures, breaker mappings untested.
- Fix round: per-instance promise-chain mutex on the session registry; completion gated on implementer AND reviewer success with honest `failed` provenance (`review_failed:<status>`); preflight retry headroom; dependency-driven task selection (scheduler change authorized to fix starvation); `SUPERVISOR_ERROR` halt path; mutation-tested breaker mappings.
- Re-review: ACCEPT. Both Criticals verified resolved; no-reviewer completion path confirmed unreachable via the shipped CLI (recommend making review-required an explicit envelope policy — ledgered). Branch gate: 514 tests, 510 pass, 0 fail, 4 gated skips.
- Ledgered debt: cross-process session-registry writes (watchdog/attach vs live start) need file-level locking; resume-into-runToCompletion; orphaned post-dispatch supervisor errors invisible to recovery; supervisor drops runner result `notes` without journaling.

## QK-UI-005 — Standalone read-only control UI (`merge b8461a3`)

- First pass: NEEDS-FIXES — Important: cross-repository disclosure (standalone campaign list scanned every repo, filtered only by client query); Important: standalone Plan Progress served fabricated hardcoded data with the browser test asserting the fabrication.
- Fix round: server-side repository scoping (bound id derived from workspace context, foreign reads 404, query param intersection-only); explicit `PlanProgressUnavailable` state replacing fabrication with negative assertions on the fabricated constants; non-vacuous approval-affordance assertion on the preflight route; corrupt-record skip; single task source per request.
- Re-review: ACCEPT, scoping verified airtight by falsification (reverting to query-param filtering made the tests fail 5/2). Branch gates: 498 pass/0 fail/4 gated skips; Playwright 26/26.
- Ledgered debt: `buildPlanProgressProjection` still bakes fabricated plan constants — must be de-fabricated before any production journal-backed plan progress ships; unparseable campaign files skipped with no warning.

## Merged-main verification

- After QK-RUN-003 + QK-CTL-005: `pnpm check` on `main` — 535 tests, 531 pass, 0 fail, 4 gated skips.
- After QK-UI-005: full `pnpm check` + Playwright re-run on `main` (recorded in the completing session's transcript and the ledger verification refs).
