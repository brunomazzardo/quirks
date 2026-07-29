import { beforeEach, expect, it } from "vite-plus/test";

import {
  INITIAL_LAYOUT,
  type FocusPane,
  type LayoutSnapshot,
  paneFocused,
  paneOnStage,
  paneParked,
  paneVisible,
  useLayoutStore,
} from "./layout";

const PANES: readonly FocusPane[] = ["ledger", "terminal", "shape"];

beforeEach(() => {
  useLayoutStore.setState({ ...INITIAL_LAYOUT });
});

const layout = (): LayoutSnapshot => useLayoutStore.getState();
const act = () => useLayoutStore.getState();

/** Which panes the stage would actually paint, in stage order. */
function visiblePanes(): FocusPane[] {
  return PANES.filter((pane) => paneVisible(layout(), pane));
}

/** Which panes the stage keeps mounted — contents or edge tab. */
function stagedPanes(): FocusPane[] {
  return PANES.filter((pane) => paneOnStage(layout(), pane));
}

// ---------------------------------------------------------------------------
// defaults
// ---------------------------------------------------------------------------

it("opens on the three-pane split with nothing collapsed", () => {
  expect(layout()).toMatchObject({ focus: "split", ledgerHidden: false, shapeHidden: false });
  expect(visiblePanes()).toEqual(["ledger", "terminal", "shape"]);
});

// ---------------------------------------------------------------------------
// collapse — QK-NAT-008 (Shape) and QK-NAT-013 (Ledger mirrors it)
// ---------------------------------------------------------------------------

it("toggleShape flips shapeHidden, and flips back", () => {
  act().toggleShape();
  expect(layout().shapeHidden).toBe(true);

  act().toggleShape();
  expect(layout().shapeHidden).toBe(false);
});

it("toggleLedger mirrors it exactly", () => {
  act().toggleLedger();
  expect(layout().ledgerHidden).toBe(true);

  act().toggleLedger();
  expect(layout().ledgerHidden).toBe(false);
});

it("collapsing one pane leaves the other alone", () => {
  act().toggleLedger();
  expect(visiblePanes()).toEqual(["terminal", "shape"]);

  act().toggleShape();
  expect(visiblePanes()).toEqual(["terminal"]);
});

it("parks a collapsed pane to its edge tab, and only in the split stage", () => {
  act().toggleShape();
  expect(paneParked(layout(), "shape")).toBe(true);
  expect(paneParked(layout(), "ledger")).toBe(false);

  act().focusPane("terminal");
  expect(paneParked(layout(), "shape")).toBe(false);
});

it("never parks the terminal — it has no collapse control", () => {
  expect(paneParked(layout(), "terminal")).toBe(false);
  expect(paneVisible(layout(), "terminal")).toBe(true);
});

// A collapsed pane is not a hidden pane: it still owns the rail you click to
// get it back, and it is the pane component that draws that rail. Reading this
// off `paneVisible` cost the edge tabs their width in the browser — the tabs
// existed in the DOM and measured 0x0 — so the two questions are kept apart.
it("keeps a collapsed pane on the stage to hold its edge tab", () => {
  act().toggleLedger();

  expect(paneVisible(layout(), "ledger")).toBe(false);
  expect(paneOnStage(layout(), "ledger")).toBe(true);
  expect(stagedPanes()).toEqual(["ledger", "terminal", "shape"]);
});

it("takes an unfocused pane off the stage entirely, edge tab and all", () => {
  act().toggleShape();
  act().focusPane("terminal");

  expect(stagedPanes()).toEqual(["terminal"]);
  expect(paneOnStage(layout(), "shape")).toBe(false);
});

it("puts every visible pane on the stage, always", () => {
  for (const press of [
    () => act().toggleLedger(),
    () => act().toggleShape(),
    () => act().focusPane("shape"),
    () => act().exitFocus(),
  ]) {
    press();
    for (const pane of PANES) {
      if (paneVisible(layout(), pane)) expect(paneOnStage(layout(), pane)).toBe(true);
    }
  }
});

// ---------------------------------------------------------------------------
// focus — QK-NAT-014
// ---------------------------------------------------------------------------

it.each([
  ["ledger" as const, ["ledger"]],
  ["terminal" as const, ["terminal"]],
  ["shape" as const, ["shape"]],
])("focusing %s gives it the whole stage", (pane, expected) => {
  act().focusPane(pane);
  expect(layout().focus).toBe(pane);
  expect(visiblePanes()).toEqual(expected);
  expect(paneFocused(layout(), pane)).toBe(true);
});

it("pressing the live focus control again returns to split", () => {
  act().focusPane("terminal");
  act().focusPane("terminal");
  expect(layout().focus).toBe("split");
  expect(visiblePanes()).toEqual(["ledger", "terminal", "shape"]);
});

it("switches straight from one focus mode to another", () => {
  act().focusPane("ledger");
  act().focusPane("shape");
  expect(layout().focus).toBe("shape");
  expect(visiblePanes()).toEqual(["shape"]);
});

it("exitFocus returns to split from any mode, and is a no-op in split", () => {
  act().focusPane("shape");
  act().exitFocus();
  expect(layout().focus).toBe("split");

  const before = layout();
  act().exitFocus();
  expect(layout()).toMatchObject(before);
});

// ---------------------------------------------------------------------------
// the seam: focus overrides collapse, and leaving focus restores it
// ---------------------------------------------------------------------------

it("focus overrides a collapsed pane rather than being blocked by it", () => {
  act().toggleShape();
  act().focusPane("shape");

  expect(paneVisible(layout(), "shape")).toBe(true);
  // The collapse is overridden, not cleared.
  expect(layout().shapeHidden).toBe(true);
});

it("restores both collapse states after a trip through every focus mode", () => {
  act().toggleLedger();
  act().toggleShape();
  const collapsed = { ledgerHidden: true, shapeHidden: true };

  for (const pane of ["ledger", "terminal", "shape"] as const) {
    act().focusPane(pane);
    expect(layout()).toMatchObject({ focus: pane, ...collapsed });
  }

  act().exitFocus();
  expect(layout()).toMatchObject({ focus: "split", ...collapsed });
  expect(visiblePanes()).toEqual(["terminal"]);
});

it("keeps an expanded pane expanded through a focus mode", () => {
  act().focusPane("terminal");
  act().exitFocus();
  expect(visiblePanes()).toEqual(["ledger", "terminal", "shape"]);
});

// ---------------------------------------------------------------------------
// the native guarantee kept verbatim: a collapse press always reveals its pane
// ---------------------------------------------------------------------------

it.each([
  ["ledger" as const, "ledgerHidden" as const, () => act().toggleLedger()],
  ["shape" as const, "shapeHidden" as const, () => act().toggleShape()],
])("pressing the %s collapse control while focused elsewhere reveals it", (pane, flag, toggle) => {
  toggle(); // collapse it
  act().focusPane("terminal");

  toggle();

  expect(layout().focus).toBe("split");
  expect(layout()[flag]).toBe(false);
  expect(paneVisible(layout(), pane)).toBe(true);
});

it("pressing a collapse control while its own pane is focused leaves it open", () => {
  act().focusPane("ledger");
  act().toggleLedger();

  expect(layout()).toMatchObject({ focus: "split", ledgerHidden: false });
});

it("cannot be pressed into an empty stage", () => {
  const presses = [
    () => act().toggleLedger(),
    () => act().toggleShape(),
    () => act().focusPane("ledger"),
    () => act().focusPane("terminal"),
    () => act().focusPane("shape"),
    () => act().exitFocus(),
  ];

  // Every 3-press sequence over the whole control surface.
  for (const a of presses) {
    for (const b of presses) {
      for (const c of presses) {
        useLayoutStore.setState({ ...INITIAL_LAYOUT });
        a();
        b();
        c();
        expect(visiblePanes().length).toBeGreaterThan(0);
      }
    }
  }
});
