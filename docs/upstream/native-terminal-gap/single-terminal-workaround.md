# The single-terminal workaround: bind the index-0 engine key

**Verdict: a transpiled TS core CAN render one live terminal on stock SDK 0.6.1 — no fork,
no patch.** The spike's "cannot drive a live `<terminal>`" (QK-NAT-001) was one attribute
too pessimistic: two of the four captured refusals were thrown by `scrollback`, not `pty`,
and the pty binding itself passes today when the model field is a proven-integer `number`.
This document is the recipe, the mechanism, and the honest constraints. Verified against
SDK 0.6.1 (`a7509a7`).

## The recipe

`src/core.ts` — the binding constant is the SDK-internal engine key for the app's first
pty session (`ts_core_host.zig` `pty_key_base + 0`). It is exactly representable in f64;
a field initialized from it and never assigned from any Msg field is proven integer and
emits `i64`, which is what `<terminal pty>` requires:

```ts
import { Cmd, asciiBytes } from "@native-sdk/core";

// ts_core_host.zig: pub const pty_key_base: u64 = 0x5453_5054_0000_0000.
// Index 0's engine key IS the base. ABI, not API — re-verify on every SDK bump.
const SHELL_PTY_BINDING = 0x5453505400000000;

export interface Model {
  readonly shellKey: number; // = SHELL_PTY_BINDING, NEVER assigned from a Msg field
  readonly exited: boolean;
}

export function initialModel(): [Model, Cmd<Msg>] {
  return [
    { shellKey: SHELL_PTY_BINDING, exited: false },
    // The string key stays: Cmd.ptyKill("shell") / ptyWrite route by it, and a
    // keyless spawn ("" key) is unreachable by every routed verb (findPty("") is null).
    Cmd.ptySpawn([asciiBytes("/bin/zsh"), asciiBytes("-i")], { key: "shell", event: "shell" }),
  ];
}
```

`src/app.native` — bind `pty`; do **not** bind `scrollback` (that is the second, separate
gap — see constraints):

```html
<terminal pty="{shellKey}" on-terminal="termState" autofocus="true" grow="1" label="Shell" />
```

Build as the spike did: `native eject`, `terminal_sessions = true`, the lazy ghostty pin
from `examples/workbench/build.zig.zon`.

## Why it works

The element and the pty effect rendezvous on plain u64 equality, end to end:

- Binding the key creates the emulator session (`terminal_session.zig` `ensureSession`,
  via the `Ui.terminal_lookup` seam installed by the app loop).
- Every delivered pty event feeds the store by engine key (`ui_app.zig` `pty_tap` →
  `notePtyEvent`), and the TS bridge's sessions carry `pty_key_base + index`.
- Focused input rides the store's gateway straight into the **engine's** journaled
  `ptyWrite` — it never crosses the TS bridge, so typing needs no TS-side key at all.

`pty_key_base` = `0x5453_5054_0000_0000` needs 31 mantissa bits — exact in f64. So the
first session's key survives the `number` field byte-perfect, the widget's session and
the effect's session are the same u64, and the shell echoes.

## The constraints, honestly

- **Exactly one terminal.** The pty table has 4 entries and the f64 ulp at this magnitude
  is 1024: `pty_key_base + 1` is not representable. Index 0 is the only session a TS
  model number can name. QK-NAT-002's single center pane fits; a second pane does not.
- **The pty must be the app's first and only spawn.** The binding names table index 0.
  Respawn-after-exit reuses index 0 and keeps working — as long as no second pty is ever
  live concurrently.
- **The constant is ABI, not API.** Nothing upstream promises `pty_key_base` its value.
  Re-verify on every SDK bump (`grep pty_key_base src/runtime/ts_core_host.zig` in the
  dependency) and smoke it: `native automate snapshot` — the terminal widget's
  accessibility label carries the live viewport text.
- **No `scrollback` binding.** `model.scrollback` fed from `msg.scrollback` is f64 by the
  inference boundary (external slots never prove; `Math.trunc` keeps a float argument
  float), and the `u32` option refuses floats — this is the error the spike captured as
  attempts 2 and 3, misattributed to `pty`. Cost is small: the runtime retains the scroll
  offset across rebuilds on its own (upstream #221 confirms); only app-visible
  persistence of the offset is lost.
- **A wrong nonzero key fails silently.** `ensureSession` creates an orphan emulator for
  any nonzero u64 — live-looking cursor, no output, no teaching. If the constant ever
  moves, this is what breakage looks like.

## Corrections to the spike record (QK-NAT-001 evidence)

- "transpiled model numbers surface as floats" is true only for Msg-fed fields. A
  const-initialized model `number` is proven `i64` (the SDK's own e2e fixture binds
  `surface="{previewSurface}"` this way), and `pty="{shellKey}"` then passes all three
  markup engines.
- The captured "expected a whole number" teachings came from `scrollback="{scrollback}"`
  (`setOptionField`'s int branch), not from `pty`. The spike was one removed attribute
  away from a live shell.

## Relation to the upstream issue

This workaround is evidence, not the resolution: it proves the rendezvous machinery is
sound and only the key exchange is missing. The upstream issue asks for a supported
binding path (string session key resolved at the element, or the numeric key convention
the SDK's own terminal docs page already — wrongly — documents). When it lands, the
recipe collapses to deleting the constant.
