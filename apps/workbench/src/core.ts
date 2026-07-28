// Quirks workbench core — QK-NAT-005 terminal + QK-NAT-002 three-pane shell.
// Plain TypeScript in the app-core subset; compiled to Zig at build time.

import { Cmd, Sub, asciiBytes } from "@native-sdk/core";

// ts_core_host.zig: pub const pty_key_base: u64 = 0x5453_5054_0000_0000.
// Index 0's engine key IS the base.
//
// Standing rules (docs/upstream/native-terminal-gap/single-terminal-workaround.md):
// - First and only pty in this app — index 0 is the only f64-safe key.
// - ABI, not API — re-verify against the SDK source on every bump.
// - NEVER assign shellKey from any Msg field (loses integer proof → float).
//
// CRITICAL: do NOT write `0x5453505400000000` as a TS number literal.
// The emitter's formatNumber uses String(n); past 2^53 that prints a nearby
// decimal which Zig then treats as a different i64 (orphan terminal).
function shellPtyBinding(): number {
  return 1414746196 * 4294967296;
}

// Loopback daemon for this repo (portForRoot → 47301). Preview loads the
// shape companion (QK-NAT-003 / COMP-003); ledger stays on /v1/*.
const GOALS_URL = asciiBytes("http://127.0.0.1:47301/v1/goals?limit=50");
const TASKS_URL = asciiBytes("http://127.0.0.1:47301/v1/tasks?limit=50");
const PREVIEW_URL = asciiBytes("http://127.0.0.1:47301/shape/");

export type ShellState = "output" | "exit";
export type ShellExitReason =
  | "exited"
  | "signaled"
  | "cancelled"
  | "rejected"
  | "spawn_failed";

export interface LedgerLine {
  readonly line: Uint8Array;
}

export interface HistoryEntry {
  readonly url: Uint8Array;
}

export interface Model {
  readonly shellKey: number;
  readonly exited: boolean;
  readonly exitCode: number;
  readonly outputBytes: number;
  readonly termCols: number;
  readonly termRows: number;
  readonly leftSplit: number;
  readonly rightSplit: number;
  readonly goalsText: Uint8Array;
  readonly tasksText: Uint8Array;
  readonly ledgerStatus: Uint8Array;
  readonly previewUrl: Uint8Array;
  readonly reloadToken: number;
  readonly history: readonly HistoryEntry[];
  readonly historyIndex: number;
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
    }
  | { readonly kind: "leftResized"; readonly fraction: number }
  | { readonly kind: "rightResized"; readonly fraction: number }
  | { readonly kind: "goalsOk"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "goalsErr"; readonly reason: Uint8Array }
  | { readonly kind: "tasksOk"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "tasksErr"; readonly reason: Uint8Array }
  | { readonly kind: "refreshTick"; readonly at: number };

export const viewUnbound = ["shell"] as const;

function joinLines(lines: readonly LedgerLine[]): Uint8Array {
  if (lines.length === 0) return asciiBytes("(none)");
  let total = 0;
  for (let i = 0; i < lines.length; i += 1) {
    total += lines[i]!.line.length;
    if (i + 1 < lines.length) total += 1;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < lines.length; i += 1) {
    out.set(lines[i]!.line, at);
    at += lines[i]!.line.length;
    if (i + 1 < lines.length) {
      out[at] = 10; // '\n'
      at += 1;
    }
  }
  return out;
}

function parseItemLines(body: Uint8Array, idKey: Uint8Array, titleKey: Uint8Array): readonly LedgerLine[] {
  const itemsKey = asciiBytes('"items"');
  const itemsAt = body.indexOf(itemsKey);
  if (itemsAt < 0) return [];
  let i = itemsAt + itemsKey.length;
  while (i < body.length && body[i]! !== 91) i += 1; // '['
  if (i >= body.length) return [];
  i += 1;

  const out: LedgerLine[] = [];
  while (i < body.length && out.length < 40) {
    while (i < body.length && body[i]! !== 123 && body[i]! !== 93) i += 1; // '{' or ']'
    if (i >= body.length || body[i]! === 93) break;
    const start = i;
    let depth = 0;
    while (i < body.length) {
      const c = body[i]!;
      if (c === 123) depth += 1;
      else if (c === 125) {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
      i += 1;
    }
    const obj = body.slice(start, i);
    const id = jsonStringField(obj, idKey);
    const title = jsonStringField(obj, titleKey);
    const status = jsonStringField(obj, asciiBytes('"status"'));
    const state = jsonStringField(obj, asciiBytes('"state"'));
    const label = title.length > 0 ? title : id;
    const tag = status.length > 0 ? status : state;
    out[out.length] = { line: joinParts(label, tag) };
  }
  return out;
}

function jsonStringField(obj: Uint8Array, key: Uint8Array): Uint8Array {
  const at = obj.indexOf(key);
  if (at < 0) return asciiBytes("");
  let i = at + key.length;
  while (i < obj.length && (obj[i]! === 32 || obj[i]! === 58)) i += 1; // space or ':'
  if (i < obj.length && obj[i]! === 110) return asciiBytes(""); // null
  if (i >= obj.length || obj[i]! !== 34) return asciiBytes("");
  i += 1;
  const start = i;
  while (i < obj.length && obj[i]! !== 34) {
    if (obj[i]! === 92) i += 2;
    else i += 1;
  }
  return obj.slice(start, i);
}

function joinParts(label: Uint8Array, tag: Uint8Array): Uint8Array {
  if (tag.length === 0) return label;
  const sep = asciiBytes(" — ");
  const out = new Uint8Array(label.length + sep.length + tag.length);
  out.set(label, 0);
  out.set(sep, label.length);
  out.set(tag, label.length + sep.length);
  return out;
}

export function initialModel(): [Model, Cmd<Msg>] {
  return [
    {
      shellKey: shellPtyBinding(),
      exited: false,
      exitCode: 0,
      outputBytes: 0,
      termCols: 80,
      termRows: 24,
      leftSplit: 0.22,
      rightSplit: 0.62,
      goalsText: asciiBytes("(loading)"),
      tasksText: asciiBytes("(loading)"),
      ledgerStatus: asciiBytes("loading"),
      previewUrl: PREVIEW_URL,
      reloadToken: 0,
      history: [{ url: PREVIEW_URL }],
      historyIndex: 0,
    },
    Cmd.batch([
      Cmd.ptySpawn([asciiBytes("/bin/zsh"), asciiBytes("-i")], {
        key: "shell",
        event: "shell",
      }),
      Cmd.fetch({ url: GOALS_URL }, { key: "goals", ok: "goalsOk", err: "goalsErr" }),
      Cmd.fetch({ url: TASKS_URL }, { key: "tasks", ok: "tasksOk", err: "tasksErr" }),
    ]),
  ];
}

export function subscriptions(_model: Model): Sub<Msg> {
  return Sub.timer("ledger", 5000, "refreshTick");
}

export function update(model: Model, msg: Msg): Model | [Model, Cmd<Msg>] {
  switch (msg.kind) {
    case "termState": {
      if (msg.cols === model.termCols && msg.rows === model.termRows) return model;
      return [
        { ...model, termCols: msg.cols, termRows: msg.rows },
        Cmd.ptyResize("shell", msg.cols, msg.rows),
      ];
    }
    case "shell":
      if (msg.state === "exit") {
        return { ...model, exited: true, exitCode: msg.code };
      }
      return { ...model, outputBytes: model.outputBytes + msg.bytes.length };
    case "leftResized":
      return { ...model, leftSplit: msg.fraction };
    case "rightResized":
      return { ...model, rightSplit: msg.fraction };
    case "goalsOk":
      if (msg.status < 200 || msg.status >= 300) {
        return { ...model, ledgerStatus: asciiBytes("goals HTTP error") };
      }
      return {
        ...model,
        goalsText: joinLines(parseItemLines(msg.body, asciiBytes('"id"'), asciiBytes('"title"'))),
        ledgerStatus: asciiBytes("live"),
      };
    case "goalsErr":
      return { ...model, ledgerStatus: asciiBytes("daemon unreachable") };
    case "tasksOk":
      if (msg.status < 200 || msg.status >= 300) {
        return { ...model, ledgerStatus: asciiBytes("tasks HTTP error") };
      }
      return {
        ...model,
        tasksText: joinLines(parseItemLines(msg.body, asciiBytes('"id"'), asciiBytes('"title"'))),
        ledgerStatus: asciiBytes("live"),
      };
    case "tasksErr":
      return { ...model, ledgerStatus: asciiBytes("daemon unreachable") };
    case "refreshTick":
      return [
        model,
        Cmd.batch([
          Cmd.fetch({ url: GOALS_URL }, { key: "goals", ok: "goalsOk", err: "goalsErr" }),
          Cmd.fetch({ url: TASKS_URL }, { key: "tasks", ok: "tasksOk", err: "tasksErr" }),
        ]),
      ];
  }
}
