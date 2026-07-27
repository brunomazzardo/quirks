# Animation Opportunities — Quirks Local Control UI

**Date:** 2026-07-23
**Skill:** `find-animation-opportunities` (read-only; proposes motion, does not implement it)
**Scope:** `src/ui/styles.ts`, `src/ui/client/views/*.tsx`, `src/ui/client/components/*.tsx`, `src/ui/client/routes/*.tsx`

**Recon findings.** The UI has zero motion vocabulary today: no `transition`, `animation`, `@keyframes`, `:hover`, or `:active` rule exists anywhere in `src/ui` (verified by grep). The three fidelity-bearing wireframes (`docs/visual-references/quirks-ui/*.html`) and the design handoff §1–2 specify **no motion at all** — every "ease"/"lease" grep hit is a false positive on words like "released". The mocks imply a static, crisp operator dashboard, and that read governs: this report proposes the minimum motion that earns its place, plus the one canonical token set every recipe shares.

**Proposed canonical tokens** (no easing/duration tokens exist in `styles.ts:13-33`; every recipe below uses these, never per-spot magic numbers — add once to `:root`):

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--duration-fast: 140ms;
--duration-med: 200ms;
```

All recipes animate `transform` and `opacity` only, and share one reduced-motion block (gentler, not zero — fades survive, displacement does not). No suggestion is hover-triggered, so no `@media (hover: hover)` gating is required; if hover styles are ever added, gate them then.

---

## Part 1 — Opportunities table

| # | Location | Today | Purpose | Frequency | Suggested motion |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/ui/styles.ts:48-50` (global `button` rules) | No `:active` press feedback anywhere; `button:disabled` opacity snaps 1 → 0.55 instantly (most visible on the Approve button as the acknowledgment checkbox toggles it, `approval-form.tsx:61`) | Feedback | Tens/day (chips, copy, Inspect) → near-imperceptible only | `button { transition: transform var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out); }` and `button:not(.task-select):active { transform: scale(0.97); }`. `.task-select` (`styles.ts:120`) is excluded — it is a text-styled row button the user is reading; scaling it would smear the read surface. The same transition smooths the disabled↔enabled opacity swap for free. Reduced motion: `button:not(.task-select):active { transform: scale(0.99); }` — press acknowledgment survives, displacement nearly vanishes. |
| 2 | `src/ui/client/components/prompt-actions.tsx:105-125` (More prompts menu) and `src/ui/client/components/prompt-preview.tsx:17` (preview dialog) | Both conditional renders teleport in fully formed with no connection to the button that opened them | Spatial consistency (menu grows from its trigger); Preventing a jarring change (preview) | Occasional (copy-prompt actions) | Menu: `.prompt-actions-menu { transform-origin: top left; transition: opacity 160ms var(--ease-out), transform 160ms var(--ease-out); } @starting-style { .prompt-actions-menu { opacity: 0; transform: scale(0.97); } }` — never from `scale(0)`. Preview: `.prompt-preview { transition: opacity var(--duration-med) var(--ease-out), transform var(--duration-med) var(--ease-out); } @starting-style { .prompt-preview { opacity: 0; transform: translateY(4px); } }`. Dismissal stays instant (conditional unmount) — exits should be faster than entries, and instant is the fastest. Reduced motion: `@starting-style` transforms drop to `none`; opacity-only fade remains. |
| 3 | `src/ui/client/components/prompt-actions.tsx:88` ("Copied" status) | The `<span role="status">Copied</span>` pops in instantly beside the copy button, sits 2s, vanishes | Feedback | Occasional (transient state swap) | `.prompt-actions-buttons [role='status'] { transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); } @starting-style { .prompt-actions-buttons [role='status'] { opacity: 0; transform: translateY(2px); } }` — targets the existing `role` attribute, no TSX change needed. The 2s-later removal stays instant (unmount); a lingering exit would outstay a confirmation. Reduced motion: opacity-only. Screen-reader announcement via `role="status"` is unaffected. |
| 4 | `src/ui/client/views/preflight-view.tsx:561-565` (`.approval-message`, styled at `styles.ts:217`) | The approval result ("Campaign approved. Event …" / failure text) swaps in instantly inside the fixed footer after the one irreversible action | Preventing a jarring change — at the single solemn moment where a gentle beat is earned | Rare (campaign approval) | `.approval-message { transition: opacity var(--duration-med) var(--ease-out), transform var(--duration-med) var(--ease-out); } @starting-style { .approval-message { opacity: 0; transform: translateY(4px); } }` — 200ms, well inside budget, so confirmation of an irreversible act never feels delayed. Reduced motion: opacity-only fade. `role="status"` announcement timing is unaffected. |

## Part 2 — Rejected candidates (REQUIRED)

- `src/ui/client/routes/existing-tasks.tsx:22` (and `campaigns.tsx:12`, `campaign-detail.tsx:20`, `task-history.tsx:15`) — fading route content in over the "Loading…" swap. **Rejected: core navigation, seen on every visit, multiple times a day. Animation makes navigation feel slower; instant is optimal.**
- `src/ui/client/components/data-table.tsx:42` + `styles.ts:118` — animating the inspector content swap or the `data-selected` row highlight on selection. **Rejected: inspector selection runs tens of times a day on a read/act surface, and the highlight is a background-color change — outside the transform/opacity-only rule. Frequency + Function.**
- `src/ui/client/views/preflight-view.tsx:94-107` and `existing-tasks-view.tsx:113-127` — staggered group entrance for execution-map / dependency-frontier cards. **Rejected: these are functional data readouts the operator is trying to read; decoration on data-dense surfaces hinders. Function gate, applied hard.**
- `src/ui/client/views/existing-tasks-view.tsx:267-273` — enter/exit transitions on table rows as search text and filter chips change the visible set. **Rejected: filtering is a tens-per-day scanning operation; rows moving under the eye impedes the scan. Frequency + Function.**
- `src/ui/styles.ts:208` — sliding the fixed approval footer up from the bottom edge on preflight load. **Rejected: it is a page-load entrance that replays on every reload while the operator reviews the proposal, and "it looks solemn" is not a purpose on the list. Purpose gate.**
- `src/ui/client/components/approval-form.tsx:61` — hold-to-confirm fill on the Approve button. **Rejected: the acknowledgment checkbox is already the deliberate-friction mechanism binding approval to the digest; stacking a second friction ritual duplicates the safeguard without adding information. Purpose gate.**

## Part 3 — Verdict

This interface needs very little motion, and that is by design — the wireframes specify none, and the daily surfaces (tables, frontier maps, inspectors, polling readouts) are correctly static and must stay that way. What is missing is not animation but *acknowledgment*: nothing in the app currently confirms a press, and the few surfaces that do appear (menus, previews, status confirmations) teleport. Four small recipes fix that without touching any read surface. The highest-leverage row is **#1**: it introduces the canonical `--ease-out` / `--duration-fast` / `--duration-med` tokens that every other row reuses, and it gives every button in the app press feedback and smooth disabled-state changes with two CSS rules. To turn any row into a self-contained implementation plan: `improve-animations plan <suggestion>`.
