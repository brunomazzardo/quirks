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

- Bun + TypeScript. `bun test` and a clean `bunx tsc --noEmit` before claiming anything
  works.
- The ledger is `.quirks/` and is committed. Only `src/store/` touches it — that is the
  boundary the HTTP service takes over at bootstrap step 4; never add a second path in.
- Nothing on the execution path is interactive. Reads print tables on a TTY and JSON when
  piped; writes always print JSON.
- Never push to any remote without the owner's say-so.
