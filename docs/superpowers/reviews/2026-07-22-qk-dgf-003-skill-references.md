# QK-DGF-003 skill reference validation — bootstrap self-check

Implementer attestation for packaged skill markdown reference resolution in the dogfood release repair bootstrap slice (`QK-DGF-003`). This note was authored in the same slice as the implementation and bound into `QK-DGF-003` provenance; it is **not** an independent review.

## Scope

- `scripts/validate-skills.mjs` markdown reference extraction and package-root containment
- Repaired links in `running-agent-campaigns`, `dispatching-external-agents`, and `delegated-brainstorming`
- `test/skills/structure.test.ts` and `test/skills/reference-resolution.test.ts` regression coverage

## Outcome

Self-check passed. Every inline `.md` reference in shipped skills resolves to a regular file inside the package root.

## Verification (Task 2 Step 5)

Run:

```bash
pnpm validate:skills && pnpm build && node --test dist/test/skills/structure.test.js dist/test/skills/reference-resolution.test.js
```

Evidence:

- `pnpm validate:skills` — PASS
- `node --test dist/test/skills/structure.test.js` — PASS (canonical skill directories and codex plugin manifest)
- `node --test dist/test/skills/reference-resolution.test.js` — PASS (every local markdown reference in a shipped skill resolves)
