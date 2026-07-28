# Prompt: fix `<terminal pty>` for transpiled TS cores in vercel-labs/native

You are working in a clone of https://github.com/vercel-labs/native (verified on 0.6.1,
commit a7509a7). Implement the fix below, following this repo's own conventions
(read AGENTS.md and CONTRIBUTING.md first; the repo uses changelog fragments under
`changelog.d/` and gates with `scripts/gate.sh`; Zig is 0.16.0 — if std APIs look
unfamiliar run `native skills get zig`). When done, open a PR.

## The gap (fully verified, reproduction below)

A transpiled TypeScript core cannot bind `<terminal pty>`, so no TS-core app can render
a live terminal. Frame this as the missing last mile, NOT a bug: #198 built live
sessions Zig-tier end to end and never touched packages/core or ts_core_host, and the
0.6.0 notes' "expressible in both authoring tiers" attaches to the terminal STATE
contract — the pty BINDING from a transpiled core was never claimed. What makes the gap
worth closing is that every other piece already works: the TS pty command family passes
the subset checker, and `terminal_sessions = true` builds and links ghostty into
TS-core apps. Four attempts at the binding, four distinct refusals:

1. Field typed `Uint8Array` (bytes of the TS session key) →
   `pty on terminal takes the model-owned pty effect key - one {binding} resolving to the u64 key`
2. Field typed `number`, value `1` → `markup view failed to build: expected a whole number`
3. Field typed `number`, value `0x5453505400000000` (the host's `pty_key_base`) → same
4. `pty="{round(shellKey)}"` → refused (pty takes one bare binding, never an expression)

Two independent walls:

- **Transpiled model numbers surface to markup as `.float`** regardless of value; `pty`
  is whole-class and `checkClassAttr` requires `.integer`
  (`src/primitives/canvas/ui_markup_contract.zig`, ~line 845). Integer inference (#181)
  is TS-usage-demand-driven; markup bindings create no demand.
- **The engine key is internal and cannot survive f64 anyway.** TS `Cmd.ptySpawn` names a
  *string* key; `src/runtime/ts_core_host.zig` interns it as `pty_key_base + index`
  (`pub const pty_key_base: u64 = 0x5453_5054_0000_0000`, ~line 411; `issuePtySpawn`
  ~line 1816; `findPty` used by the `pty_write`/`pty_kill` decoders ~lines 1201/1218).
  At 2^62.4 the f64 ulp is 1024, so `pty_key_base + index` rounds back to `pty_key_base`
  for every small index — numeric exposure of engine keys to the TS tier is lossy by
  construction. Do NOT fix this by exposing the key as a number, and do not route it
  through `PtyEventArm` or `TerminalState.pty` (#221) for the same reason.

## The fix to implement

`<terminal pty="{binding}">` accepts a **string** binding on transpiled contracts — the
TS session key the app passed to `Cmd.ptySpawn` — resolved through the TS host's pty
table to the interned engine key. Zig cores keep the u64 form unchanged.

- Unknown/unspawned string key = exactly today's binding-`0` behavior: the honest empty
  surface, no session attached, no error.
- Resolution happens at widget build from model data that is already journaled — no new
  journal record kinds; replay is unaffected.

Touch points found by source read (verify each against HEAD before editing):

1. `src/runtime/ts_core_host.zig` — expose a public lookup at the host's seam, e.g.
   `pub fn ptyEngineKey(key: []const u8) ?u64` via the existing `findPty`.
2. `src/primitives/canvas/ui_markup_view.zig` — `applyPtyAttr` (~line 1750): accept the
   `.string` expression variant when building over a transpiled contract; plumb a
   resolver the way other runtime-owned lookups reach the build. Keep `.integer` as-is.
3. `src/primitives/canvas/ui_markup_compiled.zig` — the compiled engine's pty arm:
   mirror, or a teaching that string pty bindings are transpiled-contract-only if the
   compiled engine never serves transpiled cores.
4. `src/primitives/canvas/ui_markup_contract.zig` — `checkClassAttr` (~845): give `pty`
   its own attr class (not generic `.whole`) accepting `.string` kind for transpiled
   contracts, so `grid-lines` and other whole-class attrs are untouched.
5. Teachings: existing messages stay for Zig cores; new precise teaching for a string
   binding where it isn't allowed. This repo treats error messages as documentation —
   match their voice.
6. Tests, mirroring the repo's structure: per-engine accept/resolve/unknown-key cases,
   a contract-checker case, and a `tests/ts-core/` end-to-end if the harness supports a
   pty fake on the null platform (`the null platform gets a scriptable fake pty`).
7. `docs/src/app/terminal/page.mdx` — a TS-tier paragraph: bind the session key string
   you passed to `Cmd.ptySpawn`; unknown keys render the empty surface. Note the f64
   reasoning briefly so nobody re-attempts numeric exposure.
8. `changelog.d/` fragment per repo convention.

## Reproduction to validate against (before and after)

`native init spike` (default ts-core) → `native eject` → `build.zig`:
`.terminal_sessions = true` → `build.zig.zon`: add the ghostty lazy pin copied from
`examples/workbench/build.zig.zon`. Then:

`src/core.ts`:
```ts
import { Cmd, asciiBytes } from "@native-sdk/core";

export type ShellState = "output" | "exit";
export type ShellExitReason = "exited" | "signaled" | "cancelled" | "rejected" | "spawn_failed";

export interface Model {
  readonly shellKey: Uint8Array; // after the fix: asciiBytes("shell") binds
  readonly scrollback: number;
  readonly exited: boolean;
  readonly exitCode: number;
}

export type Msg =
  | { readonly kind: "termState"; readonly scrollback: number; readonly history: number; readonly cols: number; readonly rows: number }
  | { readonly kind: "shell"; readonly key: string; readonly state: ShellState; readonly bytes: Uint8Array; readonly code: number; readonly reason: ShellExitReason; readonly signal: number; readonly droppedWrites: number };

export const viewUnbound = ["shell"] as const;

export function initialModel(): [Model, Cmd<Msg>] {
  return [
    { shellKey: asciiBytes("shell"), scrollback: 0, exited: false, exitCode: 0 },
    Cmd.ptySpawn([asciiBytes("/bin/zsh"), asciiBytes("-i")], { key: "shell", event: "shell" }),
  ];
}

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case "termState": return { ...model, scrollback: msg.scrollback };
    case "shell": return msg.state === "exit" ? { ...model, exited: true, exitCode: msg.code } : model;
  }
}
```

`src/app.native`:
```html
<column grow="1" background="background">
  <row height="34" window-drag="true"></row>
  <terminal pty="{shellKey}" scrollback="{scrollback}" on-terminal="termState" autofocus="true" grow="1" focus-ring="background" label="Shell" />
</column>
```

Before the fix: `zig build run` logs `markup view failed to build (7:3)` and the
automation snapshot shows `widget_nodes=0`. After the fix: the window shows a live zsh
prompt, typing echoes, and `zig build run -Dautomation=true` +
`native automate snapshot` shows a terminal widget whose accessibility label carries the
live viewport text. Decide the exact TS binding type as part of the design review — the
model field carrying the key could be bytes (`Uint8Array`, shown above) or whatever the
maintainers' contract prefers for string-kind bindings from transpiled cores; follow
what `checkClassAttr`/the reflect layer make natural, and keep `native check --strict`
teaching anything else.

## PR

- Branch, conventional title like `feat(terminal): resolve <terminal pty> from the TS
  tier's string session key`.
- Description: the two walls, the f64-ulp argument for why string resolution is the only
  coherent design, repro summary, and the open question of whether resolution should
  live at widget build or at `EnabledStore.reconcile` (where #221 stamps identity).
- Reference issues #221/#224 as adjacent (identity on the echo) but distinct (this is
  the binding input side).
- Run `scripts/gate.sh` and the affected test suites before opening; open as a draft PR
  if any gate can't run locally.
