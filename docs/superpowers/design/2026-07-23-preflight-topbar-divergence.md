# Preflight topbar identity — recorded divergence from v3

**Date:** 2026-07-23
**Status:** Decision record — addendum to `2026-07-23-quirks-ui-design-handoff.md` (§3.5, §6)
**Resolves:** the "v3 dark-topbar vs shared-shell drift" note carried out of QK-VIS-002
(`docs/superpowers/reviews/2026-07-22-post-repair-workstreams-review.md`, carried notes).

## The drift

`approval-workspace-responsive-v3.html` draws the Preflight identity block — eyebrow
"PREFLIGHT · PROPOSAL ONLY", campaign title, and health badges — inside a dark `#111827`
topbar. The shipped UI renders that identity content in the light `WorkspaceHeader`
directly under the shared dark nav shell (`src/ui/client/views/preflight-view.tsx`,
`src/ui/client/routes/root.tsx`).

## Decision

The shipped composition stands. No dark-topbar identity variant is added to the shared
shell for the Preflight route.

Rationale, from the handoff itself:

- **v3 is a single-purpose screen.** Its topbar doubles as the entire chrome because the
  mock has no primary navigation ("internal navigation is the three-view tab row only",
  §2.3). The shipped app is the five-fixed-view shell of the founding spec §22.1; v3's
  "application shell" manifest entry governs the shell *pattern*, not per-screen chrome —
  the same reasoning §6.C applies to the mock's nav labels. Replacing or restyling the
  shared nav on one route would trade real navigation for mock chrome.
- **The health badges cannot be honest.** v3's "External agents ON / Claude healthy /
  Codex healthy / Cursor healthy" badges require runner-health data that no shipped
  projection provides, and "Runner health" is deliberately outside the five-view contract
  (§6.C). Rendering them would invent evidence (§6.D; QK-VIS-002 acceptance). The
  WorkspaceHeader instead carries only projection-backed badges (envelope state,
  planning confidence).
- **The governed hierarchy is preserved.** v3's information hierarchy — identity first,
  safety statement second, metrics third (§2.3) — is intact: eyebrow, title, and badges
  render first on the page, immediately under the shell, above the "Nothing has started"
  notice and the summary grid. Only the surface the identity sits on diverges (light
  panel canvas rather than dark nav).

## Follow-through

- QK-VIS-003's manual-comparison record should list this as an accepted divergence,
  alongside the compact-nav and "Runner health" divergences already flagged in §6.C and
  the handoff's §9.3 review notes.
- If a runner-health capability ever ships (a founding-spec-level change per §6.C), the
  health-badge half of the v3 topbar becomes implementable and this decision should be
  revisited in the v7 exploration (§5.5.6) — with real data, never before.
