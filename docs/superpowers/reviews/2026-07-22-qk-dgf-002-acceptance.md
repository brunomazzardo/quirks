# QK-DGF-002 merge acceptance record

Date: 2026-07-22. Recorded by the repository owner's session after a full-project evaluation.

## Decision

The merge of `codex/qk-dgf-002` into `main` (`a16a108`) is **accepted as landed, without the independent Step-6 release review** defined by `docs/superpowers/reviews/2026-07-22-qk-dgf-002-final-review.md`. That checklist remains unchecked and both prior review artifacts (`2026-07-22-qk-dgf-002-final-review.md`, `2026-07-22-qk-dgf-002-reconciliation.md`) are implementer-authored self-attestations, not independent verdicts. This record exists so that fact is explicit rather than implied by silence.

This acceptance is **not** a release claim. `QK-RELEASE-REV` stays `blocked` in the task ledger until an independent review actually runs.

## Evidence available at acceptance time

- `pnpm check` green on `main` at `0c38a22`: 492 node tests — 488 pass, 0 fail, 4 env-gated skips (paid runner/marketplace probes).
- Playwright browser suite run separately: 23/23 pass against real Chrome and the real built bundle.
- Task ledger reconciled: Wave-7 false completions (`QK-HOST-004A/B/C`, `QK-HOST-005A/B`, `QK-RELEASE-REV`) honestly `blocked` with corrective provenance.

## Known unresolved items carried forward

1. **Real host×runner matrix**: best recorded run 4/9 cells passed (`docs/smoke/2026-host-matrix.md`). Re-running requires `QUIRKS_SMOKE_APPROVED=approve-paid-runner-probes`.
2. **Bounded real campaign**: harness-only, operator-blocked at the Codex reviewer — Codex model unsupported on the ChatGPT account (`docs/smoke/bounded-campaign-report.md`).
3. **Matrix evidence discrepancy**: the gitignored scratch evidence under `.superpowers/sdd/qk-dgf-002/smoke/` is from a different run than the committed matrix doc — it disagrees on which cells passed (claude→codex, claude→cursor, cursor→claude), holds 8 of 9 cell files, and its claude→claude digest differs from the doc's. The committed doc is treated as authoritative; the scratch dir is unreconciled residue. The next approved matrix run must regenerate both together.
4. **Push gate**: nothing from the repair has been pushed to any remote; the reviewed push gate still applies.
