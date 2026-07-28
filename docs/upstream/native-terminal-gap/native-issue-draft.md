# Feature gap: a transpiled TS core cannot bind `<terminal pty>` — the TS pty commands and the terminal element exist on both sides and fail to meet at the binding

## Summary

Not a regression, and not contradicting any documented claim — checked against #198 (which
is Zig-tier end to end) and the 0.6.0 notes, where "expressible in both authoring tiers"
attaches to the terminal *state contract* and the TS tier gained the pty *command* family.
This is the missing last mile between them.

Everything up to the binding works from a transpiled core: `Cmd.ptySpawn` /
`ptyWrite` / `ptyResize` / `ptyKill` pass the subset checker, and `native eject` +
`terminal_sessions = true` on a TS-core app resolves the lazy ghostty pin and links the
real emulator. But binding the session to `<terminal pty>` has no path from a transpiled
core — the shell runs, the element can never render it. Every route fails, each with its
own explicit teaching:

| Attempt | Result |
| --- | --- |
| `pty="{shellKey}"`, field typed `Uint8Array` (the TS session key's bytes) | `pty on terminal takes the model-owned pty effect key - one {binding} resolving to the u64 key` |
| field typed `number`, value `1` | `markup view failed to build (7:3): expected a whole number` |
| field typed `number`, value `0x5453505400000000` (the TS host's `pty_key_base`) | `expected a whole number` |
| `pty="{round(shellKey)}"` | `pty … takes … one {binding}` (bare binding only — computed expressions refused) |

So the element mounts nothing, `on-terminal` never fires, and a TS-core terminal app
cannot exist even though every other piece of it works.

## The two walls

**1. Transpiled model numbers surface to markup as floats.** The `pty` attribute is
whole-class (`checkClassAttr` requires the `.integer` kind —
`src/primitives/canvas/ui_markup_contract.zig`), and a TS `number` model field arrives as
`.float` regardless of its value (binding `1` fails identically to binding 2^62). The
transpiler's integer inference exists (#181) but is driven by TS-side usage demand, which
a markup binding does not generate.

**2. The engine key is internal — and cannot survive the f64 boundary anyway.** For TS
cores, `Cmd.ptySpawn` names a *string* session key; the host interns it as
`pty_key_base + table index` (`src/runtime/ts_core_host.zig`,
`pub const pty_key_base: u64 = 0x5453_5054_0000_0000`). No public accessor exposes that
key to the TS tier — but the deeper problem is that none *could*: TS numbers are f64,
and at 0x5453_5054_0000_0000 ≈ 2^62.4 the f64 ulp is 1024, so `pty_key_base + index`
rounds back to `pty_key_base` for every small index. Any design that hands u64 engine
keys through the TS tier's one number type is lossy by construction. (The same argument
applies to stamping the engine key onto `PtyEventArm` or onto `TerminalState`'s new
`pty` field from #221/#224 as a discovery mechanism for TS cores.)

## Proposed fix

Let `<terminal pty>` accept the TS tier's **string session key** and resolve it through
the TS host's pty table (the same `findPty` used by `pty_write`/`pty_kill`,
`ts_core_host.zig`). Concretely:

- For transpiled contracts, the validator/contract checker accepts a string-kind binding
  on `pty` (Zig cores keep the u64 form unchanged).
- At widget build, the string resolves to the interned engine key; an unknown key behaves
  exactly like binding `0` today — the honest empty surface, no session attached.

This keeps keys-as-identity (the direction #221 is already rowing), reuses the existing
interning, and never routes a u64 through f64.

## Reproduction

SDK 0.6.1 (commit a7509a7), macOS. `native init spike` (default ts-core), `native eject`,
`build.zig` → `.terminal_sessions = true`, `build.zig.zon` → the ghostty lazy pin from
`examples/workbench`. Core:

```ts
import { Cmd, asciiBytes } from "@native-sdk/core";

export type ShellState = "output" | "exit";
export type ShellExitReason = "exited" | "signaled" | "cancelled" | "rejected" | "spawn_failed";

export interface Model {
  readonly shellKey: number; // 1, bytes, or pty_key_base — all four attempts fail
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
    { shellKey: 1, scrollback: 0, exited: false, exitCode: 0 },
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

Markup:

```html
<column grow="1" background="background">
  <terminal pty="{shellKey}" scrollback="{scrollback}" on-terminal="termState" autofocus="true" grow="1" label="Shell" />
</column>
```

`native check --strict` passes; `zig build run` → `markup view failed to build (7:3):
expected a whole number`, `widget_nodes=0`, empty window. The spawn itself succeeds (the
shell is running; only the element can't reach it).
