# Draft PR: feat(terminal): resolve `<terminal pty>` from the TS tier's string session key

> Draft description + touch-point map for a PR implementing the fix proposed in the
> companion issue. The diff sketch below is grounded in a source read of 0.6.1
> (commit a7509a7) but has NOT been built or run against the repo's gates — it is a
> starting point for review, not a landing candidate. Open as a **draft** PR.

## Summary

- `<terminal pty="{binding}">` accepts a **string** binding on transpiled contracts: the
  TS session key `Cmd.ptySpawn` named, resolved through the TS host's pty table to the
  interned engine key. Zig cores keep the u64 form unchanged.
- An unknown/unspawned string key behaves exactly like binding `0` today: the terminal
  renders the honest empty surface and attaches no session.
- Never routes a u64 engine key through the TS tier's f64 — which cannot represent
  `pty_key_base + index` (ulp at 2^62.4 is 1024), the reason numeric exposure is not an
  alternative.

## Why

The 0.6.0 notes say `<terminal>` is expressible in both authoring tiers, and the TS pty
command family works — but no transpiled core can currently produce a valid `pty`
binding: model numbers surface as `.float` (whole-class attrs refuse them regardless of
value), computed bindings like `round()` are refused, and the engine key
(`ts_core_host.zig` `pty_key_base + index`) is internal. See the companion issue for the
full reproduction and the four failing attempts.

## Touch points (0.6.1, commit a7509a7)

1. **`src/runtime/ts_core_host.zig`** — expose a lookup at the host's public seam:
   `pub fn ptyEngineKey(key: []const u8) ?u64` returning `pty_key_base + index` via the
   existing `findPty` (used today by the `pty_write`/`pty_kill` decoders, ~line 1201).

2. **`src/primitives/canvas/ui_markup_view.zig`** — `applyPtyAttr` (~line 1750): accept
   the `.string` expression variant when the build runs over a transpiled contract; keep
   `.integer` as-is. Resolution callback arrives via the build scope/options (the same
   pattern other runtime-owned lookups use), defaulting to unbound (0) when the key
   names no session.

3. **`src/primitives/canvas/ui_markup_compiled.zig`** — the compiled engine's pty arm
   (mirror of 2); the compiled engine serves Zig cores today, so this may reduce to a
   teaching that string pty bindings are transpiled-contract-only.

4. **`src/primitives/canvas/ui_markup_contract.zig`** — `checkClassAttr` (~line 845):
   `pty`'s class check accepts `.string` kind for transpiled contracts (a dedicated
   `pty` class rather than generic `.whole`, so `grid-lines` and friends are untouched).

5. **Teachings + tests** — the existing messages stay for Zig cores; a new teaching for
   a string binding on a non-transpiled contract; tests mirroring the repo's pattern:
   one per engine for accept/resolve/unknown-key, and a contract-checker case.

6. **`docs/src/app/terminal/page.mdx`** — a TS-tier paragraph: bind the session key
   string you passed to `Cmd.ptySpawn`; unknown keys render the empty surface.

## Compatibility

- Zig cores: no change (u64 bindings untouched).
- Existing TS cores: none exist that mount `<terminal>` (it was impossible); no
  migration.
- Journal/replay: resolution happens at widget build from model data already journaled;
  no new record kinds.

## Open questions for maintainers

- Whether resolution should live at widget build (this sketch) or one level lower at
  `EnabledStore.reconcile`, where #221 stamps the key on `TerminalState`.
- Whether the string form should also be allowed for Zig cores that use string-keyed
  wrappers, or stay transpiled-only.
