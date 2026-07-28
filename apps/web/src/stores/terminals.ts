// Terminal tabs (QK-WB-004).
//
// This store holds ONLY what the client owns: which tabs exist, which one is
// showing, and what each is doing. The sessions themselves live in the daemon
// (apps/server/src/pty/Sessions.ts) and outlive this state entirely — closing
// the page does not close a shell, and reopening it re-attaches. The split
// matters because it is what makes "two terminals" a property of the server
// rather than of this component tree, which is precisely what the Native
// workbench could not arrange (docs/upstream/native-terminal-gap/).
//
// Kept deliberately pure and small so the tab arithmetic is unit-testable
// without a DOM — xterm's behavior is left to the live smoke.

import { create } from "zustand";

export type TerminalStatus =
  /** The create request is in flight. */
  | "starting"
  /** Attached, bytes flowing. */
  | "live"
  /** The socket dropped but the session should still be there. */
  | "reconnecting"
  /** The shell exited; the pane keeps the last screen. */
  | "exited"
  /** Nothing to attach to — the daemon is down, or the create failed. */
  | "failed";

export interface TerminalTab {
  /** Stable client-side identity. Survives a session being recreated, which is
   *  why it, and not the session id, keys the React tree. */
  readonly key: string;
  /** What the tab strip shows. */
  readonly label: string;
  readonly sessionId: string | null;
  readonly status: TerminalStatus;
  readonly exitCode: number | null;
  /** Why it failed, for the quiet down-state. Never swallowed. */
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// pure tab arithmetic
// ---------------------------------------------------------------------------

/**
 * The lowest unused positive integer.
 *
 * Closing tab 2 of three and opening a new one should give you a 2 back, not a
 * 4 — the strip is a small fixed row and gaps in it read as a bug.
 */
export function nextLabel(tabs: readonly TerminalTab[]): string {
  const taken = new Set(tabs.map((tab) => Number.parseInt(tab.label, 10)));
  let candidate = 1;
  while (taken.has(candidate)) candidate += 1;
  return String(candidate);
}

/**
 * Which tab to show after `closing` goes away.
 *
 * Closing the tab you are not looking at must not move you. Closing the one you
 * ARE looking at moves to its right-hand neighbour, or its left if it was last
 * — the ordinary tab-strip behavior, and the one that never lands on nothing
 * while tabs remain.
 */
export function nextActiveKey(
  tabs: readonly TerminalTab[],
  activeKey: string | null,
  closing: string,
): string | null {
  const remaining = tabs.filter((tab) => tab.key !== closing);
  if (remaining.length === 0) return null;
  if (activeKey !== null && activeKey !== closing) {
    return remaining.some((tab) => tab.key === activeKey) ? activeKey : (remaining[0]?.key ?? null);
  }
  const index = tabs.findIndex((tab) => tab.key === closing);
  if (index === -1) return remaining[0]?.key ?? null;
  // `remaining[index]` is whatever shifted left into the closed slot — the
  // right-hand neighbour. Absent means it was the last tab, so take the new last.
  return (remaining[index] ?? remaining[remaining.length - 1])?.key ?? null;
}

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

let counter = 0;

/** Unique for the life of the page. Distinct from `label`, which is reused. */
function mintKey(): string {
  counter += 1;
  return `term-${counter}`;
}

interface TerminalState {
  readonly tabs: readonly TerminalTab[];
  readonly activeKey: string | null;
  /** Adds a tab in `starting` and focuses it. Returns its key. */
  openTab: () => string;
  closeTab: (key: string) => void;
  activate: (key: string) => void;
  /** The daemon answered with a session; this tab now has something to attach to. */
  bindSession: (key: string, sessionId: string) => void;
  setStatus: (key: string, status: TerminalStatus, detail?: string | null) => void;
  markExited: (key: string, exitCode: number) => void;
  /** Test seam. */
  reset: () => void;
}

const emptyTab = (key: string, label: string): TerminalTab => ({
  key,
  label,
  sessionId: null,
  status: "starting",
  exitCode: null,
  error: null,
});

const patch = (
  tabs: readonly TerminalTab[],
  key: string,
  change: (tab: TerminalTab) => TerminalTab,
): readonly TerminalTab[] => tabs.map((tab) => (tab.key === key ? change(tab) : tab));

export const useTerminalStore = create<TerminalState>((set) => ({
  tabs: [],
  activeKey: null,

  openTab: () => {
    const key = mintKey();
    set((state) => ({
      tabs: [...state.tabs, emptyTab(key, nextLabel(state.tabs))],
      activeKey: key,
    }));
    return key;
  },

  closeTab: (key) =>
    set((state) => ({
      tabs: state.tabs.filter((tab) => tab.key !== key),
      activeKey: nextActiveKey(state.tabs, state.activeKey, key),
    })),

  activate: (key) =>
    set((state) => (state.tabs.some((tab) => tab.key === key) ? { activeKey: key } : {})),

  bindSession: (key, sessionId) =>
    set((state) => ({
      tabs: patch(state.tabs, key, (tab) => ({ ...tab, sessionId, error: null })),
    })),

  setStatus: (key, status, detail = null) =>
    set((state) => ({
      tabs: patch(state.tabs, key, (tab) => ({
        ...tab,
        status,
        // A reason is only meaningful while something is wrong; carrying a
        // stale one into "live" would make the pane lie about its own state.
        error: status === "failed" || status === "reconnecting" ? (detail ?? tab.error) : null,
      })),
    })),

  markExited: (key, exitCode) =>
    set((state) => ({
      tabs: patch(state.tabs, key, (tab) => ({
        ...tab,
        status: "exited",
        exitCode,
        error: null,
      })),
    })),

  reset: () => {
    counter = 0;
    set({ tabs: [], activeKey: null });
  },
}));
