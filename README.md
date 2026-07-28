# Quirks

A local control plane for planning, dispatching, and understanding agent work across
repositories.

**This is v2, built from scratch.** Start with
[`docs/FOUNDING.md`](docs/FOUNDING.md)
— it is self-contained and links everything else.

## The two problems

- **A.** Structure what you want built on a large project, without losing intent.
- **B.** Let agents run overnight, then understand what happened and what went wrong.

Nothing is allowed to outrank those two. v1 grew a third job — guarding the operator against
themselves — that ended up touching 42% of its source files and became better-tested than the
observability that answers problem B. It is not being rebuilt.

> **Honesty machinery is code. Permission machinery does not exist. Judgment lives in skills.**

## Shape

```
quirks — one Bun binary: HTTP service AND CLI
   ├── quirks CLI     HTTP client, autostarts the service
   ├── native app     Native SDK, TypeScript core   (last)
   └── MCP server     another client                (later)
```

**goal → task → run** — what I am trying to achieve, what needs doing, when agents did it.

## Relationship to v1

`~/code/quirks` is **reference, not a base**. Its 19,686 lines of source are not being
converted; its documents are the asset and are copied here in full. Read it for:

- `src/runner/{claude,codex,cursor}.ts` — argv facts that cost a repair cycle to learn
- `hosts/*/discover.mjs` — harness discovery
- `skills/` — six skills to **rewrite, not copy**

Its `main` sits 406 commits ahead of `origin/main` and has never been pushed.

## Status

Bootstrap steps 1–4 are built: the store and the `goal` / `task` verbs; the **`shape`
skill** and its browser companion (`.claude/skills/shape/`); the backlog loaded from
`docs/DECISIONS.md` by Quirks itself; and the **service** — Hono routes over the store,
bind-or-attach daemon, and a CLI that is an HTTP client with autostart and no
direct-store fallback (`bun run src/main.ts help`; `bun test`). The ledger is the plan:
`quirks goal list`. Next: the native workbench (`QK-NAT`, blocked on an upstream SDK gap
— see `docs/upstream/native-terminal-gap/`), then runs (`QK-RUN`).
