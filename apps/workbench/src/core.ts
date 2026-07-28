// Quirks workbench — NAT-005 terminal; NAT-007/008 ledger + Shape;
// NAT-009 theme; NAT-010 chrome; NAT-012 inbox; NAT-013 ledger collapse;
// NAT-014 focus modes.

import { Cmd, Sub, asciiBytes } from "@native-sdk/core";
import { type ChromeButtons, type ChromeInsets, type KeyEvent } from "@native-sdk/core/events";

// ts_core_host.zig: pub const pty_key_base: u64 = 0x5453_5054_0000_0000.
// NEVER write 0x5453505400000000 as a TS literal — emitter String(n) orphans the pty.
function shellPtyBinding(): number {
  return 1414746196 * 4294967296;
}

const GOALS_URL = asciiBytes("http://127.0.0.1:47301/v1/goals?limit=50");
const TASKS_URL = asciiBytes("http://127.0.0.1:47301/v1/tasks?limit=100");
const PREVIEW_URL = asciiBytes("http://127.0.0.1:47301/shape/");

const HEADER_NATURAL_HEIGHT = 52;
const LEFT_OPEN = 0.24;
/** Non-zero park — a literal 0 is easy for resize events to clobber back to the open fraction. */
const LEFT_CLOSED = 0.001;
const RIGHT_SHAPE = 0.65;

export type ShellState = "output" | "exit";
export type ShellExitReason =
  | "exited"
  | "signaled"
  | "cancelled"
  | "rejected"
  | "spawn_failed";

export type StatusTone = "neutral" | "live" | "done";

export type LayoutMode = "split" | "ledger" | "terminal" | "shape";
export type StatusFilter = "active" | "done" | "all";
export type GoalFilter = "progress" | "idle" | "all";
export type Ordering = "updated" | "status";
export type RowKind = "header" | "task";

export interface GoalRow {
  readonly id: Uint8Array;
  readonly title: Uint8Array;
  readonly status: Uint8Array;
  readonly tone: StatusTone;
}

export interface TaskRow {
  readonly id: Uint8Array;
  readonly title: Uint8Array;
  readonly status: Uint8Array;
  readonly tone: StatusTone;
  readonly goalId: Uint8Array;
  readonly updatedAt: Uint8Array;
}

/** Flat inbox rows: goal headers + tasks (NAT-012). */
export interface InboxRow {
  readonly id: Uint8Array;
  readonly rowKind: RowKind;
  readonly title: Uint8Array;
  readonly detail: Uint8Array;
  readonly status: Uint8Array;
  readonly tone: StatusTone;
  readonly selected: boolean;
  readonly sectionOpen: boolean;
}

export interface SectionCollapse {
  readonly id: Uint8Array;
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
  readonly goals: readonly GoalRow[];
  readonly tasks: readonly TaskRow[];
  readonly inbox: readonly InboxRow[];
  readonly collapsedSections: readonly SectionCollapse[];
  readonly selectedTaskId: Uint8Array;
  readonly statusFilter: StatusFilter;
  readonly goalFilter: GoalFilter;
  readonly ordering: Ordering;
  readonly viewOpen: boolean;
  readonly ledgerOpen: boolean;
  readonly shapeOpen: boolean;
  readonly layoutMode: LayoutMode;
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
  | { readonly kind: "toggleView" }
  | { readonly kind: "closeView" }
  | { readonly kind: "filterStatusActive" }
  | { readonly kind: "filterStatusDone" }
  | { readonly kind: "filterStatusAll" }
  | { readonly kind: "filterGoalProgress" }
  | { readonly kind: "filterGoalIdle" }
  | { readonly kind: "filterGoalAll" }
  | { readonly kind: "orderByUpdated" }
  | { readonly kind: "orderByStatus" }
  | { readonly kind: "resetFilters" }
  | { readonly kind: "collapseAll" }
  | { readonly kind: "toggleSection"; readonly id: Uint8Array }
  | { readonly kind: "toggleLedger" }
  | { readonly kind: "toggleShape" }
  | { readonly kind: "focusLedger" }
  | { readonly kind: "focusTerminal" }
  | { readonly kind: "focusShape" }
  | { readonly kind: "exitFocus" }
  | { readonly kind: "selectTask"; readonly id: Uint8Array }
  | {
      readonly kind: "key";
      readonly key: string;
      readonly shift: boolean;
      readonly control: boolean;
      readonly alt: boolean;
      readonly super: boolean;
    }
  | {
      readonly kind: "chrome_changed";
      readonly insets: ChromeInsets;
      readonly buttons: ChromeButtons;
      readonly tabsProjected: boolean;
    };

export const viewUnbound = [
  "shell",
  "chrome_changed",
  "key",
  "goals",
  "tasks",
  "collapsedSections",
] as const;

export const chromeMsg = "chrome_changed";

export function keyMsg(ev: KeyEvent): Msg | null {
  if (ev.key === "escape") return { kind: "exitFocus" };
  return null;
}

export function inboxCount(model: Model): number {
  let n = 0;
  for (let i = 0; i < model.inbox.length; i += 1) {
    if (model.inbox[i]!.rowKind === "task") n += 1;
  }
  return n;
}

export function viewDirty(model: Model): boolean {
  return (
    model.statusFilter !== "active" ||
    model.goalFilter !== "progress" ||
    model.ordering !== "updated"
  );
}

export function layoutIsSplit(model: Model): boolean {
  return model.layoutMode === "split";
}

export function layoutIsLedger(model: Model): boolean {
  return model.layoutMode === "ledger";
}

export function layoutIsTerminal(model: Model): boolean {
  return model.layoutMode === "terminal";
}

export function layoutIsShape(model: Model): boolean {
  return model.layoutMode === "shape";
}

export function statusActive(model: Model): boolean {
  return model.statusFilter === "active";
}

export function statusDone(model: Model): boolean {
  return model.statusFilter === "done";
}

export function statusAll(model: Model): boolean {
  return model.statusFilter === "all";
}

export function goalProgress(model: Model): boolean {
  return model.goalFilter === "progress";
}

export function goalIdle(model: Model): boolean {
  return model.goalFilter === "idle";
}

export function goalAll(model: Model): boolean {
  return model.goalFilter === "all";
}

export function orderUpdated(model: Model): boolean {
  return model.ordering === "updated";
}

export function orderStatus(model: Model): boolean {
  return model.ordering === "status";
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

/** ASCII lowercase without `c + 32` — the Zig emitter bitCasts that f64 path to garbage. */
function asciiLower(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = bytes[i]! | 32;
  }
  return out;
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
    bytesIncludes(lower, asciiBytes("live")) ||
    bytesIncludes(lower, asciiBytes("blocked"))
  ) {
    return "live";
  }
  return "neutral";
}

function taskIsActive(status: Uint8Array): boolean {
  const lower = asciiLower(status);
  if (bytesIncludes(lower, asciiBytes("completed"))) return false;
  if (bytesIncludes(lower, asciiBytes("closed"))) return false;
  if (bytesEq(lower, asciiBytes("done"))) return false;
  return true;
}

function taskIsDone(status: Uint8Array): boolean {
  return !taskIsActive(status);
}

function goalIsProgress(state: Uint8Array): boolean {
  const lower = asciiLower(state);
  if (bytesIncludes(lower, asciiBytes("progress"))) return true;
  if (bytesIncludes(lower, asciiBytes("not started"))) return false;
  if (bytesIncludes(lower, asciiBytes("tasks done"))) return false;
  if (bytesEq(lower, asciiBytes("done"))) return false;
  if (bytesEq(lower, asciiBytes("closed"))) return false;
  // Unknown / missing goal labels stay visible under the default view.
  return true;
}

function goalIsIdle(state: Uint8Array): boolean {
  return !goalIsProgress(state);
}

/** Derive goal id from task id: QK-NAT-012 → QK-NAT; bare QK-001 → empty. */
function goalIdOfTask(taskId: Uint8Array): Uint8Array {
  let lastDash = -1;
  for (let i = 0; i < taskId.length; i += 1) {
    if (taskId[i]! === 45) lastDash = i;
  }
  if (lastDash <= 0) return asciiBytes("");
  let allDigits = lastDash + 1 < taskId.length;
  for (let i = lastDash + 1; i < taskId.length; i += 1) {
    const c = taskId[i]!;
    if (c < 48 || c > 57) {
      allDigits = false;
      break;
    }
  }
  if (!allDigits) return asciiBytes("");
  const prefix = taskId.slice(0, lastDash);
  if (prefix.length < 4) return asciiBytes("");
  if (prefix[0]! !== 81 || prefix[1]! !== 75 || prefix[2]! !== 45) return asciiBytes("");
  if (prefix[3]! < 65 || prefix[3]! > 90) return asciiBytes("");
  return prefix;
}

function headerId(goalId: Uint8Array): Uint8Array {
  if (goalId.length === 0) return asciiBytes("h:other");
  return goalId;
}

function sectionCollapsed(
  collapsed: readonly SectionCollapse[],
  sectionId: Uint8Array,
): boolean {
  for (let i = 0; i < collapsed.length; i += 1) {
    if (bytesEq(collapsed[i]!.id, sectionId)) return true;
  }
  return false;
}

function compareBytesDesc(a: Uint8Array, b: Uint8Array): number {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i += 1) {
    const ca = a[i]!;
    const cb = b[i]!;
    if (ca < cb) return 1;
    if (ca > cb) return -1;
  }
  if (a.length < b.length) return 1;
  if (a.length > b.length) return -1;
  return 0;
}

function compareStatus(a: Uint8Array, b: Uint8Array): number {
  return compareBytesDesc(asciiLower(b), asciiLower(a)) * -1;
}

function sortTasks(tasks: readonly TaskRow[], ordering: Ordering): readonly TaskRow[] {
  if (ordering === "updated") {
    return tasks.toSorted((a, b) => {
      const c = compareBytesDesc(a.updatedAt, b.updatedAt);
      if (c !== 0) return c;
      return compareBytesDesc(a.id, b.id);
    });
  }
  return tasks.toSorted((a, b) => {
    const c = compareStatus(a.status, b.status);
    if (c !== 0) return c;
    return compareBytesDesc(a.id, b.id);
  });
}

function filterTasks(
  tasks: readonly TaskRow[],
  statusFilter: StatusFilter,
): readonly TaskRow[] {
  const out: TaskRow[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i]!;
    if (statusFilter === "active" && !taskIsActive(t.status)) continue;
    if (statusFilter === "done" && !taskIsDone(t.status)) continue;
    out[out.length] = t;
  }
  return out;
}

function tasksForGoal(tasks: readonly TaskRow[], goalId: Uint8Array): readonly TaskRow[] {
  const out: TaskRow[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i]!;
    if (bytesEq(t.goalId, goalId)) out[out.length] = t;
  }
  return out;
}

function tasksWithoutGoal(tasks: readonly TaskRow[]): readonly TaskRow[] {
  const out: TaskRow[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i]!;
    if (t.goalId.length === 0) out[out.length] = t;
  }
  return out;
}

function findGoal(
  goals: readonly GoalRow[],
  goalId: Uint8Array,
): GoalRow | null {
  for (let i = 0; i < goals.length; i += 1) {
    if (bytesEq(goals[i]!.id, goalId)) return goals[i]!;
  }
  return null;
}

/** Unique non-empty goal ids present in tasks, stable order of first appearance. */
function goalIdsFromTasks(tasks: readonly TaskRow[]): readonly Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const gid = tasks[i]!.goalId;
    if (gid.length === 0) continue;
    let seen = false;
    for (let j = 0; j < out.length; j += 1) {
      if (bytesEq(out[j]!, gid)) {
        seen = true;
        break;
      }
    }
    if (!seen) out[out.length] = gid;
  }
  return out;
}

function rebuildInbox(
  goals: readonly GoalRow[],
  tasks: readonly TaskRow[],
  statusFilter: StatusFilter,
  goalFilter: GoalFilter,
  ordering: Ordering,
  collapsed: readonly SectionCollapse[],
  selectedTaskId: Uint8Array,
): readonly InboxRow[] {
  const filtered = filterTasks(tasks, statusFilter);
  const out: InboxRow[] = [];
  const goalIds = goalIdsFromTasks(filtered);

  for (let gi = 0; gi < goalIds.length; gi += 1) {
    const gid = goalIds[gi]!;
    const g = findGoal(goals, gid);
    const state = g !== null ? g.status : asciiBytes("in progress");
    if (goalFilter === "progress" && !goalIsProgress(state)) continue;
    if (goalFilter === "idle" && !goalIsIdle(state)) continue;
    const group = tasksForGoal(filtered, gid);
    if (group.length === 0) continue;
    const sid = headerId(gid);
    const isExpanded = !sectionCollapsed(collapsed, sid);
    const title = g !== null && g.title.length > 0 ? g.title : gid;
    const tone = g !== null ? g.tone : statusTone(state);
    out[out.length] = {
      id: sid,
      rowKind: "header",
      title: title,
      detail: state,
      status: asciiBytes(""),
      tone: tone,
      selected: false,
      sectionOpen: isExpanded,
    };
    if (isExpanded) {
      const sorted = sortTasks(group, ordering);
      for (let ti = 0; ti < sorted.length; ti += 1) {
        const t = sorted[ti]!;
        out[out.length] = {
          id: t.id,
          rowKind: "task",
          title: t.title,
          detail: t.id,
          status: t.status,
          tone: t.tone,
          selected: bytesEq(t.id, selectedTaskId),
          sectionOpen: true,
        };
      }
    }
  }

  const other = tasksWithoutGoal(filtered);
  if (other.length > 0) {
    const sid = headerId(asciiBytes(""));
    const isExpanded = !sectionCollapsed(collapsed, sid);
    out[out.length] = {
      id: sid,
      rowKind: "header",
      title: asciiBytes("Other"),
      detail: asciiBytes("no goal"),
      status: asciiBytes(""),
      tone: "neutral",
      selected: false,
      sectionOpen: isExpanded,
    };
    if (isExpanded) {
      const sorted = sortTasks(other, ordering);
      for (let ti = 0; ti < sorted.length; ti += 1) {
        const t = sorted[ti]!;
        out[out.length] = {
          id: t.id,
          rowKind: "task",
          title: t.title,
          detail: t.id,
          status: t.status,
          tone: t.tone,
          selected: bytesEq(t.id, selectedTaskId),
          sectionOpen: true,
        };
      }
    }
  }

  return out;
}

function withInbox(model: Model): Model {
  return {
    ...model,
    inbox: rebuildInbox(
      model.goals,
      model.tasks,
      model.statusFilter,
      model.goalFilter,
      model.ordering,
      model.collapsedSections,
      model.selectedTaskId,
    ),
  };
}

function applyLayout(model: Model): Model {
  if (model.layoutMode === "ledger") {
    return { ...model, leftSplit: 1.0, rightSplit: 1.0, ledgerOpen: true };
  }
  if (model.layoutMode === "terminal") {
    return {
      ...model,
      leftSplit: LEFT_CLOSED,
      rightSplit: 1.0,
      ledgerOpen: false,
      shapeOpen: false,
    };
  }
  if (model.layoutMode === "shape") {
    return { ...model, leftSplit: LEFT_CLOSED, rightSplit: 0, ledgerOpen: false, shapeOpen: true };
  }
  const left = model.ledgerOpen ? LEFT_OPEN : LEFT_CLOSED;
  const right = model.shapeOpen ? RIGHT_SHAPE : 1.0;
  return { ...model, leftSplit: left, rightSplit: right };
}

/** `hay.indexOf(needle, from)` — subset indexOf is start-only. */
function indexOfFrom(hay: Uint8Array, needle: Uint8Array, from: number): number {
  if (needle.length === 0 || from >= hay.length) return -1;
  const start = from < 0 ? 0 : from;
  const limit = hay.length - needle.length;
  for (let i = start; i <= limit; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

/**
 * Ledger JSON is too brace-noisy for a subset walker (strings contain `{`/`}`).
 * Scan id-keyed JSON records instead; each task/goal window runs until the next id.
 */
function parseGoals(body: Uint8Array): readonly GoalRow[] {
  const itemsKey = asciiBytes('"items"');
  const itemsAt = body.indexOf(itemsKey);
  if (itemsAt < 0) return [];
  const idKey = asciiBytes('"id":"');
  const out: GoalRow[] = [];
  let from = itemsAt;
  while (out.length < 40) {
    const idAt = indexOfFrom(body, idKey, from);
    if (idAt < 0) break;
    let i = idAt + idKey.length;
    const idStart = i;
    while (i < body.length && body[i]! !== 34) {
      if (body[i]! === 92) i += 2;
      else i += 1;
    }
    const id = body.slice(idStart, i);
    const nextId = indexOfFrom(body, idKey, i + 1);
    from = nextId < 0 ? body.length : nextId;
    if (id.length === 0) continue;
    if (bytesEq(id, asciiBytes("(no goal)"))) continue;
    // Task ids end with a numeric segment (QK-001 / QK-NAT-012). Goals do not.
    let lastDash = -1;
    for (let k = 0; k < id.length; k += 1) {
      if (id[k]! === 45) lastDash = k;
    }
    if (lastDash >= 0 && lastDash + 1 < id.length) {
      let numericSuffix = true;
      for (let k = lastDash + 1; k < id.length; k += 1) {
        const c = id[k]!;
        if (c < 48 || c > 57) {
          numericSuffix = false;
          break;
        }
      }
      if (numericSuffix) continue;
    }
    const obj = body.slice(idAt, from);
    const titleRaw = jsonKeyedString(obj, asciiBytes('"title":"'));
    const state = jsonKeyedString(obj, asciiBytes('"state":"'));
    const title = titleRaw.length > 0 ? titleRaw : id;
    const label = state.length > 0 ? state : asciiBytes("—");
    out[out.length] = {
      id,
      title,
      status: label,
      tone: statusTone(label),
    };
  }
  return out;
}

function parseTasks(body: Uint8Array): readonly TaskRow[] {
  const itemsKey = asciiBytes('"items"');
  const itemsAt = body.indexOf(itemsKey);
  if (itemsAt < 0) return [];
  const idKey = asciiBytes('"id":"');
  const out: TaskRow[] = [];
  let from = itemsAt;
  while (out.length < 80) {
    const idAt = indexOfFrom(body, idKey, from);
    if (idAt < 0) break;
    let i = idAt + idKey.length;
    const idStart = i;
    while (i < body.length && body[i]! !== 34) {
      if (body[i]! === 92) i += 2;
      else i += 1;
    }
    const id = body.slice(idStart, i);
    const nextId = indexOfFrom(body, idKey, i + 1);
    from = nextId < 0 ? body.length : nextId;
    if (id.length < 3) continue;
    // Tasks are QK-… with a numeric suffix (QK-001 or QK-NAT-012).
    if (id[0]! !== 81 || id[1]! !== 75 || id[2]! !== 45) continue;
    let lastDash = -1;
    for (let k = 0; k < id.length; k += 1) {
      if (id[k]! === 45) lastDash = k;
    }
    if (lastDash < 0 || lastDash + 1 >= id.length) continue;
    let numericSuffix = true;
    for (let k = lastDash + 1; k < id.length; k += 1) {
      const c = id[k]!;
      if (c < 48 || c > 57) {
        numericSuffix = false;
        break;
      }
    }
    if (!numericSuffix) continue;
    const obj = body.slice(idAt, from);
    const titleRaw = jsonKeyedString(obj, asciiBytes('"title":"'));
    const status = jsonKeyedString(obj, asciiBytes('"status":"'));
    const updatedAt = jsonKeyedString(obj, asciiBytes('"updatedAt":"'));
    const title = titleRaw.length > 0 ? titleRaw : id;
    const label = status.length > 0 ? status : asciiBytes("—");
    out[out.length] = {
      id,
      title,
      status: label,
      tone: statusTone(label),
      goalId: goalIdOfTask(id),
      updatedAt,
    };
  }
  return out;
}

/**
 * Read a string value after an exact `"key":"` prefix — avoids `"status"` matching
 * inside `"statusDetail"`.
 */
function jsonKeyedString(obj: Uint8Array, keyed: Uint8Array): Uint8Array {
  const at = obj.indexOf(keyed);
  if (at < 0) return asciiBytes("");
  let i = at + keyed.length;
  const start = i;
  while (i < obj.length && obj[i]! !== 34) {
    if (obj[i]! === 92) i += 2;
    else i += 1;
  }
  return obj.slice(start, i);
}

function exitFocusModel(model: Model): Model {
  if (model.layoutMode === "split" && !model.viewOpen) return model;
  return applyLayout({
    ...model,
    layoutMode: "split",
    ledgerOpen: true,
    viewOpen: false,
  });
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
      leftSplit: LEFT_OPEN,
      rightSplit: 1.0,
      goals: [],
      tasks: [],
      inbox: [],
      collapsedSections: [],
      selectedTaskId: asciiBytes(""),
      statusFilter: "active",
      goalFilter: "progress",
      ordering: "updated",
      viewOpen: false,
      ledgerOpen: true,
      shapeOpen: false,
      layoutMode: "split",
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
      if (model.layoutMode === "ledger") {
        return { ...model, leftSplit: 1.0 };
      }
      if (
        model.layoutMode === "terminal" ||
        model.layoutMode === "shape" ||
        !model.ledgerOpen
      ) {
        return { ...model, leftSplit: LEFT_CLOSED };
      }
      return { ...model, leftSplit: msg.fraction };
    case "rightResized":
      if (model.layoutMode === "shape") {
        return { ...model, rightSplit: 0 };
      }
      if (model.layoutMode !== "split" || !model.shapeOpen) {
        return { ...model, rightSplit: 1.0 };
      }
      return { ...model, rightSplit: msg.fraction };
    case "toggleView":
      return { ...model, viewOpen: !model.viewOpen };
    case "closeView":
      return { ...model, viewOpen: false };
    case "filterStatusActive":
      return withInbox({ ...model, statusFilter: "active", viewOpen: false });
    case "filterStatusDone":
      return withInbox({ ...model, statusFilter: "done", viewOpen: false });
    case "filterStatusAll":
      return withInbox({ ...model, statusFilter: "all", viewOpen: false });
    case "filterGoalProgress":
      return withInbox({ ...model, goalFilter: "progress", viewOpen: false });
    case "filterGoalIdle":
      return withInbox({ ...model, goalFilter: "idle", viewOpen: false });
    case "filterGoalAll":
      return withInbox({ ...model, goalFilter: "all", viewOpen: false });
    case "orderByUpdated":
      return withInbox({ ...model, ordering: "updated", viewOpen: false });
    case "orderByStatus":
      return withInbox({ ...model, ordering: "status", viewOpen: false });
    case "resetFilters":
      return withInbox({
        ...model,
        statusFilter: "active",
        goalFilter: "progress",
        ordering: "updated",
        viewOpen: false,
      });
    case "collapseAll": {
      const ids: SectionCollapse[] = [];
      for (let i = 0; i < model.inbox.length; i += 1) {
        const row = model.inbox[i]!;
        if (row.rowKind === "header") {
          ids[ids.length] = { id: row.id };
        }
      }
      return withInbox({ ...model, collapsedSections: ids, viewOpen: false });
    }
    case "toggleSection": {
      const sectionId = msg.id;
      const next: SectionCollapse[] = [];
      let found = false;
      for (let i = 0; i < model.collapsedSections.length; i += 1) {
        const c = model.collapsedSections[i]!;
        if (bytesEq(c.id, sectionId)) {
          found = true;
        } else {
          next[next.length] = c;
        }
      }
      if (!found) {
        next[next.length] = { id: msg.id };
      }
      return withInbox({ ...model, collapsedSections: next });
    }
    case "toggleLedger":
      if (model.layoutMode === "ledger") {
        return applyLayout({ ...model, layoutMode: "split", ledgerOpen: true });
      }
      if (model.layoutMode !== "split") {
        return applyLayout({ ...model, layoutMode: "split", ledgerOpen: true });
      }
      return applyLayout({ ...model, ledgerOpen: !model.ledgerOpen });
    case "toggleShape":
      if (model.layoutMode === "shape") {
        return applyLayout({ ...model, layoutMode: "split", shapeOpen: true });
      }
      if (model.layoutMode !== "split") {
        return applyLayout({ ...model, layoutMode: "split", shapeOpen: true });
      }
      return applyLayout({ ...model, shapeOpen: !model.shapeOpen });
    case "focusLedger":
      if (model.layoutMode === "ledger") {
        return applyLayout({
          ...model,
          layoutMode: "split",
          ledgerOpen: true,
          viewOpen: false,
        });
      }
      return applyLayout({ ...model, layoutMode: "ledger", viewOpen: false });
    case "focusTerminal":
      if (model.layoutMode === "terminal") {
        return applyLayout({
          ...model,
          layoutMode: "split",
          ledgerOpen: true,
          viewOpen: false,
        });
      }
      return applyLayout({ ...model, layoutMode: "terminal", viewOpen: false });
    case "focusShape":
      if (model.layoutMode === "shape") {
        return applyLayout({
          ...model,
          layoutMode: "split",
          shapeOpen: true,
          ledgerOpen: true,
          viewOpen: false,
        });
      }
      return applyLayout({ ...model, layoutMode: "shape", viewOpen: false });
    case "exitFocus":
      return exitFocusModel(model);
    case "selectTask":
      return withInbox({ ...model, selectedTaskId: msg.id });
    case "key":
      if (msg.key === "escape") return exitFocusModel(model);
      return model;
    case "goalsOk":
      if (msg.status < 200 || msg.status >= 300) {
        return { ...model, ledgerStatus: asciiBytes("goals HTTP error") };
      }
      return withInbox({
        ...model,
        goals: parseGoals(msg.body),
        ledgerStatus: asciiBytes("live"),
      });
    case "goalsErr":
      return { ...model, ledgerStatus: asciiBytes("daemon unreachable") };
    case "tasksOk":
      if (msg.status < 200 || msg.status >= 300) {
        return { ...model, ledgerStatus: asciiBytes("tasks HTTP error") };
      }
      return withInbox({
        ...model,
        tasks: parseTasks(msg.body),
        ledgerStatus: asciiBytes("live"),
      });
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

// rebuild-bump 1785264274
