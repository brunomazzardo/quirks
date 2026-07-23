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

## QK-SKL-006 — Script-backed skill surface (`merge caea8b7`)

- Review: ACCEPT, no blocking findings. Adversarial verification included proving the claim-candidate read path performs zero writes (state-dir content hashing), mutation-testing the payload contracts and the terminality tripwire, and validating every backticked skill command line against the real parser tables. The reviewer endorsed hold-as-terminal (resuming held campaigns would auto-un-hold work parked for human review). Branch gate: 555 tests, 551 pass, 0 fail, 4 gated skips.
- Bonus: the new validator caught pre-existing drift — `executing-tasks` referenced a `quirks-campaign progress set` subcommand that never existed.
- Ledgered debt: `pnpm validate:skills` standalone script is a silent no-op (no CLI entrypoint; enforcement lives in the test suite); skill progress-mailbox wording drifts from actual supervisor wiring; multi-word subcommands validate only their first token.

## QK-PRM-001 — Contextual prompts and brainstorm materialization (`merge f7c22f6`)

- All 8 plan tasks of `docs/superpowers/plans/2026-07-22-contextual-copy-prompts.md` implemented TDD-first, then a two-stage landing: semantic merge of the rewritten supervisor (main's WS3 shape kept; authoritative briefs re-homed into `dispatchTask`; ID-only briefs eliminated) followed by the review fix round.
- First review: NEEDS-FIXES — Critical: task `verification` strings rendered as trusted prompt text (secret/home-path leakage + fake trusted headings via newline injection); Important: production UI never wired the prompt port; `TASK_REVISION_DRIFT` untested; instruction freeze fail-open when `workflowSkills` absent.
- Fix round: verification routed through sanitize/redact/delimit as untrusted evidence; `createWorkspacePromptReadPort` wired into both workspace modes with approval state read only from durable `approvals.jsonl` digests; `workflowSkills` made required plus runtime `INSTRUCTIONS_UNVERIFIED` refusal; drift guards mutation-verified; fake/real propose schema parity.
- Re-review: ACCEPT — live injection repros re-run and neutralized, merge-revert scan clean (zero WS3 semantics lost). Branch gates: 652 tests, 647 pass, 0 fail, 5 known skips (4 paid-gated + 1 opt-in eval runner); Playwright 31/31.
- Ledgered debt: workspace prompt port passes empty profiles (honest `independence-unavailable` in UI adversarial recipes) pending envelope-fact exposure; `buildPlanProgressProjection` fabricated constants (carried from QK-UI-005).

## QK-CLI-001 — CLI wrapper and workspace keep-alive fixes (`merge 77d36bb`, 2026-07-23)

- Found live while testing the standalone UI: `scripts/quirks-campaign` was a silent no-op (lexical argv[1] entry guard never matched via wrapper import), and `ui open` had no scripted keep-alive contract.
- Review: ACCEPT after one fix round — explicit `runQuirksCampaignCli()` wrapper invocation with byte-parity tests on stdout/stderr/exit codes including nonzero paths; `ui open --stay` with clean SIGINT/SIGTERM shutdown; entry guard realpaths both sides (macOS `/var → /private/var`), verified end-to-end through a real bin symlink. Branch gate: 657 tests, 652 pass, 0 fail, 5 known skips.
- Ledgered debt from the same session's live campaign staging: production `ui open` wires no PreflightReadPort so browser approval 503s (QK-UI-007); preflight is create-once and silently keeps a stale envelope on re-staging (QK-CTL-006); claude `--effort` verbatim passthrough (QK-RUN-004).

## Aggregate parent reconciliation (2026-07-23)

Staging the first real campaign surfaced that preflight's dependency closure includes the v1-suite aggregate parents left `proposed` while every child completed (the stale-parent pattern the 2026-07-22 evaluation flagged), which fail-closed the supervisor's claim step. Reconciled by completing, through the `quirks-tasks` lifecycle: QK-CTL-003, QK-CTL-004, QK-RUN-001, QK-RUN-002, QK-UI-003, QK-UI-004, QK-SKL-005 (children verified completed per task before each completion), and QK-UI-002 (implementation landed and gate-verified long since). Evidence: children's completed provenance plus the landed tree at merge `a16a108` (contains all child implementations), gates re-verified repeatedly on descendants of that commit (latest 652/657 + Playwright 31/31). Carried honestly: QK-UI-004D remains an open proposed follow-up of QK-UI-004 (test-inventory isolation); noted rather than blocking. Design question ledgered separately: preflight should arguably treat non-target closure members as frozen facts instead of claimable work.

## QK-VIS-001 — first real campaign (`merge a0ee250`, 2026-07-23)

- Campaign `cmp-ce7e91c84425`: digest-bound operator approval, real routing (claude opus/high implementer, cursor-hosted gpt-5.3-codex-high reviewer), isolated campaign worktrees, budgeted retry, honest failed-review provenance, lane breaker pause — all exercised live.
- The implementer delivered plan Tasks 1-3 in three commits and self-reported through `quirks-tasks` (claim provenance, submit-review). The automated cursor reviewer ran twice but failed the structured-result contract (`missing_structured_result` — its result envelope was `{"status":"ok"}`; cursor has no `--output-schema`-style enforcement, unlike the fixed codex runner), tripping the lane failure threshold exactly as designed.
- Independent review of the branch: ACCEPT, minors only — byte-faithful wireframe preservation verified (v5 email scrub is plan-mandated and test-enforced), test honesty confirmed against base, no scope creep, no new dependencies. Gates at branch head: 680 tests, 675 pass, 0 fail, 5 known skips.
- Shakeout findings ledgered: cursor structured-result enforcement; crash-path repository-lock leak (dead holder, no steal path); stale integration branch after failed start; preflight closure treating non-target tasks as claimable work (forced the aggregate-parent reconciliation).

## Merged-main verification

- After QK-RUN-003 + QK-CTL-005: `pnpm check` on `main` — 535 tests, 531 pass, 0 fail, 4 gated skips.
- After QK-UI-005: full `pnpm check` + Playwright re-run on `main` (recorded in the completing session's transcript and the ledger verification refs).
