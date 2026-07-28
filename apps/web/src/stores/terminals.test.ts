// Tab arithmetic (QK-WB-004). xterm's DOM behavior belongs to the live smoke;
// what is worth pinning here is the state machine the tab strip runs on —
// especially that more than one tab can be live at once, which is the whole
// acceptance criterion expressed in the client's own terms.

import { beforeEach, expect, it } from "vite-plus/test";

import { nextActiveKey, nextLabel, useTerminalStore, type TerminalTab } from "./terminals";

beforeEach(() => {
  useTerminalStore.getState().reset();
});

const tab = (key: string, label: string): TerminalTab => ({
  key,
  label,
  sessionId: null,
  status: "starting",
  exitCode: null,
  error: null,
});

// ---- nextLabel ----

it("labels the first terminal 1", () => {
  expect(nextLabel([])).toBe("1");
});

it("labels sequentially while nothing has closed", () => {
  expect(nextLabel([tab("a", "1")])).toBe("2");
  expect(nextLabel([tab("a", "1"), tab("b", "2")])).toBe("3");
});

it("reuses the lowest free number, so the strip never shows gaps", () => {
  expect(nextLabel([tab("a", "1"), tab("c", "3")])).toBe("2");
  expect(nextLabel([tab("b", "2"), tab("c", "3")])).toBe("1");
});

// ---- nextActiveKey ----

it("closing a background tab does not move the selection", () => {
  const tabs = [tab("a", "1"), tab("b", "2"), tab("c", "3")];
  expect(nextActiveKey(tabs, "a", "c")).toBe("a");
});

it("closing the active tab selects its right-hand neighbour", () => {
  const tabs = [tab("a", "1"), tab("b", "2"), tab("c", "3")];
  expect(nextActiveKey(tabs, "b", "b")).toBe("c");
});

it("closing the last tab falls back to the new last", () => {
  const tabs = [tab("a", "1"), tab("b", "2"), tab("c", "3")];
  expect(nextActiveKey(tabs, "c", "c")).toBe("b");
});

it("closing the only tab selects nothing", () => {
  expect(nextActiveKey([tab("a", "1")], "a", "a")).toBeNull();
});

// ---- the store ----

it("opens a tab, focuses it, and hands back its key", () => {
  const key = useTerminalStore.getState().openTab();
  const state = useTerminalStore.getState();
  expect(state.tabs).toHaveLength(1);
  expect(state.activeKey).toBe(key);
  expect(state.tabs[0]?.status).toBe("starting");
  expect(state.tabs[0]?.sessionId).toBeNull();
});

it("keeps two terminals at once — the gap QK-WB-004 closes", () => {
  const first = useTerminalStore.getState().openTab();
  const second = useTerminalStore.getState().openTab();
  useTerminalStore.getState().bindSession(first, "pty_aaa");
  useTerminalStore.getState().bindSession(second, "pty_bbb");
  useTerminalStore.getState().setStatus(first, "live");
  useTerminalStore.getState().setStatus(second, "live");

  const { tabs, activeKey } = useTerminalStore.getState();
  expect(tabs).toHaveLength(2);
  expect(tabs.map((t) => t.sessionId)).toEqual(["pty_aaa", "pty_bbb"]);
  expect(tabs.every((t) => t.status === "live")).toBe(true);
  expect(tabs[0]?.label).toBe("1");
  expect(tabs[1]?.label).toBe("2");
  // Distinct sessions, distinct keys — no shared index-0 binding anywhere.
  expect(new Set(tabs.map((t) => t.key)).size).toBe(2);
  expect(activeKey).toBe(second);
});

it("gives each tab its own key even when labels are reused", () => {
  const first = useTerminalStore.getState().openTab();
  useTerminalStore.getState().openTab();
  useTerminalStore.getState().closeTab(first);
  const third = useTerminalStore.getState().openTab();
  const { tabs } = useTerminalStore.getState();
  // The label 1 is free again, but the key must not be.
  expect(tabs.find((t) => t.key === third)?.label).toBe("1");
  expect(third).not.toBe(first);
});

it("binding a session clears a previous error", () => {
  const key = useTerminalStore.getState().openTab();
  useTerminalStore.getState().setStatus(key, "failed", "daemon unreachable");
  expect(useTerminalStore.getState().tabs[0]?.error).toBe("daemon unreachable");
  useTerminalStore.getState().bindSession(key, "pty_x");
  expect(useTerminalStore.getState().tabs[0]?.error).toBeNull();
});

it("going live drops a stale reason rather than carrying it forward", () => {
  const key = useTerminalStore.getState().openTab();
  useTerminalStore.getState().setStatus(key, "reconnecting", "socket closed");
  expect(useTerminalStore.getState().tabs[0]?.error).toBe("socket closed");
  useTerminalStore.getState().setStatus(key, "live");
  expect(useTerminalStore.getState().tabs[0]?.error).toBeNull();
  expect(useTerminalStore.getState().tabs[0]?.status).toBe("live");
});

it("records an exit code and keeps the tab, so the last screen survives", () => {
  const key = useTerminalStore.getState().openTab();
  useTerminalStore.getState().bindSession(key, "pty_x");
  useTerminalStore.getState().markExited(key, 137);
  const [only] = useTerminalStore.getState().tabs;
  expect(only?.status).toBe("exited");
  expect(only?.exitCode).toBe(137);
  expect(useTerminalStore.getState().tabs).toHaveLength(1);
});

it("closing one tab leaves the other's session untouched", () => {
  const first = useTerminalStore.getState().openTab();
  const second = useTerminalStore.getState().openTab();
  useTerminalStore.getState().bindSession(first, "pty_aaa");
  useTerminalStore.getState().bindSession(second, "pty_bbb");

  useTerminalStore.getState().closeTab(first);
  const { tabs, activeKey } = useTerminalStore.getState();
  expect(tabs).toHaveLength(1);
  expect(tabs[0]?.sessionId).toBe("pty_bbb");
  expect(activeKey).toBe(second);
});

it("activate ignores a key that is not there rather than blanking the pane", () => {
  const key = useTerminalStore.getState().openTab();
  useTerminalStore.getState().activate("term-nope");
  expect(useTerminalStore.getState().activeKey).toBe(key);
});

it("updates to a tab that has gone are dropped, not thrown", () => {
  const key = useTerminalStore.getState().openTab();
  useTerminalStore.getState().closeTab(key);
  expect(() => {
    useTerminalStore.getState().setStatus(key, "live");
    useTerminalStore.getState().bindSession(key, "pty_ghost");
    useTerminalStore.getState().markExited(key, 0);
  }).not.toThrow();
  expect(useTerminalStore.getState().tabs).toEqual([]);
});
