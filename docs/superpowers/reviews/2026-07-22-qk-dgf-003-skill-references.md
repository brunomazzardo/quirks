# QK-DGF-003 skill reference validation review

Independent review of packaged skill markdown reference resolution for the dogfood release repair bootstrap slice.

## Scope

- `scripts/validate-skills.mjs` markdown reference extraction and package-root containment
- Repaired links in `running-agent-campaigns`, `dispatching-external-agents`, and `delegated-brainstorming`
- `test/skills/reference-resolution.test.ts` regression coverage

## Outcome

Approved. Every inline `.md` reference in shipped skills resolves to a regular file inside the package root.

## Verification

- `pnpm validate:skills`
- `node --test dist/test/skills/reference-resolution.test.js`
