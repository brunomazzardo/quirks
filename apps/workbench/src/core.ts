// Quirks workbench core — QK-NAT-005 single-terminal workaround.
// Plain TypeScript in the app-core subset; compiled to Zig at build time.

import { Cmd, asciiBytes } from "@native-sdk/core";

// ts_core_host.zig: pub const pty_key_base: u64 = 0x5453_5054_0000_0000.
// Index 0's engine key IS the base.
//
// Standing rules (docs/upstream/native-terminal-gap/single-terminal-workaround.md):
// - First and only pty in this app — index 0 is the only f64-safe key.
// - ABI, not API — re-verify against the SDK source on every bump
//   (`grep pty_key_base <sdk>/src/runtime/ts_core_host.zig`).
// - NEVER assign shellKey from any Msg field (loses integer proof → float).
//
// CRITICAL: do NOT write `0x5453505400000000` as a TS number literal.
// The emitter's formatNumber uses String(n); past 2^53 that prints a nearby
// decimal which Zig then treats as a different i64 (0x54535053fffffff0),
// so the bound key ≠ engine key and the terminal is an empty orphan.
// Build from two safe factors so Zig i64 multiply yields the exact u64.
function shellPtyBinding(): number {
  return 1414746196 * 4294967296;
}

export type ShellState = "output" | "exit";
export type ShellExitReason =
  | "exited"
  | "signaled"
  | "cancelled"
  | "rejected"
  | "spawn_failed";

export interface Model {
  readonly shellKey: number; // = shellPtyBinding(). NEVER assign from any Msg field.
  readonly exited: boolean;
  readonly exitCode: number;
  readonly outputBytes: number;
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
    {
      shellKey: shellPtyBinding(),
      exited: false,
      exitCode: 0,
      outputBytes: 0,
    },
    Cmd.ptySpawn([asciiBytes("/bin/zsh"), asciiBytes("-i")], {
      key: "shell",
      event: "shell",
    }),
  ];
}

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case "termState":
      return model;
    case "shell":
      if (msg.state === "exit") {
        return { ...model, exited: true, exitCode: msg.code };
      }
      return { ...model, outputBytes: model.outputBytes + msg.bytes.length };
  }
}
