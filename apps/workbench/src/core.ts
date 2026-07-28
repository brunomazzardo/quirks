// Quirks workbench — NAT-005 terminal; NAT-007/008 ledger + Shape;
// NAT-009 theme; NAT-010 chrome; NAT-011 ledger polish.

import { Cmd, Sub, asciiBytes } from "@native-sdk/core";
import { type ChromeButtons, type ChromeInsets } from "@native-sdk/core/events";

// ts_core_host.zig: pub const pty_key_base: u64 = 0x5453_5054_0000_0000.
// NEVER write 0x5453505400000000 as a TS literal — emitter String(n) orphans the pty.
function shellPtyBinding(): number {
  return 1414746196 * 4294967296;
}

const GOALS_URL = asciiBytes("http://127.0.0.1:47301/v1/goals?limit=50");
const TASKS_URL = asciiBytes("http://127.0.0.1:47301/v1/tasks?limit=50");
const PREVIEW_URL = asciiBytes("http://127.0.0.1:47301/shape/");

/// Tall hidden-inset titlebar floor (soundboard-ts / notes pattern).
const HEADER_NATURAL_HEIGHT = 52;

export type ShellState = "output" | "exit";
export type ShellExitReason =
  | "exited"
  | "signaled"
  | "cancelled"
  | "rejected"
  | "spawn_failed";

/** Badge tone for density-A status chips. */
export type StatusTone = "neutral" | "live" | "done";

/** Density-A ledger row (QK-NAT-007 / 011). */
export interface LedgerRow {
  readonly id: Uint8Array;
  readonly title: Uint8Array;
  readonly status: Uint8Array;
  readonly tone: StatusTone;
  readonly selected: boolean;
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
  readonly goals: readonly LedgerRow[];
  readonly tasks: readonly LedgerRow[];
  readonly goalsOpen: boolean;
  readonly tasksOpen: boolean;
  readonly selectedGoalId: Uint8Array;
  readonly selectedTaskId: Uint8Array;
  readonly shapeOpen: boolean;
  readonly ledgerStatus: Uint8Array;
  readonly previewUrl: Uint8Array;
  readonly reloadToken: number;
  readonly history: readonly HistoryEntry[];
  readonly historyIndex: number;
  readonly chromeLeading: number;
  readonly chromeTrailing: number;
  readonly headerHeight: number;
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
  | { readonly kind: "refreshTick"; readonly at: number }
  | { readonly kind: "toggleGoals" }
  | { readonly kind: "toggleTasks" }
  | { readonly kind: "toggleShape" }
  | { readonly kind: "selectGoal"; readonly id: Uint8Array }
  | { readonly kind: "selectTask"; readonly id: Uint8Array }
  | {
      readonly kind: "chrome_changed";
      readonly insets: ChromeInsets;
      readonly buttons: ChromeButtons;
      readonly tabsProjected: boolean;
    };

export const viewUnbound = ["shell", "chrome_changed"] as const;

/** Window-chrome geometry — header IS the titlebar (NAT-010). */
export const chromeMsg = "chrome_changed";

export function goalCount(model: Model): number {
  return model.goals.length;
}

export function taskCount(model: Model): number {
  return model.tasks.length;
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function bytesIncludes(hay: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  const limit = hay.length - needle.length;
  for (let i = 0; i <= limit; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function statusTone(tag: Uint8Array): StatusTone {
  const lower = asciiLower(tag);
  if (
    bytesIncludes(lower, asciiBytes("done")) ||
    bytesIncludes(lower, asciiBytes("completed")) ||
    bytesIncludes(lower, asciiBytes("closed"))
  ) {
    return "done";
  }
  if (
    bytesIncludes(lower, asciiBytes("progress")) ||
    bytesIncludes(lower, asciiBytes("claimed")) ||
    bytesIncludes(lower, asciiBytes("running")) ||
    bytesIncludes(lower, asciiBytes("live"))
  ) {
    return "live";
  }
  return "neutral";
}

function asciiLower(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i]!;
    out[i] = c >= 65 && c <= 90 ? c + 32 : c;
  }
  return out;
}

function withSelection(
  rows: readonly LedgerRow[],
  selectedId: Uint8Array,
): readonly LedgerRow[] {
  const out: LedgerRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    out[out.length] = {
      id: r.id,
      title: r.title,
      status: r.status,
      tone: r.tone,
      selected: bytesEq(r.id, selectedId),
    };
  }
  return out;
}

function parseRows(body: Uint8Array, selectedId: Uint8Array): readonly LedgerRow[] {
  const itemsKey = asciiBytes('"items"');
  const itemsAt = body.indexOf(itemsKey);
  if (itemsAt < 0) return [];
  let i = itemsAt + itemsKey.length;
  while (i < body.length && body[i]! !== 91) i += 1;
  if (i >= body.length) return [];
  i += 1;

  const out: LedgerRow[] = [];
  while (i < body.length && out.length < 40) {
    while (i < body.length && body[i]! !== 123 && body[i]! !== 93) i += 1;
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
    const id = jsonStringField(obj, asciiBytes('"id"'));
    const titleRaw = jsonStringField(obj, asciiBytes('"title"'));
    const status = jsonStringField(obj, asciiBytes('"status"'));
    const state = jsonStringField(obj, asciiBytes('"state"'));
    const title = titleRaw.length > 0 ? titleRaw : id;
    const tag = status.length > 0 ? status : state;
    const label = tag.length > 0 ? tag : asciiBytes("—");
    out[out.length] = {
      id,
      title,
      status: label,
      tone: statusTone(label),
      selected: bytesEq(id, selectedId),
    };
  }
  return out;
}

function jsonStringField(obj: Uint8Array, key: Uint8Array): Uint8Array {
  const at = obj.indexOf(key);
  if (at < 0) return asciiBytes("");
  let i = at + key.length;
  while (i < obj.length && (obj[i]! === 32 || obj[i]! === 58)) i += 1;
  if (i < obj.length && obj[i]! === 110) return asciiBytes("");
  if (i >= obj.length || obj[i]! !== 34) return asciiBytes("");
  i += 1;
  const start = i;
  while (i < obj.length && obj[i]! !== 34) {
    if (obj[i]! === 92) i += 2;
    else i += 1;
  }
  return obj.slice(start, i);
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
      leftSplit: 0.24,
      rightSplit: 1.0,
      goals: [],
      tasks: [],
      goalsOpen: true,
      tasksOpen: true,
      selectedGoalId: asciiBytes(""),
      selectedTaskId: asciiBytes(""),
      shapeOpen: false,
      ledgerStatus: asciiBytes("loading"),
      previewUrl: PREVIEW_URL,
      reloadToken: 0,
      history: [{ url: PREVIEW_URL }],
      historyIndex: 0,
      chromeLeading: 0,
      chromeTrailing: 0,
      headerHeight: HEADER_NATURAL_HEIGHT,
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
      if (!model.shapeOpen) return { ...model, rightSplit: 1.0 };
      return { ...model, rightSplit: msg.fraction };
    case "toggleGoals":
      return { ...model, goalsOpen: !model.goalsOpen };
    case "toggleTasks":
      return { ...model, tasksOpen: !model.tasksOpen };
    case "toggleShape":
      if (model.shapeOpen) {
        return { ...model, shapeOpen: false, rightSplit: 1.0 };
      }
      return { ...model, shapeOpen: true, rightSplit: 0.65 };
    case "selectGoal":
      return {
        ...model,
        selectedGoalId: msg.id,
        goals: withSelection(model.goals, msg.id),
      };
    case "selectTask":
      return {
        ...model,
        selectedTaskId: msg.id,
        tasks: withSelection(model.tasks, msg.id),
      };
    case "goalsOk":
      if (msg.status < 200 || msg.status >= 300) {
        return { ...model, ledgerStatus: asciiBytes("goals HTTP error") };
      }
      return {
        ...model,
        goals: parseRows(msg.body, model.selectedGoalId),
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
        tasks: parseRows(msg.body, model.selectedTaskId),
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
    case "chrome_changed":
      return {
        ...model,
        chromeLeading: msg.insets.left,
        chromeTrailing: msg.insets.right,
        headerHeight: Math.max(HEADER_NATURAL_HEIGHT, msg.insets.top),
      };
  }
}
