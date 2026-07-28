# Quirks v2

A local control plane for agent work: **goal → task → run**. Start with
[`docs/FOUNDING.md`](docs/FOUNDING.md) — self-contained, links everything else. Decisions
live in [`docs/DECISIONS.md`](docs/DECISIONS.md) until the ledger can hold them. The
founding document's "do NOT build" table is **binding**.

> Honesty machinery is code. Permission machinery does not exist. Judgment lives in skills.

## Shaping intent

In Quirks-managed work, shaping intent — a new idea, refining or growing a goal, deriving
work — is the **`shape` skill** (`.claude/skills/shape/`). It ends in recorded goals and
tasks, **never a plan document**, and it takes precedence over generic brainstorming or
planning skills (e.g. Superpowers'), whose terminal state is a plan.

## Conventions

- pnpm + TypeScript on Node (`>=24.13`). `pnpm test` (vite-plus/vitest) and a clean
  `pnpm typecheck` (tsgo) before claiming anything works; `pnpm lint` (oxlint via vp)
  before claiming it's clean.
- The monorepo: `apps/server` is the service **and** the CLI (Effect); `apps/web` is the
  workbench UI; `apps/desktop` is the Electron shell; `packages/contracts` and
  `packages/shared` are the shared surface between them.
- The ledger is `.quirks/` and is committed. Only the store boundary (`apps/server`)
  touches it; never add a second path in.
- The CLI surface is `pnpm quirks …`. Nothing on the execution path is interactive. Reads
  print tables on a TTY and JSON when piped; writes always print JSON.
- Never push to any remote without the owner's say-so.
