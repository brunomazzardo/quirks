# The single-terminal workaround: bind the index-0 engine key

**Agent reference — read this before any Native `<terminal>` / pty work.**

**Verdict: a transpiled TS core CAN render one live terminal on stock SDK 0.6.1 — no fork,
no patch.** The spike's "cannot drive a live `<terminal>`" (QK-NAT-001) was one attribute
too pessimistic: two of the four captured refusals were thrown by `scrollback`, not `pty`,
and the pty binding itself passes today when the model field is a proven-integer `number`.
This document is the recipe, the mechanism, and the honest constraints. Verified against
SDK 0.6.1 (`a7509a7`). Upstream issue draft stays on hold until a fresh walkthrough
result fills its verification section.

---

## Complete walkthrough (SDK 0.6.1, no fork)

### 1. Scaffold and eject

```bash
native init spike && cd spike     # default ts-core
native eject
```

### 2. Three file edits

**`build.zig`** — turn on sessions in the `addAppArtifacts` options:

```zig
.terminal_sessions = true,
```

**`build.zig.zon`** — add the lazy ghostty pin to `.dependencies` (match
`examples/workbench/build.zig.zon` for the pin your SDK ship expects):

```zig
.ghostty = .{
    .url = "https://github.com/ghostty-org/ghostty/archive/7aa9591746ffa4d2eee458960c76554352832595.tar.gz",
    .hash = "ghostty-1.3.2-dev-5UdBC-edJAVXTdYsgHOzIqgAI7hE8VqpmriEi8zgufw2",
    .lazy = true,
},
```

**`app.zon`** — the pty rides the spawn permission; a scaffolded app does **not** have it:

```zig
.permissions = .{ "view", "command" },
```

Without `"command"`, the spawn is refused with a rejected exit and the terminal sits
empty looking **exactly like a wrong-key orphan**. Confirm this permission before
debugging binding constants.

### 3. `src/core.ts` — complete

```ts
import { Cmd, asciiBytes } from "@native-sdk/core";

// ts_core_host.zig: pub const pty_key_base: u64 = 0x5453_5054_0000_0000.
// Index 0's engine key IS the base. ABI, not API — re-verify on every bump.
//
// CRITICAL: do NOT write `const K = 0x5453505400000000` as a TS number literal
// used as an i64 const. The emitter's formatNumber uses String(n); past 2^53
// that prints a nearby decimal which Zig then treats as a *different* i64
// (0x54535053fffffff0). Bound key ≠ engine key → empty orphan terminal.
// Build from two Number.isSafeInteger factors so emitted Zig does
// `1414746196 * 4294967296` as i64 and yields the exact engine key.
function shellPtyBinding(): number {
  return 1414746196 * 4294967296;
}

export type ShellState = "output" | "exit";
export type ShellExitReason = "exited" | "signaled" | "cancelled" | "rejected" | "spawn_failed";

export interface Model {
  readonly shellKey: number; // = shellPtyBinding(). NEVER assign from any Msg field.
  readonly exited: boolean;
  readonly exitCode: number;
}

export type Msg =
  | {
      readonly kind: "termState";
      readonly scrollback: number;
      readonly history: number;
      readonly cols: number;
      readonly rows: number;
    }
  | {
      readonly kind: "shell";
      readonly key: string;
      readonly state: ShellState;
      readonly bytes: Uint8Array;
      readonly code: number;
      readonly reason: ShellExitReason;
      readonly signal: number;
      readonly droppedWrites: number;
    };

export const viewUnbound = ["shell"] as const;

export function initialModel(): [Model, Cmd<Msg>] {
  return [
    { shellKey: shellPtyBinding(), exited: false, exitCode: 0 },
    // The string key stays: it's how Cmd.ptyWrite / ptyKill route.
    // A keyless spawn is unreachable by every routed verb.
    Cmd.ptySpawn([asciiBytes("/bin/zsh"), asciiBytes("-i")], {
      key: "shell",
      event: "shell",
    }),
  ];
}

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case "termState":
      // Fine to store msg.scrollback if you want — just never bind it back to markup.
      return model;
    case "shell":
      return msg.state === "exit"
        ? { ...model, exited: true, exitCode: msg.code }
        : model;
  }
}
```

### 4. `src/app.native` — complete

```html
<column grow="1" background="background">
  <row height="34" window-drag="true"></row>
  <terminal
    pty="{shellKey}"
    on-terminal="termState"
    autofocus="true"
    grow="1"
    focus-ring="background"
    label="Shell"
  />
</column>
```

**No `scrollback=` attribute.** That is the load-bearing omission — "expected a whole
number" in the spike was never `pty`'s error. Scrolling still works; the runtime retains
the offset itself.

### 5. Run and verify

```bash
native check          # should pass clean
zig build run         # live zsh prompt, typing echoes
```

Then the honest check:

```bash
zig build run -Dautomation=true   # in one shell
native automate wait && native automate snapshot   # in another
```

**Success** = a terminal widget in the snapshot whose accessibility label carries the
live viewport text (your actual zsh prompt), `widget_nodes > 0`.

### 6. If it fails, where to look

| Symptom | Meaning |
| --- | --- |
| `native check` / build fails with the `pty on terminal takes…u64 key` teaching | `shellKey` lost its integer proof: something assigns it from a Msg field, or the literal changed. It must stay a const-fed number. |
| Build fails `expected a whole number` | A `scrollback="{…}"` (or similar int option) is still in the markup. |
| Terminal renders, cursor visible, no output ever | The **orphan** case: bound key ≠ engine key. Causes: (1) `0x5453505400000000` written as a TS literal — emitter `String(n)` rounds past 2^53 (use the safe-factor multiply above); (2) spawn wasn't the app's first pty; (3) `pty_key_base` moved. Grep `pty_key_base` in `<sdk>/src/runtime/ts_core_host.zig` — must be `0x5453_5054_0000_0000`. |
| `shell` Msg arrives with `reason: "rejected"` immediately | Spawn refused before a child existed — **most likely the missing `"command"` permission in `app.zon`**, or a duplicate live key. Looks identical to the orphan until you read the exit reason. |
| `reason: "spawn_failed"` | The pty/exec couldn't start the path (`/bin/zsh`). |

---

## Standing rules

- **One terminal, ever, per app** — index 0 is the only f64-representable key in the
  4-slot table.
- **The `ptySpawn` must be the app's first and only pty** (respawn-after-exit reuses
  index 0 and keeps working — as long as no second pty is ever live concurrently).
- **`"command"` in `app.zon`** — required; scaffold default is insufficient.
- **The constant is internal ABI** — pin your SDK version and re-verify on every bump.

---

## Why it works

The element and the pty effect rendezvous on plain u64 equality, end to end:

- Binding the key creates the emulator session (`terminal_session.zig` `ensureSession`,
  via the `Ui.terminal_lookup` seam installed by the app loop).
- Every delivered pty event feeds the store by engine key (`ui_app.zig` `pty_tap` →
  `notePtyEvent`), and the TS bridge's sessions carry `pty_key_base + index`.
- Focused input rides the store's gateway straight into the **engine's** journaled
  `ptyWrite` — it never crosses the TS bridge, so typing needs no TS-side key at all.

`pty_key_base` = `0x5453_5054_0000_0000` needs 31 mantissa bits — exact in f64. The
IEEE bits are right; what bites is the emitter spelling an i64 via `String(n)`, which
is not bit-exact past 2^53. Building the key as `1414746196 * 4294967296` in a
function keeps the multiply in emitted Zig i64 math, so the widget session and the
effect session stay the same u64 and the shell echoes.

## The constraints, honestly

- **Exactly one terminal.** The pty table has 4 entries and the f64 ulp at this magnitude
  is 1024: `pty_key_base + 1` is not representable. Index 0 is the only session a TS
  model number can name. QK-NAT-002's single center pane fits; a second pane does not.
- **The pty must be the app's first and only spawn.** The binding names table index 0.
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
  moves, this is what breakage looks like. Missing `"command"` permission produces the
  same empty look via `reason: "rejected"` — always check that Msg first.

## Corrections to the spike record (QK-NAT-001 evidence)

- "transpiled model numbers surface as floats" is true only for Msg-fed fields. A
  const-initialized model `number` is proven `i64` (the SDK's own e2e fixture binds
  `surface="{previewSurface}"` this way), and `pty="{shellKey}"` then passes all three
  markup engines.
- The captured "expected a whole number" teachings came from `scrollback="{scrollback}"`
  (`setOptionField`'s int branch), not from `pty`. The spike was one removed attribute
  away from a live shell.
- Scaffolded `app.zon` without `"command"` is a third footgun that was not in the
  original spike matrix — it mimics the orphan visually.

## Relation to the upstream issue

This workaround is evidence, not the resolution: it proves the rendezvous machinery is
sound and only the key exchange is missing. The upstream issue asks for a supported
binding path (string session key resolved at the element, or the numeric key convention
the SDK's own terminal docs page already — wrongly — documents). When it lands, the
recipe collapses to deleting the constant. Keep the issue draft on hold until a
walkthrough result (especially which failure-table row, if any, plus the automate
snapshot) becomes its verification section.
